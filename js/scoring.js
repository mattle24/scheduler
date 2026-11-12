import { WEIGHTS, WKND_BUCKET_IMPORTANCE } from './constants.js';
import { slotBucket, dayNum, timeSortKey, addDays } from './utils.js';

function scoreCandidate(schedule, numTeams, slots, weights) {
  const d = scoreDetails(schedule, numTeams, slots);
  let score = 0;
  const W = weights || WEIGHTS;
  for (const key in W) {
    if (d[key] != null) score += d[key] * W[key];
  }
  return score;
}

// Slot-derived values depend only on the slot pool, not the schedule, so they're
// cached per slots array. The optimizer scores the same array thousands of times.
const slotStatsCache = new WeakMap();
function getSlotStats(allSlots) {
  let st = slotStatsCache.get(allSlots);
  if (st) return st;
  const activeWeekends = new Set();
  const activeBuckets = new Set();
  const activeFields = new Set();
  const fieldDateTimes = new Map(); // "field|date" -> sorted weekend time sort keys
  let weekdaySlotCount = 0;
  for (const s of allSlots) {
    if (s.weekendGroup) activeWeekends.add(s.weekendGroup);
    else weekdaySlotCount++;
    activeBuckets.add(slotBucket(s.dayOfWeek, s.time));
    activeFields.add(s.field);
    if (s.dayOfWeek === 0 || s.dayOfWeek === 6) {
      const key = s.field + '|' + s.date;
      if (!fieldDateTimes.has(key)) fieldDateTimes.set(key, []);
      fieldDateTimes.get(key).push(timeSortKey(s.time));
    }
  }
  for (const [, arr] of fieldDateTimes) arr.sort((a, b) => a - b);
  st = { activeWeekends, activeBuckets, activeFields, weekdaySlotCount, fieldDateTimes };
  slotStatsCache.set(allSlots, st);
  return st;
}

// Schedule-independent context for scoring one division: slot stats plus values
// derived from team count and games per team.
function makeScoreContext(numTeams, allSlots, gamesPerTeam) {
  const st = getSlotStats(allSlots);
  const numActiveWeekends = st.activeWeekends.size;
  const maxWeekdayGamesPerTeam = Math.min(gamesPerTeam, Math.floor(st.weekdaySlotCount * 2 / numTeams));
  const minWeekendGamesPerTeam = gamesPerTeam - maxWeekdayGamesPerTeam;
  const minDHPerTeam = Math.max(0, minWeekendGamesPerTeam - numActiveWeekends);
  return {
    numTeams,
    activeWeekends: st.activeWeekends,
    numActiveWeekends,
    activeFields: st.activeFields,
    numFields: st.activeFields.size,
    weekendBuckets: [...st.activeBuckets].filter(b => b === 'WKND_EARLY' || b === 'WKND_MID' || b === 'WKND_LATE'),
    fieldDateTimes: st.fieldDateTimes,
    minWeekendDH: minDHPerTeam * numTeams,
  };
}

// Season start for earlySeasonDensity = earliest scheduled date.
function earlyWindow(minDate) {
  return { start: minDate, cutoff: minDate === undefined ? undefined : addDays(minDate, 6) };
}

