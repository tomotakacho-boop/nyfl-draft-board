# Fantasy Control Room

A public, read-only 2026 fantasy football season hub for five ESPN and Sleeper leagues. It combines standings, rosters, matchups, weekly rankings, trade comparison, player availability, and FAAB planning in one responsive website.

## Connected leagues

- ESPN `64665002` — public
- ESPN `416026` — private; requires repository secrets
- ESPN `1340339511` — private; requires repository secrets
- Sleeper `1396403028730339328`
- Sleeper `1387115477460865024`

Sleeper data uses its documented public read-only API. ESPN data is fetched from ESPN's internal fantasy endpoint. Only normalized league information is written to `data/hub.json`; authentication values are never written to disk or included in the website.

## Weekly refresh

There is no scheduled sync. After each weekend, ask Codex to refresh the ESPN, Sleeper, rankings, and snapshot data, or run the manual **Sync season data** workflow from the GitHub Actions tab. The workflow regenerates `data/hub.json`, commits the update, and pushes it to `main`.

For the two private ESPN leagues, keep these as GitHub Actions repository secrets so they are available when the weekly update is run:

- `ESPN_1_SWID` and `ESPN_1_S2` → ESPN league `1340339511`
- `ESPN_2_SWID` and `ESPN_2_S2` → ESPN league `416026`

Never place either value in a source file, issue, commit, or public message.

## Subvertadown

`data/subvertadown.json` is the safe public snapshot contract for authenticated QB, K, and D/ST weekly snapshots. The site shows a small public preview immediately; full subscribed rows are imported with `scripts/import_subvertadown.py`. Subvertadown credentials must not be committed.

To import a weekly authorized snapshot, save the copied/exported table as CSV or TSV and run:

```bash
./scripts/import_subvertadown.py subvertadown-week2.csv --week 2 --season 2026
```

The importer archives up to 17 weeks and stores only rankings, projections, matchups, error estimates, and hold flags—not account credentials or browser cookies.

## Local development

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`. Refresh league data with:

```bash
./scripts/sync_leagues.py
```

Optional ESPN credentials may be supplied as environment variables for a local run.

## Data sources

- ESPN fantasy league data
- Sleeper public API
- Weekly FantasyPros consensus rankings published through the nflverse/DynastyProcess data pipeline
- Subvertadown authenticated Snapshot data after connection

The trade comparison and FAAB calculator are decision aids, not guarantees. Their outputs should be reviewed with current injury news and league context.
