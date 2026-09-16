const state = {
  data: null,
  subvertadown: null,
  view: location.hash.slice(1) || "command",
  leagueId: null,
  playerQuery: "",
  playerPosition: "ALL",
  trade: { teamA: null, teamB: null, sideA: new Set(), sideB: new Set() }
};

const app = document.querySelector("#app");
const leagueSelect = document.querySelector("#global-league");
const pageTitle = document.querySelector("#page-title");
const pageKicker = document.querySelector("#page-kicker");
const sidebar = document.querySelector(".sidebar");
const menuButton = document.querySelector("#menu-button");

const titles = {
  command: "Command center", teams: "My teams", matchups: "Matchups",
  players: "Player market", trades: "Trade lab", waivers: "Waivers + FAAB",
  standings: "League tables", snapshots: "Weekly snapshots"
};

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);
const number = (value, digits = 1) => Number(value || 0).toFixed(digits);
const normalize = value => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const currentLeague = () => state.data.leagues.find(league => league.id === state.leagueId) || state.data.leagues[0];
const connectedLeagues = () => state.data.leagues.filter(league => league.status === "connected");
const teamById = (league, id) => league.teams.find(team => team.id === String(id));
const myTeam = league => teamById(league, league.myTeamId);
const rankingMap = () => new Map(state.data.rankings.map(row => [normalize(row.name), row]));
const playerRank = player => rankingMap().get(normalize(player.name));
const playerProjection = player => player.projected || playerRank(player)?.projection || 0;