// Unrounded per-team penalty contributions. Depends only on this team's games,
// so incremental scorers can recompute just the teams a move touches.
function teamTerms(games, ctx, early) {
  const days = games.map(g => dayNum(g.date)).sort((a, b) => a - b);

  const teamWeekends = new Map();
  for (const g of games) {
    if (g.weekendGroup) teamWeekends.set(g.weekendGroup, (teamWeekends.get(g.weekendGroup) || 0) + 1);
  }
  let sitouts = 0;
  for (const wg of ctx.activeWeekends) if (!teamWeekends.has(wg)) sitouts++;
  // If a team has fewer games than weekends, some sitouts are unavoidable
  const expectedSitouts = Math.max(0, ctx.numActiveWeekends - games.length);
  const weekendSitouts = Math.max(0, sitouts - expectedSitouts);

  let weekendDoubleHeaders = 0;
  for (const c of teamWeekends.values()) if (c > 1) weekendDoubleHeaders += c - 1;

  let gapVariance = 0, shortGapPenalty = 0, shortGapCount = 0, btbCount = 0;
  if (days.length >= 2) {
    const gaps = [];
    for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
    gapVariance = Math.sqrt(variance);
    for (const gap of gaps) {
      if (gap > 0) shortGapPenalty += 1 / gap;
      if (gap < 3) shortGapCount++;
      if (gap === 1) btbCount++;
    }
  }

  // Weighted variance of weekend bucket counts (early/late weighted more than mid)
  let timeDistribution = 0;
  if (ctx.weekendBuckets.length > 1) {
    const bucketCounts = new Map();
    for (const b of ctx.weekendBuckets) bucketCounts.set(b, 0);
    for (const g of games) {
      const b = slotBucket(g.dayOfWeek, g.time);
      if (bucketCounts.has(b)) bucketCounts.set(b, bucketCounts.get(b) + 1);
    }
    const vals = [...bucketCounts.entries()];
    const mean = vals.reduce((a, [, v]) => a + v, 0) / vals.length;
    timeDistribution = vals.reduce((a, [b, v]) => a + (WKND_BUCKET_IMPORTANCE[b] || 1) * (v - mean) ** 2, 0) / vals.length;
  }

  let fieldBalance = 0;
  if (ctx.numFields > 1) {
    const fieldCounts = new Map();
    for (const f of ctx.activeFields) fieldCounts.set(f, 0);
    for (const g of games) fieldCounts.set(g.field, (fieldCounts.get(g.field) || 0) + 1);
    const vals = [...fieldCounts.values()];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    fieldBalance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
  }

  // Pairs of games within 2 days in the first 7 days of the season
  let earlySeasonDensity = 0;
  if (early.start !== undefined) {
    const lo = dayNum(early.start), hi = dayNum(early.cutoff);
    let prev = null;
    for (const d of days) {
      if (d < lo || d > hi) continue;
      if (prev !== null && d - prev <= 2) earlySeasonDensity++;
      prev = d;
    }
  }

  // 2nd day of a Fri/Sat or Sat/Sun back-to-back has an earlier time than the 1st
  let weekendBTBTimePenalty = 0;
  const gameByDay = new Map();
  for (const g of games) {
    const d = dayNum(g.date);
    if (!gameByDay.has(d)) gameByDay.set(d, g);
  }
  for (const g of games) {
    const prevGame = gameByDay.get(dayNum(g.date) - 1);
    if (!prevGame) continue;
    const isFriSat = prevGame.dayOfWeek === 5 && g.dayOfWeek === 6;
    const isSatSun = prevGame.dayOfWeek === 6 && g.dayOfWeek === 0;
    if ((isFriSat || isSatSun) && timeSortKey(g.time) < timeSortKey(prevGame.time)) weekendBTBTimePenalty++;
  }

  let satSunBalance = 0;
  let satCount = 0, sunCount = 0;
  for (const g of games) {
    if (g.dayOfWeek === 6) satCount++;
    if (g.dayOfWeek === 0) sunCount++;
  }
  if (satCount + sunCount > 0) satSunBalance = (satCount / (satCount + sunCount) - 0.5) ** 2;

  return {
    weekendSitouts, weekendDoubleHeaders, gapVariance, shortGapPenalty, shortGapCount,
    timeDistribution, fieldBalance, earlySeasonDensity, weekendBTBTimePenalty, satSunBalance, btbCount,
  };
}

// Variance of per-team short-gap (< 3 days) counts
function shortGapBalanceOf(counts) {
  if (counts.length === 0) return 0;
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  return counts.reduce((a, v) => a + (v - mean) ** 2, 0) / counts.length;
}

// Exponential penalty on (max − min) back-to-back counts across teams
function btbBalanceOf(counts) {
  const spread = Math.max(...counts) - Math.min(...counts);
  return spread === 0 ? 0 : Math.exp(spread) - 1;
}

