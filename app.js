import { GRADE_WEIGHTS, gradeDraft, snakePick } from "./model.js";

const app = document.querySelector("#app");
const dataStamp = document.querySelector("#dataStamp");
const tabs = [...document.querySelectorAll("[data-tab]")];

const state = {
  tab: "results",
  boardSort: "slot",
  focusedTeam: "ALL",
  gradeTeam: null,
  betType: "ALL",
  betStatus: "ALL",
  betParticipant: "ALL",
  groupChatView: "ALL",
  groupChatSearch: "",
};

let draftData;
let playerData;
let keeperData;
let sideBetData;
let groupChatData;
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
  return draftData.teams.slice().sort((a, b) => a.slot - b.slot);
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

  const rosterRoleOrder = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX", "D/ST", "K"];
  const visibleRosterTeams = focused ? teams.filter((team) => team.team === focused.team) : teams;
  const rosterCards = visibleRosterTeams.map((team) => {
    const teamReport = report.teams.find((entry) => entry.team === team.team);
    const starters = teamReport.roster
      .filter((entry) => entry.starter)
      .slice()
      .sort((a, b) => rosterRoleOrder.indexOf(a.role) - rosterRoleOrder.indexOf(b.role));
    const bench = teamReport.roster.filter((entry) => !entry.starter).slice().sort((a, b) => a.round - b.round);
    const rosterRow = (entry, slot) => `<div class="roster-player ${entry.keeper ? "keeper-player" : ""}">
      <b>${escapeHtml(slot)}</b>
      <span>${positionTag(entry.player.pos)}</span>
      <div><strong>${escapeHtml(entry.player.boardName || entry.player.name)}</strong><small>${escapeHtml(entry.player.team || "FA")} · R${entry.round}${entry.player.projectedPPG == null ? "" : ` · ${oneDecimal(entry.player.projectedPPG)} PPG`}</small></div>
      ${entry.keeper ? "<em>KEEPER</em>" : ""}
    </div>`;
    return `<article class="roster-card">
      <header><div><span>#${team.slot}</span><h3>${escapeHtml(team.team)}</h3><small>${escapeHtml(team.manager)}</small></div><b>${oneDecimal(teamReport.grade)}<small>${teamReport.letter}</small></b></header>
      <section><p>PROJECTED STARTING LINEUP</p>${starters.map((entry) => rosterRow(entry, entry.role)).join("")}</section>
      <section class="roster-bench"><p>BENCH</p>${bench.map((entry, index) => rosterRow(entry, `BE${index + 1}`)).join("")}</section>
    </article>`;
  }).join("");

  app.innerHTML = `
    ${sectionIntro("FINAL DRAFT BOARD", "Every 2026 NYFL selection, in its original round", "Switch between the physical draft board and lineup-based team rosters. Use Team Focus for a one-club audit.")}
    <section class="summary-strip">
      <article><span>TEAMS</span><b>${draftData.teams.length}</b></article>
      <article><span>ROUNDS</span><b>${draftData.rounds}</b></article>
      <article><span>TOTAL PICKS</span><b>${totalPicks}</b></article>
      <article><span>LOCKED KEEPERS</span><b>${keeperData.keepers.length}</b></article>
    </section>
    <section class="board-controls" aria-label="Draft result controls">
      <div><span>VIEW RESULTS AS</span><button type="button" data-board-sort="slot" class="${state.boardSort === "slot" ? "active" : ""}">Draft board</button><button type="button" data-board-sort="roster" class="${state.boardSort === "roster" ? "active" : ""}">Team rosters</button></div>
      <label><span>TEAM FOCUS</span><select id="teamFocus"><option value="ALL">All teams</option>${draftData.teams.slice().sort((a,b) => a.team.localeCompare(b.team)).map((team) => `<option value="${escapeHtml(team.team)}" ${state.focusedTeam === team.team ? "selected" : ""}>#${team.slot} ${escapeHtml(team.team)}</option>`).join("")}</select></label>
    </section>
    ${state.boardSort === "roster" ? `<section class="roster-view" aria-label="NYFL team rosters">
      <header><div><p>ROSTER VIEW</p><h3>${focused ? escapeHtml(focused.team) : "All 12 projected starting lineups"}</h3></div><span>Starters are selected by the grading model from each drafted roster. Bench players remain listed in original draft-round order.</span></header>
      <div class="roster-grid">${rosterCards}</div>
    </section>` : `<section class="draft-board-shell" aria-label="2026 NYFL final draft board">
      <table class="draft-board-table">
        <thead><tr><th>ROUND</th>${teams.map((team) => `<th><span>#${team.slot}</span><strong>${escapeHtml(team.team)}</strong><small>${escapeHtml(team.manager)}</small></th>`).join("")}</tr></thead>
        <tbody>${boardRows}</tbody>
      </table>
    </section>`}
    ${focused && state.boardSort === "slot" ? `<section class="team-focus-panel">
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

  const componentOrder = Object.entries(selected.components).sort((a, b) => b[1] - a[1]);
  const strongestComponents = componentOrder.slice(0, 2).map(([key]) => categoryLabels[key].toLowerCase());
  const weakestComponent = componentOrder.at(-1);
  const anchors = selected.roster.slice().sort((a, b) => b.playerGrade - a.playerGrade).slice(0, 3);
  const bestValue = selected.roster
    .filter((entry) => !["K", "DST"].includes(entry.player.pos))
    .slice()
    .sort((a, b) => b.acquisition - a.acquisition)[0];
  const keeperCore = selected.roster.filter((entry) => entry.keeper);
  const rosterAverage = selected.roster.reduce((sum, entry) => sum + entry.playerGrade, 0) / selected.roster.length;
  const keeperAverage = keeperCore.length ? keeperCore.reduce((sum, entry) => sum + entry.playerGrade, 0) / keeperCore.length : rosterAverage;
  const keeperComparison = keeperAverage > rosterAverage + 2 ? "outperformed" : keeperAverage < rosterAverage - 2 ? "trailed" : "roughly matched";
  const rankTier = selected.rank <= 3 ? "the league’s top draft tier" : selected.rank <= 6 ? "the upper half of the league" : selected.rank <= 9 ? "the middle tier of the league" : "the bottom quarter of the draft grades";
  const draftBlurb = `<p><strong>${escapeHtml(selected.team)}</strong> finished <b>#${selected.rank} of 12</b> with a <b>${oneDecimal(selected.grade)} (${selected.letter})</b>, placing this roster in ${rankTier}. ${anchors.map((entry) => escapeHtml(entry.player.boardName || entry.player.name)).join(", ")} produced its three strongest individual portfolio grades. The build scored best in ${escapeHtml(strongestComponents[0])} and ${escapeHtml(strongestComponents[1])}; ${escapeHtml(categoryLabels[weakestComponent[0]].toLowerCase())} was the clearest drag at ${oneDecimal(weakestComponent[1])}. ${bestValue ? `<strong>${escapeHtml(bestValue.player.boardName || bestValue.player.name)}</strong> was the strongest modeled price result at Round ${bestValue.round} versus a blended market rank of ${oneDecimal(bestValue.marketRank)}.` : ""}</p>${keeperCore.length ? `<p>The keeper core of ${keeperCore.map((entry) => escapeHtml(entry.player.boardName || entry.player.name)).join(", ")} ${keeperComparison} the roster’s average player grade when evaluated at the actual locked round costs.</p>` : ""}`;

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
      <section class="draft-blurb"><span>DRAFT RECAP</span>${draftBlurb}</section>
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

function renderSideBets() {
  const allBets = sideBetData.bets;
  const participants = [...new Set(allBets.flatMap((bet) => [bet.participantA, bet.participantB]))].sort((a, b) => a.localeCompare(b));
  const visibleBets = allBets.filter((bet) => {
    const typeMatch = state.betType === "ALL" || bet.type === state.betType;
    const statusMatch = state.betStatus === "ALL" || (state.betStatus === "RESOLVED" ? bet.resolved : !bet.resolved);
    const participantMatch = state.betParticipant === "ALL" || bet.participantA === state.betParticipant || bet.participantB === state.betParticipant;
    return typeMatch && statusMatch && participantMatch;
  });
  const cashAtStake = allBets.filter((bet) => bet.stakeKind === "cash").reduce((sum, bet) => sum + Number(bet.stakeAmount || 0), 0);
  const equityAtStake = allBets.filter((bet) => bet.stakeKind === "equity").reduce((sum, bet) => sum + Number(bet.stakeAmount || 0), 0);
  const seasonCount = allBets.filter((bet) => bet.type === "season").length;
  const matchupCount = allBets.filter((bet) => bet.type === "matchup").length;

  const cards = visibleBets.map((bet) => {
    const typeLabel = bet.type === "season" ? "SEASON" : `WK ${bet.week}`;
    return `<article class="bet-card ${bet.resolved ? "resolved" : ""}">
      <div class="bet-card-top">
        <span class="bet-type ${bet.type}">${escapeHtml(typeLabel)}</span>
        <span class="bet-status">${bet.resolved ? "RESOLVED" : escapeHtml(bet.status.toUpperCase())}</span>
        <strong>${escapeHtml(bet.stakeDisplay)}</strong>
      </div>
      <h3>${escapeHtml(bet.participantA)} <span>vs</span> ${escapeHtml(bet.participantB)}</h3>
      ${bet.tiebreaker ? `<p><b>Tiebreaker:</b> ${escapeHtml(bet.tiebreaker)}</p>` : `<p class="bet-context">Head-to-head matchup · Week ${bet.week}</p>`}
      ${bet.note ? `<blockquote>“${escapeHtml(bet.note)}”</blockquote>` : ""}
      <footer><span>${bet.resolved ? "Final result recorded" : "Active for 2026"}</span><small>${escapeHtml(bet.id)}</small></footer>
    </article>`;
  }).join("");

  app.innerHTML = `
    ${sectionIntro("LEAGUE BULLETIN", "Season-long stakes and weekly matchup action", "A repository-backed ledger of accepted NYFL side bets. Use the filters to isolate a bet type, status, or participant.")}
    <section class="bet-summary">
      <article><span>ACCEPTED BETS</span><b>${allBets.length}</b></article>
      <article><span>CASH AT STAKE</span><b>$${cashAtStake.toLocaleString()}</b></article>
      <article><span>EQUITY AT STAKE</span><b>${equityAtStake} CRCL</b><small>shares settled at season end</small></article>
      <article><span>BET MIX</span><b>${seasonCount} / ${matchupCount}</b><small>season / weekly</small></article>
    </section>
    <section class="bet-controls" aria-label="Side bet filters">
      <label><span>BET TYPE</span><select id="betTypeFilter"><option value="ALL">All types</option><option value="season" ${state.betType === "season" ? "selected" : ""}>Season-long</option><option value="matchup" ${state.betType === "matchup" ? "selected" : ""}>Weekly matchup</option></select></label>
      <label><span>STATUS</span><select id="betStatusFilter"><option value="ALL">Active & resolved</option><option value="ACTIVE" ${state.betStatus === "ACTIVE" ? "selected" : ""}>Active</option><option value="RESOLVED" ${state.betStatus === "RESOLVED" ? "selected" : ""}>Resolved</option></select></label>
      <label><span>PARTICIPANT</span><select id="betParticipantFilter"><option value="ALL">All participants</option>${participants.map((name) => `<option value="${escapeHtml(name)}" ${state.betParticipant === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>
      <button type="button" id="resetBetFilters">Reset filters</button>
    </section>
    <section class="bet-results-meta"><b>${visibleBets.length}</b><span>of ${allBets.length} bets shown</span></section>
    <section class="bet-grid">${cards || `<div class="empty-bets"><h3>No bets match these filters.</h3><p>Reset the filters to return to the full ledger.</p></div>`}</section>
    <section class="bet-ledger-note"><b>Ledger source</b><span>${escapeHtml(sideBetData.source)} · updated ${escapeHtml(sideBetData.asOf)}</span><p>Resolved winners and settlement details can be added to <code>data/side-bets.json</code> without changing the page layout.</p></section>
  `;

  document.querySelector("#betTypeFilter")?.addEventListener("change", (event) => { state.betType = event.target.value; renderSideBets(); });
  document.querySelector("#betStatusFilter")?.addEventListener("change", (event) => { state.betStatus = event.target.value; renderSideBets(); });
  document.querySelector("#betParticipantFilter")?.addEventListener("change", (event) => { state.betParticipant = event.target.value; renderSideBets(); });
  document.querySelector("#resetBetFilters")?.addEventListener("click", () => { state.betType = "ALL"; state.betStatus = "ALL"; state.betParticipant = "ALL"; renderSideBets(); });
}

function groupChatImageCard(item) {
  const bucketLabel = item.bucket === "memes" ? "MEME" : "OTHER IMAGE";
  const confidence = item.classificationConfidence == null ? "" : `${Math.round(item.classificationConfidence * 100)}% auto confidence`;
  return `<article class="chat-image-card">
    <a href="${escapeHtml(item.src)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.caption || `${bucketLabel} shared by ${item.sender || "group member"}`)}" loading="lazy"></a>
    <div class="chat-card-meta"><span class="chat-bucket ${item.bucket}">${bucketLabel}</span>${item.hahaCount >= 6 ? `<b>HAHA × ${item.hahaCount}</b>` : ""}</div>
    <h3>${escapeHtml(item.caption || "Image shared without a caption")}</h3>
    <p>${escapeHtml(item.sender || "Unknown sender")} · ${escapeHtml(item.timestampDisplay || item.timestamp || "Unknown time")}</p>
    ${confidence ? `<small>${escapeHtml(confidence)}</small>` : ""}
  </article>`;
}

function renderGroupChat() {
  const data = groupChatData || { memes: [], otherImages: [], xLinks: [], popularMessages: [] };
  const memes = data.memes || [];
  const otherImages = data.otherImages || [];
  const links = data.xLinks || [];
  const popular = data.popularMessages || [];
  const normalizedSearch = normalize(state.groupChatSearch);
  const matchesSearch = (...values) => !normalizedSearch || values.some((value) => normalize(value).includes(normalizedSearch));
  const filteredMemes = memes.filter((item) => matchesSearch(item.caption, item.sender, item.timestampDisplay));
  const filteredOther = otherImages.filter((item) => matchesSearch(item.caption, item.sender, item.timestampDisplay));
  const filteredLinks = links.filter((item) => matchesSearch(item.url, item.message, item.sender, item.timestampDisplay));
  const filteredPopular = popular.filter((item) => matchesSearch(item.text, item.sender, item.timestampDisplay));
  const show = (view) => state.groupChatView === "ALL" || state.groupChatView === view;
  const configured = Boolean(data.generatedAt);

  app.innerHTML = `
    ${sectionIntro("GROUP CHAT ARCHIVE", "The weekly greatest hits, without the scrollback", "Images are separated into memes and other photos; X links and messages earning at least six active Haha Tapbacks are indexed with sender and time.")}
    <section class="chat-privacy-note"><b>PRIVATE CONTENT CHECK</b><span>This tab is deployed with the website. Only publish material the group has agreed may appear here, and keep the repository/site private if the conversation is private.</span></section>
    <section class="chat-summary">
      <article><span>MEMES</span><b>${memes.length}</b><small>web copies</small></article>
      <article><span>OTHER IMAGES</span><b>${otherImages.length}</b><small>web copies</small></article>
      <article><span>X LINKS</span><b>${links.length}</b><small>deduplicated</small></article>
      <article><span>6+ HAHA</span><b>${popular.length}</b><small>active Tapbacks</small></article>
      <article><span>LAST SCAN</span><b class="chat-date">${configured ? escapeHtml(data.generatedAtDisplay || new Date(data.generatedAt).toLocaleString()) : "NOT RUN"}</b><small>${escapeHtml(data.chat?.displayName || "chat not configured")}</small></article>
    </section>
    <section class="chat-controls" aria-label="Group chat archive filters">
      <div>${[
        ["ALL", "Everything"], ["MEMES", "Memes"], ["OTHER", "Other images"], ["LINKS", "X links"], ["POPULAR", "6+ Haha"],
      ].map(([value, label]) => `<button type="button" data-chat-view="${value}" class="${state.groupChatView === value ? "active" : ""}">${label}</button>`).join("")}</div>
      <label><span>SEARCH ARCHIVE</span><input id="groupChatSearch" type="search" value="${escapeHtml(state.groupChatSearch)}" placeholder="Sender, caption, message, or link…"></label>
    </section>
    ${!configured ? `<section class="chat-setup-state">
      <span>WEEKLY PIPELINE READY</span><h3>No group-chat export has been published yet.</h3>
      <p>Configure the target chat locally, grant Full Disk Access, run the extractor once, review the two image buckets, and then publish the generated web index.</p>
      <ol><li>Copy <code>scripts/group-chat-config.example.json</code> to <code>.group-chat-config.json</code>.</li><li>Add the exact chat name or participant identifiers.</li><li>Run <code>python3 scripts/imessage_group_chat_export.py --config .group-chat-config.json</code>.</li><li>Review the local archive, then commit only the generated website files you intend to share.</li></ol>
    </section>` : ""}
    ${show("MEMES") ? `<section class="chat-section"><header><div><p>IMAGE BUCKET 01</p><h3>Memes</h3></div><span>${filteredMemes.length} shown</span></header><div class="chat-image-grid">${filteredMemes.map(groupChatImageCard).join("") || `<p class="chat-empty">No memes match this view.</p>`}</div></section>` : ""}
    ${show("OTHER") ? `<section class="chat-section"><header><div><p>IMAGE BUCKET 02</p><h3>Other images</h3></div><span>${filteredOther.length} shown</span></header><div class="chat-image-grid">${filteredOther.map(groupChatImageCard).join("") || `<p class="chat-empty">No other images match this view.</p>`}</div></section>` : ""}
    ${show("LINKS") ? `<section class="chat-section"><header><div><p>LINK LEDGER</p><h3>X.com links</h3></div><span>${filteredLinks.length} shown</span></header><div class="chat-link-list">${filteredLinks.map((item) => `<article><div><span>${escapeHtml(item.sender || "Unknown sender")}</span><small>${escapeHtml(item.timestampDisplay || item.timestamp || "Unknown time")}</small></div><p>${escapeHtml(item.message || "Link shared without accompanying text")}</p><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open on X ↗</a></article>`).join("") || `<p class="chat-empty">No X links match this view.</p>`}</div></section>` : ""}
    ${show("POPULAR") ? `<section class="chat-section"><header><div><p>GROUP-APPROVED</p><h3>Messages with 6+ Haha Tapbacks</h3></div><span>${filteredPopular.length} shown</span></header><div class="chat-popular-list">${filteredPopular.map((item) => `<article><b>${item.hahaCount}<small>HAHA</small></b><div><blockquote>${escapeHtml(item.text || "Attachment-only message")}</blockquote><p>${escapeHtml(item.sender || "Unknown sender")} · ${escapeHtml(item.timestampDisplay || item.timestamp || "Unknown time")}</p>${item.xLinks?.length ? `<div>${item.xLinks.map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">X link ↗</a>`).join("")}</div>` : ""}</div></article>`).join("") || `<p class="chat-empty">No messages currently have six active Haha Tapbacks.</p>`}</div></section>` : ""}
  `;

  document.querySelectorAll("[data-chat-view]").forEach((button) => button.addEventListener("click", () => { state.groupChatView = button.dataset.chatView; renderGroupChat(); }));
  document.querySelector("#groupChatSearch")?.addEventListener("change", (event) => { state.groupChatSearch = event.target.value; renderGroupChat(); });
}

function render() {
  tabs.forEach((button) => button.classList.toggle("active", button.dataset.tab === state.tab));
  if (state.tab === "results") renderResults();
  else if (state.tab === "grades") renderGrades();
  else if (state.tab === "side-bets") renderSideBets();
  else if (state.tab === "group-chat") renderGroupChat();
  else if (state.tab === "methodology") renderMethodology();
  else renderSoon();
  window.scrollTo({ top: 0, behavior: "auto" });
}

tabs.forEach((button) => button.addEventListener("click", () => { state.tab = button.dataset.tab; render(); }));

async function init() {
  try {
    [draftData, playerData, keeperData, sideBetData, groupChatData] = await Promise.all([
      fetch("./data/draft-results.json").then((response) => response.json()),
      fetch("./data/player-metrics.json").then((response) => response.json()),
      fetch("./data/confirmed-keepers.json").then((response) => response.json()),
      fetch("./data/side-bets.json").then((response) => response.json()),
      fetch("./data/group-chat.json").then((response) => response.json()),
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
