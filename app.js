import { GRADE_WEIGHTS, gradeDraft, snakePick } from "./model.js";

const app = document.querySelector("#app");
const dataStamp = document.querySelector("#dataStamp");
const tabs = [...document.querySelectorAll("[data-tab]")];

const state = {
  tab: "results",
  boardSort: "slot",
  focusedTeam: "ALL",
  gradeTeam: null,
};

let draftData;
let playerData;
let keeperData;
let report;

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const oneDecimal = (value) => Number(value).toFixed(1);
const rankNumber = (value) => Number.isFinite(Number(value)) ? `#${Math.round(Number(value))}` : "—";
const posClass = (position) => `pos-${String(position).toLowerCase().replace("/", "")}`;
const normalize = (value = "") => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

function boardPlayerMap() {
  return new Map(playerData.players.map((player) => [normalize(player.boardName || player.name), player]));
}

function keeperSet() {
  return new Set(keeperData.keepers.map((entry) => `${entry.team}|${normalize(entry.player)}|${entry.round}`));
}

function orderedTeams() {
  const teams = draftData.teams.slice();
  if (state.boardSort === "team") teams.sort((a, b) => a.team.localeCompare(b.team));
  else teams.sort((a, b) => a.slot - b.slot);
  return teams;
}

function sectionIntro(eyebrow, title, copy) {
  return `<header class="section-intro"><div><p>${escapeHtml(eyebrow)}</p><h2>${escapeHtml(title)}</h2></div><span>${escapeHtml(copy)}</span></header>`;
}

function positionTag(position) {
  return `<span class="position-tag ${posClass(position)}">${escapeHtml(position)}</span>`;
}