// One weekend field+date for this division. gameTimes: sorted time sort keys.
// fieldContinuity = available slots left empty between the first and last game;
// loneWeekendGame = 1 if the division has a single game there.
function fieldDateTerms(gameTimes, allTimes) {
  if (gameTimes.length === 1) return { fieldContinuity: 0, loneWeekendGame: 1 };
  let fieldContinuity = 0;
  if (gameTimes.length >= 2 && allTimes) {
    const first = gameTimes[0], last = gameTimes[gameTimes.length - 1];
    const gameSet = new Set(gameTimes);
    for (const t of allTimes) if (t > first && t < last && !gameSet.has(t)) fieldContinuity++;
  }
  return { fieldContinuity, loneWeekendGame: 0 };
}

// Per-team terms summed into metrics, unrounded. Shared by scoreDetails and the
// incremental scorer so both paths compute identical penalties.
const TEAM_SUM_KEYS = ['weekendSitouts', 'weekendDoubleHeaders', 'gapVariance', 'shortGapPenalty',
  'timeDistribution', 'fieldBalance', 'earlySeasonDensity', 'weekendBTBTimePenalty', 'satSunBalance'];

function scoreDetails(schedule, numTeams, allSlots) {
  const ctx = makeScoreContext(numTeams, allSlots, schedule.length * 2 / numTeams);

  const teamGames = [];
  for (let t = 0; t < numTeams; t++) teamGames.push([]);
  let minDate;
  for (const g of schedule) {
    teamGames[g.home].push(g);
    teamGames[g.away].push(g);
    if (minDate === undefined || g.date < minDate) minDate = g.date;
  }
  const early = earlyWindow(minDate);

  const sums = {};
  for (const k of TEAM_SUM_KEYS) sums[k] = 0;
  const shortGapCounts = [], btbCounts = [];
  for (let t = 0; t < numTeams; t++) {
    const tt = teamTerms(teamGames[t], ctx, early);
    for (const k of TEAM_SUM_KEYS) sums[k] += tt[k];
    shortGapCounts.push(tt.shortGapCount);
    btbCounts.push(tt.btbCount);
  }

  // Time-slot spread: extra simultaneous games on the same weekend date+time (umpires)
  let timeSlotSpread = 0;
  const dateTimeCounts = new Map();
  // Weekend field+date → this division's game times
  const fieldDateGameTimes = new Map();
  for (const g of schedule) {
    if (g.dayOfWeek !== 0 && g.dayOfWeek !== 6) continue;
    const dtKey = g.date + '|' + g.time;
    dateTimeCounts.set(dtKey, (dateTimeCounts.get(dtKey) || 0) + 1);
    const fdKey = g.field + '|' + g.date;
    if (!fieldDateGameTimes.has(fdKey)) fieldDateGameTimes.set(fdKey, []);
    fieldDateGameTimes.get(fdKey).push(timeSortKey(g.time));
  }
  for (const c of dateTimeCounts.values()) if (c > 1) timeSlotSpread += c - 1;

  let fieldContinuity = 0, loneWeekendGame = 0;
  for (const [key, times] of fieldDateGameTimes) {
    times.sort((a, b) => a - b);
    const fd = fieldDateTerms(times, ctx.fieldDateTimes.get(key));
    fieldContinuity += fd.fieldContinuity;
    loneWeekendGame += fd.loneWeekendGame;
  }

  const r2 = x => Math.round(x * 100) / 100;
  return {
    weekendSitouts: sums.weekendSitouts,
    weekendDoubleHeaders: sums.weekendDoubleHeaders,
    gapVariance: r2(sums.gapVariance),
    shortGapPenalty: r2(sums.shortGapPenalty),
    shortGapBalance: r2(shortGapBalanceOf(shortGapCounts)),
    timeDistribution: r2(sums.timeDistribution),
    timeSlotSpread: r2(timeSlotSpread),
    fieldBalance: r2(sums.fieldBalance),
    fieldContinuity,
    earlySeasonDensity: sums.earlySeasonDensity,
    btbBalance: r2(btbBalanceOf(btbCounts)),
    loneWeekendGame,
    weekendBTBTimePenalty: sums.weekendBTBTimePenalty,
    satSunBalance: r2(sums.satSunBalance),
    minWeekendDH: ctx.minWeekendDH
  };
}