function relativeTime(iso) {
  if (!iso) return "Not synced";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function platformPill(league) {
  return `<span class="platform ${league.platform}">${escapeHtml(league.platform)}</span>`;
}

function empty(title, text) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`;
}

function leagueOptions(includeLocked = true) {
  return state.data.leagues.filter(league => includeLocked || league.status === "connected").map(league =>
    `<option value="${league.id}" ${league.id === state.leagueId ? "selected" : ""}>${escapeHtml(league.name)}${league.status !== "connected" ? " · locked" : ""}</option>`
  ).join("");
}

function updateChrome() {
  pageTitle.textContent = titles[state.view] || titles.command;
  pageKicker.textContent = `${state.data.season} season · week ${state.data.nflWeek || "—"}`;
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("is-active", button.dataset.view === state.view));
  leagueSelect.innerHTML = leagueOptions(true);
  document.querySelector("#sync-state").textContent = `${state.data.summary.connected} of 5 leagues live`;
  document.querySelector("#sync-time").textContent = `Updated ${relativeTime(state.data.generatedAt)}`;
}

function leagueCards() {
  return `<div class="league-grid">${state.data.leagues.map(league => {
    const mine = myTeam(league);
    const connected = league.status === "connected";
    return `<article class="league-card ${league.id === state.leagueId ? "is-selected" : ""}" data-league-card="${league.id}" tabindex="0">
      <div class="league-card-top">${platformPill(league)}<span class="status ${connected ? "" : "locked"}" title="${connected ? "Connected" : "Credentials required"}"></span></div>
      <h3>${escapeHtml(league.name)}</h3>
      <div class="team-name">${connected ? escapeHtml(mine?.name || "Team not identified") : "Private connection required"}</div>
      <div class="league-card-bottom">
        <div><div class="record">${mine ? `${mine.wins}–${mine.losses}` : "—"}</div><small>${mine ? `${number(mine.pointsFor, 1)} PF` : "Awaiting sync"}</small></div>
        <small>Week ${league.currentWeek || "—"}</small>
      </div>
    </article>`;
  }).join("")}</div>`;
}

function myCurrentMatchup(league) {
  const mine = league.myTeamId;
  return league.matchups.find(matchup => Number(matchup.week) === Number(league.currentWeek) && (matchup.homeTeamId === mine || matchup.awayTeamId === mine));
}

function actionItems() {
  const items = [];
  state.data.leagues.filter(league => league.status === "auth_required").forEach(league => items.push({
    title: `Connect ESPN ${league.id}`, detail: "Add ESPN_SWID and ESPN_S2 in repository secrets", value: "LOCKED"
  }));
  connectedLeagues().forEach(league => {
    const mine = myTeam(league);
    if (!mine) return;
    const starters = mine.players.filter(player => !["BENCH", "IR"].includes(player.slot));
    const bench = mine.players.filter(player => player.slot === "BENCH");
    bench.forEach(candidate => {
      const replacement = starters.filter(player => player.position === candidate.position || player.slot === "FLEX").sort((a, b) => playerProjection(a) - playerProjection(b))[0];
      const delta = replacement ? playerProjection(candidate) - playerProjection(replacement) : 0;
      if (delta >= 1.5) items.push({ title: `${candidate.name} over ${replacement.name}`, detail: league.name, value: `+${number(delta)} pts` });
    });
  });
  if (state.subvertadown?.status !== "connected") items.push({ title: "Connect Subvertadown Snapshot", detail: "QB, K and D/ST weekly archive", value: "PENDING" });
  return items.slice(0, 6);
}

function exposureData() {
  const counts = new Map();
  connectedLeagues().forEach(league => {
    const mine = myTeam(league);
    (mine?.players || []).forEach(player => {
      const key = normalize(player.name);
      const row = counts.get(key) || { name: player.name, count: 0 };
      row.count += 1;
      counts.set(key, row);
    });
  });
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 6);
}

function renderCommand() {
  const records = connectedLeagues().map(myTeam).filter(Boolean);
  const wins = records.reduce((sum, team) => sum + team.wins, 0);
  const losses = records.reduce((sum, team) => sum + team.losses, 0);
  const points = records.reduce((sum, team) => sum + team.pointsFor, 0);
  const actions = actionItems();
  const exposure = exposureData();
  app.innerHTML = `
    <div class="hero-strip">
      <article class="week-card"><div><span class="tag">Live portfolio</span><h2>Week ${state.data.nflWeek}</h2></div><p>One decision surface for all five leagues: lineup edges, matchup context, player availability, trades and budget discipline.</p></article>
      <article class="metric accent"><small>Combined record</small><strong>${wins}–${losses}</strong><div class="metric-foot">Across ${records.length} connected teams</div></article>
      <article class="metric"><small>Points scored</small><strong>${number(points, 0)}</strong><div class="metric-foot">Current season total</div></article>
      <article class="metric"><small>Needs attention</small><strong>${actions.length}</strong><div class="metric-foot">Connections + lineup edges</div></article>
    </div>
    <div class="section-head"><div><h2>Your five leagues</h2><p>Select a card to make it the active workspace.</p></div></div>
    ${leagueCards()}
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-head"><div><h2>Decision queue</h2><p>Highest-value setup and lineup items right now.</p></div></div>
        <div class="action-list">${actions.length ? actions.map((item, index) => `<div class="action-row"><span class="action-index">${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div><span class="action-value">${escapeHtml(item.value)}</span></div>`).join("") : empty("Queue clear", "No obvious lineup swaps or connection tasks were found.")}</div>
      </section>
      <section class="panel"><div class="panel-head"><div><h2>Player exposure</h2><p>Most-rostered players across your connected teams.</p></div></div>
        <div class="exposure-bars">${exposure.map(item => `<div class="bar-row"><span>${escapeHtml(item.name)}</span><div class="bar"><span style="width:${item.count / Math.max(records.length, 1) * 100}%"></span></div><strong>${item.count}×</strong></div>`).join("") || empty("No rosters", "Connected roster data will appear here.")}</div>
      </section>
    </div>`;
  bindLeagueCards();
}

function renderLockedLeague(league) {
  app.innerHTML = `<div class="snapshot-banner"><div><span class="platform espn">ESPN</span><h2>${escapeHtml(league.name)} needs authentication</h2><p>This public repository never stores private ESPN cookies. Add <strong>ESPN_SWID</strong> and <strong>ESPN_S2</strong> as GitHub Actions repository secrets, then run the season-data workflow once.</p></div><div class="lock-icon">⌁</div></div>`;
}

function renderTeams() {
  const league = currentLeague();
  if (league.status !== "connected") return renderLockedLeague(league);
  const team = myTeam(league);
  if (!team) return app.innerHTML = empty("Team not identified", "The league is connected, but your manager mapping needs to be updated.");
  const players = [...team.players].sort((a, b) => (["IR", "BENCH"].includes(a.slot) - ["IR", "BENCH"].includes(b.slot)) || playerProjection(b) - playerProjection(a));
  const projected = players.filter(player => !["BENCH", "IR"].includes(player.slot)).reduce((sum, player) => sum + playerProjection(player), 0);
  app.innerHTML = `
    <div class="team-overview">
      <div class="mini-stat"><span>Record</span><strong>${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ""}</strong></div>
      <div class="mini-stat"><span>Points for</span><strong>${number(team.pointsFor)}</strong></div>
      <div class="mini-stat"><span>Projected lineup</span><strong>${projected ? number(projected) : "—"}</strong></div>
      <div class="mini-stat"><span>FAAB remaining</span><strong>$${Math.max(0, league.faabBudget - team.faabSpent)}</strong></div>
    </div>
    <div class="section-head"><div><h2>${escapeHtml(team.name)}</h2><p>${escapeHtml(league.name)} · managed by ${escapeHtml(team.owner)}</p></div><a href="${escapeHtml(league.url)}" target="_blank" rel="noreferrer">Open league ↗</a></div>
    <div class="table-wrap"><table><thead><tr><th>Slot</th><th>Player</th><th>Pos</th><th>Rank</th><th>Proj.</th><th>Actual</th><th>Status</th></tr></thead><tbody>
      ${players.map(player => { const rank = playerRank(player); return `<tr class="${!["BENCH", "IR"].includes(player.slot) ? "highlight-row" : ""}"><td>${escapeHtml(player.slot)}</td><td class="player-cell"><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.team || "FA")}</small></td><td><span class="pos-pill">${escapeHtml(player.position)}</span></td><td>${escapeHtml(rank?.positionRank || "—")}</td><td>${playerProjection(player) ? number(playerProjection(player)) : "—"}</td><td>${player.actual ? number(player.actual) : "—"}</td><td class="${player.injury !== "ACTIVE" ? "injury" : ""}">${escapeHtml(player.injury)}</td></tr>`; }).join("")}
    </tbody></table></div>`;
}

function renderMatchups() {
  const league = currentLeague();
  if (league.status !== "connected") return renderLockedLeague(league);
  const matchups = league.matchups.filter(matchup => Number(matchup.week) === Number(league.currentWeek));
  app.innerHTML = `<div class="section-head"><div><h2>${escapeHtml(league.name)} · Week ${league.currentWeek}</h2><p>${matchups.length} current matchups</p></div></div>
    <div class="matchup-grid">${matchups.map(matchup => {
      const home = teamById(league, matchup.homeTeamId), away = teamById(league, matchup.awayTeamId);
      const isMine = [matchup.homeTeamId, matchup.awayTeamId].includes(league.myTeamId);
      return `<article class="matchup-card ${isMine ? "is-mine" : ""}"><div class="matchup-card-head"><span>${isMine ? "Your matchup" : "League matchup"}</span><span>W${matchup.week}</span></div>
        <div class="matchup-team"><div><strong>${escapeHtml(home?.name || "TBD")}</strong><small>${home ? `${home.wins}–${home.losses}` : ""}</small></div><span>${number(matchup.homeScore)}</span></div>
        <div class="matchup-team"><div><strong>${escapeHtml(away?.name || "TBD")}</strong><small>${away ? `${away.wins}–${away.losses}` : ""}</small></div><span>${number(matchup.awayScore)}</span></div></article>`;
    }).join("") || empty("Matchups unavailable", "The platform has not published this scoring period yet.")}</div>`;
}

function ownership(playerName, league) {
  const key = normalize(playerName);
  for (const team of league.teams) if (team.players.some(player => normalize(player.name) === key)) return team;
  return null;
}

function renderPlayers() {
  const league = currentLeague();
  const rows = state.data.rankings.filter(row => state.playerPosition === "ALL" || row.position === state.playerPosition).filter(row => normalize(row.name).includes(normalize(state.playerQuery))).slice(0, 160);
  app.innerHTML = `
    <div class="toolbar"><div class="field grow"><span>Search players</span><input id="player-search" value="${escapeHtml(state.playerQuery)}" placeholder="Name or team" /></div>
      <div class="segmented" id="position-filter">${["ALL", "QB", "RB", "WR", "TE", "K", "DEF"].map(position => `<button class="${position === state.playerPosition ? "is-active" : ""}" data-position="${position}">${position}</button>`).join("")}</div></div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Opponent</th><th>Projection</th><th>Grade</th><th>${escapeHtml(league.name)}</th></tr></thead><tbody>
      ${rows.map(row => { const owner = league.status === "connected" ? ownership(row.name, league) : null; return `<tr><td class="rank">${row.rank || "—"}</td><td class="player-cell"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.team || "FA")}</small></td><td><span class="pos-pill">${escapeHtml(row.position)}</span></td><td>${escapeHtml(row.opponent || "—")}</td><td>${row.projection ? number(row.projection) : "—"}</td><td class="grade">${escapeHtml(row.grade || "—")}</td><td class="${owner ? "rostered" : "available"}">${league.status !== "connected" ? "Locked" : owner ? escapeHtml(owner.name) : "Available"}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  document.querySelector("#player-search").addEventListener("input", event => { state.playerQuery = event.target.value; renderPlayers(); document.querySelector("#player-search").focus(); });
  document.querySelectorAll("[data-position]").forEach(button => button.addEventListener("click", () => { state.playerPosition = button.dataset.position; renderPlayers(); }));
}

function tradeValue(player) {
  const base = { QB: 8, RB: 13, WR: 12, TE: 9, K: 2, DEF: 2 }[player.position] || 5;
  const injuryPenalty = player.injury && player.injury !== "ACTIVE" ? 4 : 0;
  return Math.max(1, Math.round((playerProjection(player) * 1.8 + player.actual * .7 + base - injuryPenalty) * 10) / 10);
}

function tradeSide(league, side, teamId) {
  const team = teamById(league, teamId);
  if (!team) return "";
  return `<div class="trade-side"><div class="trade-side-head"><strong>${side === "A" ? "Team giving" : "Trade partner"}</strong><select data-trade-team="${side}">${league.teams.map(item => `<option value="${item.id}" ${item.id === teamId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></div><div class="trade-roster">${team.players.map(player => `<label class="trade-player"><input type="checkbox" data-trade-player="${side}" value="${escapeHtml(player.id)}" ${state.trade[`side${side}`].has(player.id) ? "checked" : ""}/><span><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.position)} · ${escapeHtml(player.team)}</small></span><span class="trade-value">${number(tradeValue(player))}</span></label>`).join("")}</div></div>`;
}

function renderTrades() {
  const league = currentLeague();
  if (league.status !== "connected") return renderLockedLeague(league);
  state.trade.teamA ||= league.myTeamId || league.teams[0]?.id;
  state.trade.teamB ||= league.teams.find(team => team.id !== state.trade.teamA)?.id;
  if (!teamById(league, state.trade.teamA)) state.trade.teamA = league.myTeamId || league.teams[0]?.id;
  if (!teamById(league, state.trade.teamB) || state.trade.teamA === state.trade.teamB) state.trade.teamB = league.teams.find(team => team.id !== state.trade.teamA)?.id;
  const teamA = teamById(league, state.trade.teamA), teamB = teamById(league, state.trade.teamB);
  const valueA = teamA.players.filter(player => state.trade.sideA.has(player.id)).reduce((sum, player) => sum + tradeValue(player), 0);
  const valueB = teamB.players.filter(player => state.trade.sideB.has(player.id)).reduce((sum, player) => sum + tradeValue(player), 0);
  const difference = Math.abs(valueA - valueB);
  const verdict = !valueA && !valueB ? "Select players on both sides to compare the package." : difference <= Math.max(valueA, valueB) * .12 ? "The packages are within the fair-value range." : `${valueA > valueB ? teamA.name : teamB.name} is sending roughly ${number(difference)} more value points.`;
  app.innerHTML = `<div class="section-head"><div><h2>${escapeHtml(league.name)} trade builder</h2><p>Value index blends weekly projection, current output, position scarcity and injury status.</p></div></div>
    <div class="trade-grid">${tradeSide(league, "A", state.trade.teamA)}<div class="trade-balance"><div><strong>⇄</strong><small>${number(valueA)} / ${number(valueB)}</small></div></div>${tradeSide(league, "B", state.trade.teamB)}</div><div class="trade-result">${escapeHtml(verdict)}</div>`;
  document.querySelectorAll("[data-trade-team]").forEach(select => select.addEventListener("change", () => { state.trade[`team${select.dataset.tradeTeam}`] = select.value; state.trade[`side${select.dataset.tradeTeam}`].clear(); renderTrades(); }));
  document.querySelectorAll("[data-trade-player]").forEach(input => input.addEventListener("change", () => { const set = state.trade[`side${input.dataset.tradePlayer}`]; input.checked ? set.add(input.value) : set.delete(input.value); renderTrades(); }));
}

function faabBid() {
  const remaining = Number(document.querySelector("#faab-remaining")?.value || 100);
  const need = Number(document.querySelector("#faab-need")?.value || 3);
  const upside = Number(document.querySelector("#faab-upside")?.value || 3);
  const competition = Number(document.querySelector("#faab-competition")?.value || 3);
  const season = Number(document.querySelector("#faab-season")?.value || 4);
  const percent = Math.min(65, Math.max(1, Math.round((need * 2.7 + upside * 2.4 + competition * 1.7) * (1.18 - season * .04))));
  return { percent, dollars: Math.max(1, Math.round(remaining * percent / 100)) };
}

function updateFaab() {
  const bid = faabBid();
  document.querySelector("#faab-output").textContent = `$${bid.dollars}`;
  document.querySelector("#faab-percent").textContent = `${bid.percent}% of remaining`;
  ["need", "upside", "competition", "season"].forEach(key => document.querySelector(`#${key}-value`).textContent = document.querySelector(`#faab-${key}`).value);
}

function renderWaivers() {
  const league = currentLeague();
  if (league.status !== "connected") return renderLockedLeague(league);
  const mine = myTeam(league);
  const remaining = Math.max(0, league.faabBudget - (mine?.faabSpent || 0));
  app.innerHTML = `<div class="faab-layout"><section class="tool-card"><div class="panel-head"><div><h2>FAAB calculator</h2><p>Model a bid against need, upside and likely competition.</p></div></div>
    <div class="field"><span>Budget remaining</span><input id="faab-remaining" type="number" min="0" value="${remaining}" /></div>
    ${[["need","Roster need"],["upside","Player upside"],["competition","Expected competition"],["season","Season patience"]].map(([id,label]) => `<div class="slider-row"><label for="faab-${id}"><span>${label}</span><output id="${id}-value">3</output></label><input id="faab-${id}" type="range" min="1" max="5" value="3" /></div>`).join("")}
    <div class="bid-result"><div><span>Suggested max bid</span><strong id="faab-output">—</strong></div><small id="faab-percent">—</small></div></section>
    <section><div class="section-head"><div><h2>League budget board</h2><p>${escapeHtml(league.name)} · $${league.faabBudget} starting budget</p></div></div><div class="table-wrap"><table><thead><tr><th>#</th><th>Team</th><th>Remaining</th><th>Spent</th><th>Moves</th><th>Waiver</th></tr></thead><tbody>${league.teams.slice().sort((a,b) => a.faabSpent-b.faabSpent).map((team,index) => `<tr class="${team.id === league.myTeamId ? "highlight-row" : ""}"><td>${index+1}</td><td>${escapeHtml(team.name)}</td><td class="grade">$${league.faabBudget-team.faabSpent}</td><td>$${team.faabSpent}</td><td>${team.moves}</td><td>${team.waiverRank || "—"}</td></tr>`).join("")}</tbody></table></div></section></div>`;
  document.querySelectorAll("#faab-remaining, input[type='range']").forEach(input => input.addEventListener("input", updateFaab));
  updateFaab();
}

function renderStandings() {
  const league = currentLeague();
  if (league.status !== "connected") return renderLockedLeague(league);
  app.innerHTML = `<div class="section-head"><div><h2>${escapeHtml(league.name)}</h2><p>${league.teamCount} teams · Week ${league.currentWeek}</p></div><a href="${escapeHtml(league.url)}" target="_blank" rel="noreferrer">Official standings ↗</a></div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Team</th><th>Manager</th><th>Record</th><th>PF</th><th>PA</th><th>Moves</th><th>Trades</th></tr></thead><tbody>${league.teams.map((team,index) => `<tr class="${team.id === league.myTeamId ? "highlight-row" : ""}"><td class="rank">${index+1}</td><td><strong>${escapeHtml(team.name)}</strong></td><td>${escapeHtml(team.owner)}</td><td>${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ""}</td><td>${number(team.pointsFor)}</td><td>${number(team.pointsAgainst)}</td><td>${team.moves}</td><td>${team.trades}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderSnapshots() {
  const sub = state.subvertadown;
  const top = position => state.data.rankings.filter(row => row.position === position).slice(0, 5);
  app.innerHTML = `<div class="snapshot-banner"><div><span class="platform">SUBVERTADOWN</span><h2>${sub.status === "connected" ? `Week ${sub.week} snapshot` : "Subscription connection pending"}</h2><p>${escapeHtml(sub.message || "Weekly QB, kicker and defense snapshots are archived after Monday Night Football and again before Sunday kickoff.")}</p></div><div class="lock-icon">${sub.status === "connected" ? "✓" : "⌁"}</div></div>
    <div class="section-head"><div><h2>Current consensus fallback</h2><p>Weekly ECR remains available while the authenticated Subvertadown capture is being connected.</p></div></div>
    <div class="source-grid">${[["QB","Quarterbacks"],["K","Kickers"],["DEF","D/ST"]].map(([position,label]) => `<article class="source-card"><span class="source-icon">${position}</span><h3>${label}</h3>${top(position).map(row => `<p><strong>${escapeHtml(row.positionRank || row.rank)} · ${escapeHtml(row.name)}</strong> — ${row.projection ? number(row.projection) : "—"} pts</p>`).join("") || `<p>Rankings have not posted yet.</p>`}</article>`).join("")}</div>`;
}

function bindLeagueCards() {
  document.querySelectorAll("[data-league-card]").forEach(card => {
    const select = () => { state.leagueId = card.dataset.leagueCard; leagueSelect.value = state.leagueId; render(); };
    card.addEventListener("click", select);
    card.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) select(); });
  });
}

function render() {
  updateChrome();
  ({ command: renderCommand, teams: renderTeams, matchups: renderMatchups, players: renderPlayers, trades: renderTrades, waivers: renderWaivers, standings: renderStandings, snapshots: renderSnapshots }[state.view] || renderCommand)();
}

async function loadData() {
  try {
    const cache = `?v=${Date.now()}`;
    const [hubResponse, subResponse] = await Promise.all([fetch(`data/hub.json${cache}`), fetch(`data/subvertadown.json${cache}`)]);
    if (!hubResponse.ok) throw new Error(`League data returned ${hubResponse.status}`);
    state.data = await hubResponse.json();
    state.subvertadown = subResponse.ok ? await subResponse.json() : { status: "connection_required", positions: {} };
    state.leagueId = state.data.leagues.find(league => league.status === "connected")?.id || state.data.leagues[0]?.id;
    render();
  } catch (error) {
    app.innerHTML = `<div class="error-state"><strong>The season snapshot could not load.</strong><p>${escapeHtml(error.message)}. Run the data sync or reload the page.</p></div>`;
  }
}

document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => {
  state.view = button.dataset.view; location.hash = state.view; sidebar.classList.remove("is-open"); menuButton.setAttribute("aria-expanded", "false"); render();
}));
leagueSelect.addEventListener("change", () => { state.leagueId = leagueSelect.value; state.trade = { teamA: null, teamB: null, sideA: new Set(), sideB: new Set() }; render(); });
document.querySelector("#refresh-button").addEventListener("click", loadData);
menuButton.addEventListener("click", () => { const open = sidebar.classList.toggle("is-open"); menuButton.setAttribute("aria-expanded", String(open)); });
window.addEventListener("hashchange", () => { const next = location.hash.slice(1); if (titles[next] && next !== state.view) { state.view = next; render(); } });

loadData();