function renderResults() {
  const players = boardPlayerMap();
  const keepers = keeperSet();
  const teams = orderedTeams();
  const focused = state.focusedTeam === "ALL" ? null : draftData.teams.find((team) => team.team === state.focusedTeam);
  const totalPicks = draftData.teams.reduce((sum, team) => sum + team.picks.length, 0);

  const boardRows = Array.from({ length: draftData.rounds }, (_, index) => {
    const round = index + 1;
    const cells = teams.map((team) => {
      const name = team.picks[index];
      const player = players.get(normalize(name));
      const isKeeper = keepers.has(`${team.team}|${normalize(name)}|${round}`);
      const overall = snakePick(round, draftData.teams.length, team.slot);
      return `<td class="draft-cell ${isKeeper ? "keeper-cell" : ""}" data-team="${escapeHtml(team.team)}">
        <div class="pick-meta"><span>Overall #${overall}</span>${isKeeper ? "<b>KEEPER</b>" : ""}</div>
        <strong>${escapeHtml(name)}</strong>
        <small>${player ? `${positionTag(player.pos)} ${escapeHtml(player.team || "FA")}` : "Metrics unavailable"}</small>
      </td>`;
    }).join("");
    return `<tr><th scope="row"><span>ROUND</span><b>${round}</b></th>${cells}</tr>`;
  }).join("");

  const focusedRows = focused ? focused.picks.map((name, index) => {
    const round = index + 1;
    const player = players.get(normalize(name));
    const isKeeper = keepers.has(`${focused.team}|${normalize(name)}|${round}`);
    return `<tr>
      <td>R${round}</td><td>#${snakePick(round, draftData.teams.length, focused.slot)}</td>
      <td class="focus-player"><strong>${escapeHtml(name)}</strong>${isKeeper ? "<span>KEEPER</span>" : ""}</td>
      <td>${player ? positionTag(player.pos) : "—"}</td><td>${player ? rankNumber(player.rank) : "—"}</td>
      <td>${player?.adp == null ? "—" : oneDecimal(player.adp)}</td><td>${player?.projectedPPG == null ? "—" : oneDecimal(player.projectedPPG)}</td>
    </tr>`;
  }).join("") : "";

  app.innerHTML = `
    ${sectionIntro("FINAL DRAFT BOARD", "Every 2026 NYFL selection, in its original round", "Reorder the team columns by official draft slot or team name. Use Team Focus for a clean one-roster audit.")}
    <section class="summary-strip">
      <article><span>TEAMS</span><b>${draftData.teams.length}</b></article>
      <article><span>ROUNDS</span><b>${draftData.rounds}</b></article>
      <article><span>TOTAL PICKS</span><b>${totalPicks}</b></article>
      <article><span>LOCKED KEEPERS</span><b>${keeperData.keepers.length}</b></article>
    </section>
    <section class="board-controls" aria-label="Draft result controls">
      <div><span>SORT TEAM COLUMNS</span><button type="button" data-board-sort="slot" class="${state.boardSort === "slot" ? "active" : ""}">Draft order</button><button type="button" data-board-sort="team" class="${state.boardSort === "team" ? "active" : ""}">Team A–Z</button></div>
      <label><span>TEAM FOCUS</span><select id="teamFocus"><option value="ALL">All teams</option>${draftData.teams.slice().sort((a,b) => a.team.localeCompare(b.team)).map((team) => `<option value="${escapeHtml(team.team)}" ${state.focusedTeam === team.team ? "selected" : ""}>#${team.slot} ${escapeHtml(team.team)}</option>`).join("")}</select></label>
    </section>
    <section class="draft-board-shell" aria-label="2026 NYFL final draft board">
      <table class="draft-board-table">
        <thead><tr><th>ROUND</th>${teams.map((team) => `<th><span>#${team.slot}</span><strong>${escapeHtml(team.team)}</strong><small>${escapeHtml(team.manager)}</small></th>`).join("")}</tr></thead>
        <tbody>${boardRows}</tbody>
      </table>
    </section>
    ${focused ? `<section class="team-focus-panel">
      <header><div><p>TEAM FOCUS · SLOT ${focused.slot}</p><h3>${escapeHtml(focused.team)}</h3><span>${escapeHtml(focused.manager)}</span></div><button type="button" id="clearTeamFocus">Show full-league focus</button></header>
      <div class="simple-table-wrap"><table class="focus-table"><thead><tr><th>Round</th><th>Overall</th><th>Player</th><th>Pos</th><th>Model rank</th><th>ADP</th><th>Proj. PPG</th></tr></thead><tbody>${focusedRows}</tbody></table></div>
    </section>` : ""}
  `;

  document.querySelectorAll("[data-board-sort]").forEach((button) => button.addEventListener("click", () => { state.boardSort = button.dataset.boardSort; render(); }));
  document.querySelector("#teamFocus")?.addEventListener("change", (event) => { state.focusedTeam = event.target.value; render(); });
  document.querySelector("#clearTeamFocus")?.addEventListener("click", () => { state.focusedTeam = "ALL"; render(); });
}

function scoreCell(value) {
  return `<span class="score-cell"><b>${oneDecimal(value)}</b><i style="--score:${Math.round(value)}%"></i></span>`;
}

function renderGrades() {
  if (!state.gradeTeam) state.gradeTeam = report.teams[0].team;
  const selected = report.teams.find((team) => team.team === state.gradeTeam) || report.teams[0];
  const categoryLabels = {
    lineup: "Starting lineup",
    capital: "Draft-capital efficiency",
    depth: "Depth & resilience",
    construction: "Roster construction",
    upside: "Championship upside",
    durability: "Risk management",
    scarcity: "Positional scarcity",
    future: "Future keeper value",
  };

  const leaderboard = report.teams.map((team) => `<tr data-grade-team="${escapeHtml(team.team)}" class="${team.team === selected.team ? "selected" : ""}">
    <td class="rank-cell">${team.rank}</td>
    <td><strong>${escapeHtml(team.team)}</strong><small>${escapeHtml(team.manager)} · slot ${team.slot}</small></td>
    <td><span class="letter-grade">${team.letter}</span></td><td class="overall-grade">${oneDecimal(team.grade)}</td>
    <td>${oneDecimal(team.components.lineup)}</td><td>${oneDecimal(team.components.capital)}</td><td>${oneDecimal(team.components.depth)}</td>
    <td>${oneDecimal(team.components.construction)}</td><td>${oneDecimal(team.components.upside)}</td><td>${oneDecimal(team.components.durability)}</td>
    <td>${oneDecimal(team.components.scarcity)}</td><td>${oneDecimal(team.components.future)}</td>
  </tr>`).join("");

  const categoryCards = Object.entries(GRADE_WEIGHTS).map(([key, weight]) => `<article>
    <span>${escapeHtml(categoryLabels[key])}</span><b>${oneDecimal(selected.components[key])}</b><small>${weight} points</small>
    <i style="--score:${Math.round(selected.components[key])}%"></i>
  </article>`).join("");

  const playerRows = selected.roster.slice().sort((a, b) => a.round - b.round).map((entry) => {
    const player = entry.player;
    const keeperLabel = entry.keeper ? "<em>KEEPER</em>" : "";
    return `<tr>
      <td>R${entry.round}<small>#${entry.overall}</small></td>
      <td class="player-name-cell"><strong>${escapeHtml(player.boardName || player.name)}</strong><span>${escapeHtml(player.team || "FA")} · ${escapeHtml(player.posRank || player.pos)}</span>${keeperLabel}</td>
      <td>${positionTag(player.pos)}</td><td>${escapeHtml(entry.role)}</td>
      <td>${player.projectedPPG == null ? "—" : oneDecimal(player.projectedPPG)}</td><td>${oneDecimal(entry.marketRank)}</td>
      <td>${oneDecimal(entry.immediate)}</td><td>${oneDecimal(entry.acquisition)}</td><td>${oneDecimal(entry.upside)}</td>
      <td>${oneDecimal(entry.durability)}</td><td>${oneDecimal(entry.scarcity)}</td><td>${oneDecimal(entry.future)}</td>
      <td><b>${oneDecimal(entry.playerGrade)}</b></td><td class="contribution-cell"><b>${entry.contribution.toFixed(2)}</b><small>of 100</small></td>
    </tr>`;
  }).join("");

  app.innerHTML = `
    ${sectionIntro("FINAL REPORT CARD", "The 12 NYFL drafts, graded and ranked", "Grades use the current NYFL projection snapshot, exact keeper costs, injury risk, roster fit, and league-relative strength.")}
    <section class="grade-podium">
      ${report.teams.slice(0, 3).map((team) => `<article><span>#${team.rank}</span><div><strong>${escapeHtml(team.team)}</strong><small>${escapeHtml(team.manager)}</small></div><b>${oneDecimal(team.grade)}<small>${team.letter}</small></b></article>`).join("")}
    </section>
    <section class="leaderboard-panel">
      <header><div><p>LEAGUE LEADERBOARD</p><h3>Ranked 1–12 in one list</h3></div><span>Click any team to inspect every player calculation.</span></header>
      <div class="simple-table-wrap"><table class="leaderboard-table"><thead><tr><th>Rank</th><th>Team</th><th>Letter</th><th>Grade</th><th>Lineup</th><th>Capital</th><th>Depth</th><th>Build</th><th>Upside</th><th>Durability</th><th>Scarcity</th><th>Keeper</th></tr></thead><tbody>${leaderboard}</tbody></table></div>
    </section>
    <section class="team-grade-detail">
      <header>
        <div><p>DETAILED TEAM BREAKDOWN · #${selected.rank}</p><h3>${escapeHtml(selected.team)}</h3><span>${escapeHtml(selected.manager)} · draft slot ${selected.slot}</span></div>
        <div class="team-grade-total"><b>${oneDecimal(selected.grade)}</b><span>${selected.letter}</span><small>60% absolute · 40% league-relative</small></div>
        <label><span>VIEW TEAM</span><select id="gradeTeamSelect">${report.teams.map((team) => `<option value="${escapeHtml(team.team)}" ${team.team === selected.team ? "selected" : ""}>#${team.rank} ${escapeHtml(team.team)} — ${oneDecimal(team.grade)}</option>`).join("")}</select></label>
      </header>
      <div class="component-grid">${categoryCards}</div>
      <div class="grade-audit-strip"><span><b>${oneDecimal(selected.baseScore)}</b> raw rubric</span><span><b>${oneDecimal(selected.absoluteQualityScore)}</b> calibrated absolute</span><span><b>${oneDecimal(selected.leagueRelativeScore)}</b> league-relative</span><span><b>${selected.constructionContribution.toFixed(2)}</b> team-only construction points</span></div>
      <div class="player-grade-heading"><div><p>PLAYER-BY-PLAYER AUDIT</p><h4>Every score behind ${escapeHtml(selected.team)}’s grade</h4></div><span>Player contributions plus ${selected.constructionContribution.toFixed(2)} construction points equal the raw rubric score.</span></div>
      <div class="simple-table-wrap"><table class="player-grade-table"><thead><tr><th>Pick</th><th>Player</th><th>Pos</th><th>Role</th><th>PPG</th><th>Market</th><th>Now</th><th>Value</th><th>Upside</th><th>Durability</th><th>Scarcity</th><th>Future</th><th>Player grade</th><th>Team pts</th></tr></thead><tbody>${playerRows}</tbody></table></div>
    </section>
  `;

  document.querySelectorAll("[data-grade-team]").forEach((row) => row.addEventListener("click", () => { state.gradeTeam = row.dataset.gradeTeam; render(); document.querySelector(".team-grade-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
  document.querySelector("#gradeTeamSelect")?.addEventListener("change", (event) => { state.gradeTeam = event.target.value; render(); });
}

function renderMethodology() {
  const labels = {
    lineup: ["Starting lineup", "The best legal QB/RB/RB/WR/WR/TE/FLEX/DST/K combination, scored from position-adjusted projected PPG, model rank, and confidence."],
    capital: ["Draft-capital efficiency", "Actual snake pick versus the blended market rank (model rank plus ADP). Keeper players are evaluated at their real locked round cost."],
    depth: ["Depth & resilience", "The five strongest non-starting skill players, blending immediate production and acquisition value."],
    construction: ["Roster construction", "Required starters, RB/WR volume, and penalties for inefficient excess at QB, TE, K, or D/ST."],
    upside: ["Championship upside", "Top-eight ceiling scores using position projection, overall talent, dynasty context, rookie status, and expert upside research."],
    durability: ["Risk management", "One hundred minus the current injury-prone score, averaged across all 16 rostered players."],
    scarcity: ["Positional scarcity", "Starter quality within each position, with modest premiums for difference-making quarterback and tight-end production."],
    future: ["Future keeper value", "Top-five long-range assets using dynasty rank, upside, round leverage, and the NYFL keeper-cost structure."],
  };
  app.innerHTML = `
    ${sectionIntro("MODEL METHODOLOGY", "A transparent grade—not a black box", "The report card separates player quality from price, roster fit, health, ceiling, and future keeper utility.")}
    <section class="method-hero">
      <article><span>FINAL GRADE</span><b>60%</b><p>Calibrated absolute roster quality</p></article>
      <article><span>PLUS</span><b>40%</b><p>Strength relative to the other 11 NYFL teams</p></article>
      <article><span>DATA</span><b>192</b><p>Player-level records tied to actual selections</p></article>
    </section>
    <section class="method-grid">
      ${Object.entries(GRADE_WEIGHTS).map(([key, weight]) => `<article><div><span>${weight}</span><small>POINTS</small></div><h3>${labels[key][0]}</h3><p>${labels[key][1]}</p></article>`).join("")}
    </section>
    <section class="formula-panel">
      <header><p>CALCULATION FLOW</p><h3>From a single player to the final 1–12 order</h3></header>
      <ol>
        <li><b>Match the board.</b><span>All 192 confirmed names map to the current NYFL half-PPR player snapshot. No unknown pick is invented.</span></li>
        <li><b>Score every player.</b><span>Immediate value, acquisition value, upside, durability, scarcity, and future value each run on a 0–100 scale.</span></li>
        <li><b>Build a legal lineup.</b><span>The model chooses the highest-rated legal starters, then measures five-player depth and roster construction.</span></li>
        <li><b>Create the raw rubric.</b><span>The eight weighted categories sum to a transparent 100-point base. Player contribution points sum to that base except for construction, which is team-only.</span></li>
        <li><b>Calibrate the grade.</b><span>Absolute quality is the raw rubric plus a 15-point league-depth calibration. The final grade is 60% calibrated absolute quality and 40% league-relative strength.</span></li>
        <li><b>Rank the league.</b><span>Teams are ordered by the final grade. Small score gaps should be treated as tiers, not certainty.</span></li>
      </ol>
    </section>
    <section class="caveat-panel">
      <h3>How to interpret the grades</h3>
      <p>This is a draft-day portfolio grade, not a prediction of final standings. Waivers, trades, start/sit decisions, injuries, and projection error will change outcomes. The model intentionally ignores personal Like/Avoid flags so the ranking does not simply repeat the site owner’s preferences.</p>
      <dl><div><dt>Projection snapshot</dt><dd>${escapeHtml(playerData.generatedAt || "2026 preseason")}</dd></div><div><dt>Scoring</dt><dd>${escapeHtml(playerData.scoring || "NYFL half-PPR")}</dd></div><div><dt>Draft source</dt><dd>${escapeHtml(draftData.source)}</dd></div><div><dt>Keeper source</dt><dd>36 final locked keepers, three per team</dd></div></dl>
    </section>
  `;
}

function renderSoon() {
  app.innerHTML = `
    ${sectionIntro("NEXT PHASE", "The draft is over. The season model comes next.", "This space is reserved for features that need real 2026 game data.")}
    <section class="soon-panel">
      <div class="soon-mark">N</div>
      <p>COMING SOON!</p>
      <h2>Draft-to-season performance tracking</h2>
      <span>Weekly actual points versus draft projection, roster moves, keeper ROI, and an end-of-season regrade.</span>
      <div class="soon-grid"><article><b>Weekly scorecard</b><small>Projected versus actual team output</small></article><article><b>Best selections</b><small>Value created above replacement</small></article><article><b>Keeper ROI</b><small>Production earned per round of cost</small></article><article><b>Final regrade</b><small>What the draft really produced</small></article></div>
    </section>
  `;
}

function render() {
  tabs.forEach((button) => button.classList.toggle("active", button.dataset.tab === state.tab));
  if (state.tab === "results") renderResults();
  else if (state.tab === "grades") renderGrades();
  else if (state.tab === "methodology") renderMethodology();
  else renderSoon();
  window.scrollTo({ top: 0, behavior: "auto" });
}

tabs.forEach((button) => button.addEventListener("click", () => { state.tab = button.dataset.tab; render(); }));

async function init() {
  try {
    [draftData, playerData, keeperData] = await Promise.all([
      fetch("./data/draft-results.json").then((response) => response.json()),
      fetch("./data/player-metrics.json").then((response) => response.json()),
      fetch("./data/confirmed-keepers.json").then((response) => response.json()),
    ]);
    report = gradeDraft(draftData, playerData, keeperData);
    dataStamp.textContent = `Model snapshot ${new Date(playerData.generatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
    render();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<section class="error-state"><h2>Draft data could not load.</h2><p>${escapeHtml(error.message)}</p><small>Serve this folder over HTTP or deploy it to Netlify; browsers do not allow JSON fetches from a file:// URL.</small></section>`;
  }
}

init();