// ─── Cross-Division Scoring ─────────────────────────────────────────────────
function scoreCrossfieldDivisionClustering(divisionResults) {
  // For each (field, date), collect all games sorted by time across all divisions.
  // Count division switches between consecutive games.
  // A-B-A (switch back) is penalized more heavily than A-B (single switch).
  const fieldDateGames = new Map(); // key: "field|date" -> [{time, division}]
  for (const dr of divisionResults) {
    for (const g of dr.schedule) {
      const key = g.field + '|' + g.date;
      if (!fieldDateGames.has(key)) fieldDateGames.set(key, []);
      fieldDateGames.get(key).push({ timeSortKey: timeSortKey(g.time), division: dr.division.name });
    }
  }

  let penalty = 0;
  for (const [, games] of fieldDateGames) {
    if (games.length < 2) continue;
    games.sort((a, b) => a.timeSortKey - b.timeSortKey);
    for (let i = 1; i < games.length; i++) {
      if (games[i].division !== games[i - 1].division) {
        // Basic switch penalty
        penalty += 1;
        // Extra penalty for A-B-A pattern (switching back)
        if (i >= 2 && games[i].division === games[i - 2].division) {
          penalty += 3; // much heavier for back-and-forth
        }
      }
    }
  }
  return penalty;
}

// Count weekend games for each division that share a field+date with any other division.
// Returned value is the total count of such games across all divisions.
// Note: a field+date used by N divisions contributes N games (one per division).
function scoreWeekendOtherDivField(divisionResults) {
  // Build map: "field|date" → set of division names with games there
  const fieldDateDivs = new Map();
  for (const dr of divisionResults) {
    for (const g of dr.schedule) {
      if (g.dayOfWeek !== 0 && g.dayOfWeek !== 6) continue;
      const key = g.field + '|' + g.date;
      if (!fieldDateDivs.has(key)) fieldDateDivs.set(key, new Set());
      fieldDateDivs.get(key).add(dr.division.name);
    }
  }
  // For each division, count its games on field+dates that other divisions also use
  let penalty = 0;
  for (const dr of divisionResults) {
    const seen = new Set();
    for (const g of dr.schedule) {
      if (g.dayOfWeek !== 0 && g.dayOfWeek !== 6) continue;
      const key = g.field + '|' + g.date;
      if (seen.has(key)) continue; // count once per field+date per division
      seen.add(key);
      const divs = fieldDateDivs.get(key);
      if (divs && divs.size > 1) penalty++;
    }
  }
  return penalty;
}

// Cross-division penalties for one division's schedule against other divisions'
// games (each tagged with `division`). Lets per-division optimizers see the same
// cross-division terms that globalScore uses. Constant other-vs-other terms are
// included too; they cancel out in score deltas.
function scoreCrossDivision(schedule, otherGames, weights) {
  if (!otherGames || otherGames.length === 0) return 0;
  const W = weights || WEIGHTS;
  const wClust = W.fieldDivisionClustering || 0;
  const wOther = W.weekendOtherDivField || 0;
  if (!wClust && !wOther) return 0;
  const byDiv = new Map();
  byDiv.set('\u0000self', []);
  for (const g of schedule) byDiv.get('\u0000self').push(g);
  for (const g of otherGames) {
    const name = g.division || '\u0000other';
    if (!byDiv.has(name)) byDiv.set(name, []);
    byDiv.get(name).push(g);
  }
  const drs = [...byDiv].map(([name, sched]) => ({ division: { name }, schedule: sched }));
  let score = 0;
  if (wClust) score += scoreCrossfieldDivisionClustering(drs) * wClust;
  if (wOther) score += scoreWeekendOtherDivField(drs) * wOther;
  return score;
}

export { makeScoreContext, earlyWindow, teamTerms, fieldDateTerms, shortGapBalanceOf, btbBalanceOf, TEAM_SUM_KEYS,
  scoreCandidate, scoreCrossDivision, scoreDetails, scoreCrossfieldDivisionClustering, scoreWeekendOtherDivField };
