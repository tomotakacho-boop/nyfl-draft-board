export const GRADE_WEIGHTS = {
  lineup: 25,
  capital: 20,
  depth: 15,
  construction: 10,
  upside: 10,
  durability: 10,
  scarcity: 5,
  future: 5,
};

const STARTER_SHAPE = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1 };
const SKILL_POSITIONS = new Set(["RB", "WR", "TE"]);

export function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

export function normalizeName(value = "") {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

export function snakePick(round, teams, slot) {
  return (round - 1) * teams + (round % 2 === 1 ? slot : teams + 1 - slot);
}

export function gradeLetter(score) {
  if (score >= 97) return "A+";
  if (score >= 93) return "A";
  if (score >= 90) return "A−";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B−";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C−";
  if (score >= 65) return "D";
  return "F";
}

function percentileMap(players, selector, descending = true) {
  const usable = players
    .filter((player) => Number.isFinite(selector(player)))
    .slice()
    .sort((a, b) => descending ? selector(b) - selector(a) : selector(a) - selector(b));
  const map = new Map();
  usable.forEach((player, index) => {
    const percentile = usable.length <= 1 ? 100 : 100 - (index / (usable.length - 1)) * 100;
    map.set(player.id, percentile);
  });
  return map;
}

function average(values, divisor = values.length) {
  if (!divisor) return 0;
  return values.reduce((sum, value) => sum + value, 0) / divisor;
}

function buildPlayerModel(players, pick, keeper) {
  const player = pick.player;
  const maxRank = Math.max(240, ...players.map((candidate) => Number(candidate.rank) || 0));
  const rankQuality = clamp(100 - ((Math.max(1, Number(player.rank) || maxRank) - 1) / Math.max(1, maxRank - 1)) * 100);
  const peers = players.filter((candidate) => candidate.pos === player.pos);
  const positionPercentiles = percentileMap(peers, (candidate) => Number(candidate.projectedPPG));
  const positionProjection = positionPercentiles.get(player.id) ?? rankQuality;
  const confidence = clamp(100 - (Number(player.rankStdDev) || 22.5) * 2);
  const marketInputs = [player.rank, player.adp].map(Number).filter(Number.isFinite);
  const marketRank = marketInputs.length ? average(marketInputs) : maxRank;
  const acquisition = clamp(65 + (pick.overall - marketRank) * 0.8);
  const dynastyQuality = Number.isFinite(Number(player.dynastyRank))
    ? clamp(100 - ((Number(player.dynastyRank) - 1) / 239) * 100)
    : rankQuality * 0.55;
  const rookieBonus = Number.isFinite(Number(player.rookieRank)) ? clamp(14 - (Number(player.rookieRank) - 1) * 0.18, 0, 14) : 0;
  const immediate = ["K", "DST"].includes(player.pos)
    ? clamp(positionProjection * 0.75 + confidence * 0.25)
    : clamp(positionProjection * 0.55 + rankQuality * 0.25 + confidence * 0.20);
  const winnerBonus = player.leagueWinner ? 13 : 0;
  const diamondBonus = Number(player.potentialDiamondScore) ? Math.min(11, Number(player.potentialDiamondScore) * 0.11) : 0;
  const upside = clamp(positionProjection * 0.40 + rankQuality * 0.22 + dynastyQuality * 0.20 + rookieBonus + winnerBonus + diamondBonus);
  const defaultRisk = player.pos === "RB" ? 34 : player.pos === "WR" ? 28 : ["QB", "TE"].includes(player.pos) ? 23 : 16;
  const injuryRisk = Number.isFinite(Number(player.injuryRiskScore)) ? Number(player.injuryRiskScore) : defaultRisk;
  const durability = clamp(100 - injuryRisk);
  const scarcityBonus = player.pos === "TE" ? 10 : player.pos === "QB" ? 7 : 0;
  const scarcity = clamp(positionProjection * 0.82 + rankQuality * 0.18 + scarcityBonus);
  const roundLeverage = clamp(((pick.round - 1) / 15) * 100);
  const future = ["K", "DST"].includes(player.pos)
    ? 5
    : clamp(dynastyQuality * 0.50 + upside * 0.25 + roundLeverage * 0.25 + (keeper ? 5 : 0));
  const playerGrade = clamp(immediate * 0.32 + acquisition * 0.24 + upside * 0.15 + durability * 0.13 + scarcity * 0.08 + future * 0.08);

  return {
    ...pick,
    keeper,
    marketRank,
    rankQuality,
    positionProjection,
    confidence,
    immediate,
    acquisition,
    upside,
    durability,
    scarcity,
    future,
    playerGrade,
    role: "Bench",
    starter: false,
    contributions: { lineup: 0, capital: 0, depth: 0, upside: 0, durability: 0, scarcity: 0, future: 0 },
  };
}

function assignStarters(roster) {
  const selected = new Set();
  const take = (position, count, role) => {
    roster
      .filter((entry) => entry.player.pos === position && !selected.has(entry.player.id))
      .sort((a, b) => b.immediate - a.immediate)
      .slice(0, count)
      .forEach((entry, index) => {
        selected.add(entry.player.id);
        entry.starter = true;
        entry.role = count > 1 ? `${role}${index + 1}` : role;
      });
  };
  take("QB", STARTER_SHAPE.QB, "QB");
  take("RB", STARTER_SHAPE.RB, "RB");
  take("WR", STARTER_SHAPE.WR, "WR");
  take("TE", STARTER_SHAPE.TE, "TE");
  roster
    .filter((entry) => SKILL_POSITIONS.has(entry.player.pos) && !selected.has(entry.player.id))
    .sort((a, b) => b.immediate - a.immediate)
    .slice(0, STARTER_SHAPE.FLEX)
    .forEach((entry) => { selected.add(entry.player.id); entry.starter = true; entry.role = "FLEX"; });
  take("DST", STARTER_SHAPE.DST, "D/ST");
  take("K", STARTER_SHAPE.K, "K");
  return selected;
}

function constructionScore(roster) {
  const counts = roster.reduce((result, entry) => {
    result[entry.player.pos] = (result[entry.player.pos] || 0) + 1;
    return result;
  }, {});
  let score = 100;
  score -= Math.max(0, 1 - (counts.QB || 0)) * 18;
  score -= Math.max(0, 3 - (counts.RB || 0)) * 10;
  score -= Math.max(0, 3 - (counts.WR || 0)) * 10;
  score -= Math.max(0, 1 - (counts.TE || 0)) * 15;
  score -= Math.max(0, 1 - (counts.DST || 0)) * 10;
  score -= Math.max(0, 1 - (counts.K || 0)) * 10;
  score -= Math.max(0, (counts.QB || 0) - 2) * 7;
  score -= Math.max(0, (counts.TE || 0) - 2) * 5;
  score -= Math.max(0, (counts.DST || 0) - 1) * 10;
  score -= Math.max(0, (counts.K || 0) - 1) * 10;
  score -= Math.max(0, 9 - ((counts.RB || 0) + (counts.WR || 0))) * 3;
  return clamp(score);
}

function gradeTeam(team, players, keepers, teamCount) {
  const keeperSet = new Set(
    keepers
      .filter((entry) => entry.team === team.team)
      .map((entry) => `${normalizeName(entry.player)}|${entry.round}`),
  );
  const playerByBoardName = new Map(players.map((player) => [normalizeName(player.boardName || player.name), player]));
  const roster = team.picks.map((name, index) => {
    const round = index + 1;
    const player = playerByBoardName.get(normalizeName(name));
    if (!player) throw new Error(`No grading metrics found for ${team.team}: ${name}`);
    const overall = snakePick(round, teamCount, team.slot);
    return buildPlayerModel(players, { player, round, overall }, keeperSet.has(`${normalizeName(name)}|${round}`));
  });

  const starterIds = assignStarters(roster);
  const starters = roster.filter((entry) => starterIds.has(entry.player.id));
  const depth = roster
    .filter((entry) => !entry.starter && !["K", "DST"].includes(entry.player.pos))
    .map((entry) => ({ entry, score: clamp(entry.immediate * 0.62 + entry.acquisition * 0.38) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const upsideCore = roster.slice().sort((a, b) => b.upside - a.upside).slice(0, 8);
  const futureCore = roster.slice().sort((a, b) => b.future - a.future).slice(0, 5);

  const lineup = average(starters.map((entry) => entry.immediate), 9);
  const capital = average(roster.map((entry) => entry.acquisition), 16);
  const depthScore = average(depth.map((item) => item.score), 5);
  const construction = constructionScore(roster);
  const upside = average(upsideCore.map((entry) => entry.upside), 8);
  const durability = average(roster.map((entry) => entry.durability), 16);
  const scarcity = average(starters.map((entry) => entry.scarcity), 9);
  const future = average(futureCore.map((entry) => entry.future), 5);

  roster.forEach((entry) => {
    entry.contributions.lineup = entry.starter ? entry.immediate / 100 * GRADE_WEIGHTS.lineup / 9 : 0;
    entry.contributions.capital = entry.acquisition / 100 * GRADE_WEIGHTS.capital / 16;
    const depthEntry = depth.find((item) => item.entry.player.id === entry.player.id);
    entry.contributions.depth = depthEntry ? depthEntry.score / 100 * GRADE_WEIGHTS.depth / 5 : 0;
    entry.contributions.upside = upsideCore.some((candidate) => candidate.player.id === entry.player.id) ? entry.upside / 100 * GRADE_WEIGHTS.upside / 8 : 0;
    entry.contributions.durability = entry.durability / 100 * GRADE_WEIGHTS.durability / 16;
    entry.contributions.scarcity = entry.starter ? entry.scarcity / 100 * GRADE_WEIGHTS.scarcity / 9 : 0;
    entry.contributions.future = futureCore.some((candidate) => candidate.player.id === entry.player.id) ? entry.future / 100 * GRADE_WEIGHTS.future / 5 : 0;
    entry.contribution = Object.values(entry.contributions).reduce((sum, value) => sum + value, 0);
  });

  const components = { lineup, capital, depth: depthScore, construction, upside, durability, scarcity, future };
  const baseScore = Object.entries(GRADE_WEIGHTS).reduce((sum, [key, weight]) => sum + components[key] * weight / 100, 0);
  return { ...team, roster, components, baseScore, constructionContribution: construction * GRADE_WEIGHTS.construction / 100 };
}

export function gradeDraft(draftData, playerData, keeperData) {
  const teams = draftData.teams.map((team) => gradeTeam(team, playerData.players, keeperData.keepers, draftData.teams.length));
  const mean = average(teams.map((team) => team.baseScore));
  const variance = average(teams.map((team) => (team.baseScore - mean) ** 2));
  const standardDeviation = Math.sqrt(variance) || 1;
  const graded = teams
    .map((team) => {
      const absoluteQualityScore = clamp(team.baseScore + 15);
      const leagueRelativeScore = clamp(82 + ((team.baseScore - mean) / standardDeviation) * 10);
      const grade = clamp(absoluteQualityScore * 0.60 + leagueRelativeScore * 0.40);
      return { ...team, absoluteQualityScore, leagueRelativeScore, grade, letter: gradeLetter(grade) };
    })
    .sort((a, b) => b.grade - a.grade)
    .map((team, index) => ({ ...team, rank: index + 1 }));
  return { teams: graded, mean, standardDeviation, weights: GRADE_WEIGHTS };
}
