#!/usr/bin/env python3
"""Read-only ESPN + Sleeper sync for the public multi-league season hub."""

from __future__ import annotations

import datetime as dt
import csv
import io
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "leagues.config.json"
OUTPUT_PATH = ROOT / "data" / "hub.json"

ESPN_POSITION = {0: "QB", 1: "TQB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE", 16: "DEF", 17: "K"}
ESPN_SLOT = {0: "QB", 2: "RB", 4: "WR", 6: "TE", 16: "DEF", 17: "K", 20: "BENCH", 21: "IR", 23: "FLEX", 24: "FLEX", 25: "FLEX"}


def request_json(url: str, headers: dict[str, str] | None = None) -> object:
    request = urllib.request.Request(url, headers={"User-Agent": "NYFL-season-hub/1.0", **(headers or {})})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def request_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "NYFL-season-hub/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read().decode("utf-8")


def safe_number(value, default=0):
    return value if isinstance(value, (int, float)) else default


def espn_projection(entry: dict) -> tuple[float, float]:
    player = entry.get("playerPoolEntry", {}).get("player", {})
    projected = actual = 0.0
    for stat in player.get("stats", []) or []:
        if stat.get("statSourceId") == 1 and stat.get("statSplitTypeId") == 1:
            projected = max(projected, safe_number(stat.get("appliedTotal")))
        if stat.get("statSourceId") == 0 and stat.get("statSplitTypeId") == 1:
            actual = max(actual, safe_number(stat.get("appliedTotal")))
    return round(projected, 2), round(actual, 2)


def normalize_espn(raw: dict, spec: dict, config: dict) -> dict:
    members = {member.get("id"): member for member in raw.get("members", [])}
    owner_names = {name.casefold() for name in config["owner"].get("espnMemberNames", [])}
    teams, my_team_id = [], None
    for team in raw.get("teams", []):
        member = members.get(team.get("primaryOwner"), {})
        owner = " ".join(filter(None, [member.get("firstName"), member.get("lastName")])).strip() or member.get("displayName") or "Manager"
        if owner.casefold() in owner_names:
            my_team_id = team.get("id")
        record = team.get("record", {}).get("overall", {})
        counter = team.get("transactionCounter", {}) or {}
        roster = []
        for entry in (team.get("roster", {}) or {}).get("entries", []) or []:
            player = entry.get("playerPoolEntry", {}).get("player", {})
            projected, actual = espn_projection(entry)
            roster.append({
                "id": str(player.get("id", "")), "name": player.get("fullName") or "Unknown",
                "position": ESPN_POSITION.get(player.get("defaultPositionId"), "FLEX"),
                "slot": ESPN_SLOT.get(entry.get("lineupSlotId"), "BENCH"), "team": str(player.get("proTeamId") or ""),
                "injury": player.get("injuryStatus") or "ACTIVE", "projected": projected, "actual": actual,
                "percentOwned": safe_number((player.get("ownership") or {}).get("percentOwned"))
            })
        teams.append({
            "id": str(team.get("id")), "name": team.get("name") or team.get("abbrev") or f"Team {team.get('id')}",
            "abbrev": team.get("abbrev") or "", "logo": team.get("logo"), "owner": owner,
            "wins": safe_number(record.get("wins")), "losses": safe_number(record.get("losses")), "ties": safe_number(record.get("ties")),
            "pointsFor": round(safe_number(record.get("pointsFor")), 2), "pointsAgainst": round(safe_number(record.get("pointsAgainst")), 2),
            "waiverRank": safe_number(team.get("waiverRank")), "faabSpent": safe_number(counter.get("acquisitionBudgetSpent")),
            "moves": safe_number(counter.get("acquisitions")), "trades": safe_number(counter.get("trades")), "players": roster
        })

    matchups = []
    for matchup in raw.get("schedule", []) or []:
        home, away = matchup.get("home") or {}, matchup.get("away") or {}
        if not home.get("teamId"):
            continue
        matchups.append({
            "id": str(matchup.get("id", "")), "week": matchup.get("matchupPeriodId"),
            "homeTeamId": str(home.get("teamId")), "awayTeamId": str(away.get("teamId")) if away.get("teamId") else None,
            "homeScore": round(safe_number(home.get("totalPoints")), 2), "awayScore": round(safe_number(away.get("totalPoints")), 2),
            "homeProjected": round(safe_number(home.get("totalProjectedPointsLive")), 2),
            "awayProjected": round(safe_number(away.get("totalProjectedPointsLive")), 2), "winner": matchup.get("winner")
        })

    settings = raw.get("settings", {}) or {}
    current_week = raw.get("scoringPeriodId") or (raw.get("status", {}) or {}).get("currentMatchupPeriod") or 1
    teams.sort(key=lambda value: (-value["wins"], value["losses"], -value["pointsFor"]))
    return {
        "id": spec["id"], "platform": "espn", "url": spec["url"], "name": settings.get("name") or f"ESPN {spec['id']}",
        "status": "connected", "currentWeek": current_week, "teamCount": len(teams),
        "myTeamId": str(my_team_id) if my_team_id else None,
        "faabBudget": safe_number((settings.get("acquisitionSettings") or {}).get("acquisitionBudget"), 100),
        "rosterSlots": (settings.get("rosterSettings") or {}).get("lineupSlotCounts", {}), "teams": teams, "matchups": matchups
    }


