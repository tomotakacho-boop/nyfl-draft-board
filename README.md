# NYFL 2026 Draft Review

A standalone, dependency-free results site for the 2026 New York Fantasy League draft.

## Tabs

- **Draft Results** — the final 12-team, 16-round physical board; sort columns by draft order or team name and focus on one roster.
- **Draft Grade** — the complete 1–12 leaderboard plus a player-by-player scoring audit for every team.
- **Side Bets** — the accepted season-long and weekly matchup ledger, with type, status, and participant filters.
- **Methodology** — the grading weights, formulas, data inputs, and limitations.
- **Coming Soon!** — reserved for in-season actual-versus-projected tracking.

## Deploy to Netlify

Upload this entire folder to a GitHub repository and connect the repository to Netlify. The included `netlify.toml` publishes the repository root directly; there is no build command and no framework plugin required.

## Run locally

Opening `index.html` directly will block the JSON files in most browsers. Serve the folder over HTTP:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Canonical data

- `data/draft-results.json` — final 192 picks in round-by-team form.
- `data/confirmed-keepers.json` — final 36 locked keepers and their round costs.
- `data/player-metrics.json` — compact 192-player NYFL model snapshot used by the grade engine.
- `data/side-bets.json` — repository-backed season and matchup side-bet ledger.
- `model.js` — the auditable grading calculations.
