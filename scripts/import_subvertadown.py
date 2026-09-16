#!/usr/bin/env python3
"""Import an authorized Subvertadown Snapshot CSV/TSV into the public hub."""
from __future__ import annotations
import argparse, csv, datetime as dt, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "subvertadown.json"

def value(row: dict, *names: str) -> str:
    for name in names:
        if row.get(name) not in (None, "", "-"):
            return str(row[name]).strip()
    return ""

def number(raw: str):
    try: return float(raw)
    except (TypeError, ValueError): return None

def main() -> int:
    parser = argparse.ArgumentParser(description="Import rows copied/exported from an authorized Subvertadown Snapshot")
    parser.add_argument("input", type=pathlib.Path, help="CSV or TSV file")
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--season", type=int, default=2026)
    args = parser.parse_args()
    text = args.input.read_text(encoding="utf-8-sig")
    dialect = csv.Sniffer().sniff(text[:4096], delimiters=",\t;")
    positions = {"QB": [], "K": [], "DEF": []}
    for raw in csv.DictReader(text.splitlines(), dialect=dialect):
        position = value(raw, "position", "pos", "Position").upper().replace("DST", "DEF").replace("D/ST", "DEF")
        if position not in positions: continue
        positions[position].append({"player": value(raw, "player", "player_name", "Player", "team_name", "Team"), "team": value(raw, "team", "Team", "team_abbr"), "projection": number(value(raw, "projection", "proj", "points", f"Wk {args.week}", "Wk 2")), "opponent": value(raw, "opponent", "matchup", "Matchup"), "error": number(value(raw, "error", "err", "Err")), "hold": value(raw, "hold", "Hold?"), "week": args.week})
    if not any(positions.values()): raise SystemExit("No QB, K, or DEF rows were found. Check the CSV headers and try again.")
    previous = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {}
    archive = previous.get("archive", [])
    if previous.get("capturedAt") and previous.get("week"):
        archive = [item for item in archive if item.get("week") != previous.get("week")]
        archive.append({"week": previous["week"], "season": previous.get("season"), "capturedAt": previous["capturedAt"], "positions": previous.get("positions", {})})
    payload = {"status": "connected", "week": args.week, "season": args.season, "capturedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"), "source": "Authorized Subvertadown Snapshot import", "positions": positions, "archive": archive[-17:], "message": "Authorized Subvertadown Snapshot imported. Full QB, K, and D/ST rows are now archived for this week."}
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"Imported {sum(len(items) for items in positions.values())} rows into {OUTPUT}")
    return 0

if __name__ == "__main__": raise SystemExit(main())