def sync_espn(spec: dict, config: dict) -> dict:
    params = urllib.parse.urlencode([
        ("view", "mSettings"), ("view", "mTeam"), ("view", "mRoster"),
        ("view", "mMatchup"), ("view", "mMatchupScore"), ("view", "mNav")
    ])
    url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{config['season']}/segments/0/leagues/{spec['id']}?{params}"
    prefix = spec.get("secretPrefix", "ESPN")
    swid = os.environ.get(f"{prefix}_SWID", os.environ.get("ESPN_SWID", "")).strip()
    espn_s2 = os.environ.get(f"{prefix}_S2", os.environ.get("ESPN_S2", "")).strip()
    headers = {"Cookie": f"SWID={swid}; espn_s2={espn_s2}"} if swid and espn_s2 else {}
    try:
        return normalize_espn(request_json(url, headers), spec, config)
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            return {"id": spec["id"], "platform": "espn", "url": spec["url"], "name": f"Private ESPN League {spec['id']}", "status": "auth_required", "currentWeek": None, "teamCount": None, "myTeamId": None, "teams": [], "matchups": []}
        raise


def normalize_sleeper_player(player_id: str, players: dict) -> dict:
    player = players.get(player_id, {})
    first_last = f"{player.get('first_name') or ''} {player.get('last_name') or ''}".strip()
    return {
        "id": str(player_id), "name": player.get("full_name") or first_last or str(player_id),
        "position": (player.get("fantasy_positions") or [player.get("position") or "FLEX"])[0],
        "slot": "BENCH", "team": player.get("team") or "FA", "injury": player.get("injury_status") or "ACTIVE",
        "projected": 0, "actual": 0, "percentOwned": 0
    }


def sync_sleeper(spec: dict, config: dict, players: dict, nfl_week: int) -> dict:
    base = "https://api.sleeper.app/v1"
    league = request_json(f"{base}/league/{spec['id']}")
    users = request_json(f"{base}/league/{spec['id']}/users")
    rosters = request_json(f"{base}/league/{spec['id']}/rosters")
    user_map = {user.get("user_id"): user for user in users}
    owner_id = config["owner"].get("sleeperUserId")
    current_week = max(1, nfl_week)
    matchups_by_week, transactions = {}, []
    for week in range(1, current_week + 1):
        matchups_by_week[week] = request_json(f"{base}/league/{spec['id']}/matchups/{week}")
        transactions.extend(request_json(f"{base}/league/{spec['id']}/transactions/{week}"))

    teams, my_team_id = [], None
    for roster in rosters:
        roster_id = str(roster.get("roster_id"))
        user = user_map.get(roster.get("owner_id"), {})
        if roster.get("owner_id") == owner_id:
            my_team_id = roster_id
        metadata, settings = user.get("metadata") or {}, roster.get("settings") or {}
        starters, reserve = set(roster.get("starters") or []), set(roster.get("reserve") or [])
        team_players = []
        for player_id in roster.get("players") or []:
            player = normalize_sleeper_player(player_id, players)
            player["slot"] = "IR" if player_id in reserve else (player["position"] if player_id in starters else "BENCH")
            team_players.append(player)
        teams.append({
            "id": roster_id, "name": metadata.get("team_name") or user.get("display_name") or f"Roster {roster_id}",
            "abbrev": "", "logo": user.get("avatar") and f"https://sleepercdn.com/avatars/thumbs/{user['avatar']}",
            "owner": user.get("display_name") or "Manager", "wins": safe_number(settings.get("wins")),
            "losses": safe_number(settings.get("losses")), "ties": safe_number(settings.get("ties")),
            "pointsFor": round(safe_number(settings.get("fpts")) + safe_number(settings.get("fpts_decimal")) / 100, 2),
            "pointsAgainst": round(safe_number(settings.get("fpts_against")) + safe_number(settings.get("fpts_against_decimal")) / 100, 2),
            "waiverRank": safe_number(settings.get("waiver_position")), "faabSpent": safe_number(settings.get("waiver_budget_used")),
            "moves": safe_number(settings.get("total_moves")), "trades": 0, "players": team_players
        })

    matchups = []
    for week, rows in matchups_by_week.items():
        grouped = {}
        for row in rows:
            grouped.setdefault(row.get("matchup_id"), []).append(row)
            roster = next((team for team in teams if team["id"] == str(row.get("roster_id"))), None)
            if roster and week == current_week:
                points = row.get("players_points") or {}
                for player in roster["players"]:
                    player["actual"] = round(safe_number(points.get(player["id"])), 2)
        for matchup_id, pair in grouped.items():
            if not matchup_id or not pair:
                continue
            home, away = pair[0], pair[1] if len(pair) > 1 else {}
            matchups.append({
                "id": f"{week}-{matchup_id}", "week": week, "homeTeamId": str(home.get("roster_id")),
                "awayTeamId": str(away.get("roster_id")) if away else None,
                "homeScore": round(safe_number(home.get("points")), 2), "awayScore": round(safe_number(away.get("points")), 2),
                "homeProjected": 0, "awayProjected": 0, "winner": None
            })

    trade_counts = {}
    for transaction in transactions:
        if transaction.get("type") == "trade" and transaction.get("status") == "complete":
            for roster_id in transaction.get("roster_ids") or []:
                trade_counts[str(roster_id)] = trade_counts.get(str(roster_id), 0) + 1
    for team in teams:
        team["trades"] = trade_counts.get(team["id"], 0)
    teams.sort(key=lambda value: (-value["wins"], value["losses"], -value["pointsFor"]))
    return {
        "id": spec["id"], "platform": "sleeper", "url": spec["url"], "name": league.get("name") or f"Sleeper {spec['id']}",
        "status": "connected", "currentWeek": current_week, "teamCount": len(teams), "myTeamId": my_team_id,
        "faabBudget": safe_number((league.get("settings") or {}).get("waiver_budget"), 100),
        "rosterSlots": league.get("roster_positions") or [], "teams": teams, "matchups": matchups,
        "transactions": [{"id": item.get("transaction_id"), "type": item.get("type"), "status": item.get("status"), "created": item.get("created"), "rosterIds": [str(value) for value in item.get("roster_ids") or []], "adds": item.get("adds") or {}, "drops": item.get("drops") or {}, "waiverBudget": (item.get("settings") or {}).get("waiver_bid")} for item in transactions[:100]]
    }


