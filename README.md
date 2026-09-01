# NYFL 2026 Draft Review

A standalone, dependency-free results site for the 2026 New York Fantasy League draft.

## Tabs

- **Draft Results** — the final 12-team, 16-round physical board, plus a roster view showing every club's projected starters and bench.
- **Draft Grade** — the complete 1–12 leaderboard plus a player-by-player scoring audit for every team.
- **Side Bets** — the accepted season-long and weekly matchup ledger, with type, status, and participant filters.
- **Group Chat** — a weekly, privacy-reviewed archive of memes, other images, X links, and messages with six or more active Haha Tapbacks.
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
- `data/group-chat.json` — generated, publishable group-chat index; it never contains the Messages database.
- `model.js` — the auditable grading calculations.

## Weekly group-chat archive

See [`scripts/GROUP_CHAT_SETUP.md`](scripts/GROUP_CHAT_SETUP.md). The extractor reads the local Messages database without modifying it, keeps full-resolution originals outside this repository, and writes only compressed web copies plus `data/group-chat.json` into the site.