def player_catalog(players: dict, leagues: list[dict]) -> list[dict]:
    rostered = {player["id"] for league in leagues for team in league.get("teams", []) for player in team.get("players", [])}
    catalog = []
    for player_id, player in players.items():
        position = (player.get("fantasy_positions") or [player.get("position")])[0]
        if position not in {"QB", "RB", "WR", "TE", "K", "DEF"} or (not player.get("active") and player_id not in rostered):
            continue
        first_last = f"{player.get('first_name') or ''} {player.get('last_name') or ''}".strip()
        catalog.append({"id": str(player_id), "name": player.get("full_name") or first_last or str(player_id), "position": position, "team": player.get("team") or "FA", "injury": player.get("injury_status") or "ACTIVE"})
    return sorted(catalog, key=lambda value: (value["position"], value["name"]))


def weekly_rankings() -> list[dict]:
    url = "https://github.com/dynastyprocess/data/raw/master/files/fp_latest_weekly.csv"
    rows = csv.DictReader(io.StringIO(request_text(url)))
    rankings = []
    for row in rows:
        position = (row.get("page_pos") or row.get("pos") or "").replace("DST", "DEF")
        if position not in {"QB", "RB", "WR", "TE", "K", "DEF"}:
            continue
        rankings.append({
            "name": row.get("player_name"), "position": position, "team": row.get("team"),
            "rank": safe_number(float(row["rank"])) if row.get("rank") not in {None, "", "NA"} else None,
            "positionRank": row.get("pos_rank"), "ecr": safe_number(float(row["ecr"])) if row.get("ecr") not in {None, "", "NA"} else None,
            "projection": safe_number(float(row["r2p_pts"])) if row.get("r2p_pts") not in {None, "", "NA"} else None,
            "grade": row.get("start_sit_grade"), "opponent": row.get("player_opponent"), "owned": safe_number(float(row["player_owned_avg"])) if row.get("player_owned_avg") not in {None, "", "NA"} else None,
            "scrapeDate": row.get("scrape_date")
        })
    return rankings


def main() -> int:
    config = json.loads(CONFIG_PATH.read_text())
    print("Fetching Sleeper player directory…", file=sys.stderr)
    sleeper_players = request_json("https://api.sleeper.app/v1/players/nfl")
    nfl_state = request_json("https://api.sleeper.app/v1/state/nfl")
    nfl_week = max(1, safe_number(nfl_state.get("week"), 1))
    leagues = []
    for spec in config["leagues"]:
        print(f"Syncing {spec['platform']} {spec['id']}…", file=sys.stderr)
        try:
            league = sync_espn(spec, config) if spec["platform"] == "espn" else sync_sleeper(spec, config, sleeper_players, nfl_week)
        except Exception as error:
            league = {"id": spec["id"], "platform": spec["platform"], "url": spec["url"], "name": f"{spec['platform'].title()} {spec['id']}", "status": "sync_error", "error": str(error), "teams": [], "matchups": []}
        leagues.append(league)
    payload = {
        "season": config["season"], "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "owner": config["owner"], "nflWeek": nfl_week, "leagues": leagues, "players": player_catalog(sleeper_players, leagues),
        "rankings": weekly_rankings(),
        "summary": {"connected": sum(item["status"] == "connected" for item in leagues), "authRequired": sum(item["status"] == "auth_required" for item in leagues), "errors": sum(item["status"] == "sync_error" for item in leagues)}
    }
    OUTPUT_PATH.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    print(f"Wrote {OUTPUT_PATH} with {payload['summary']['connected']} connected leagues.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
