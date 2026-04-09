import { WEIGHTS, WKND_BUCKET_IMPORTANCE } from './constants.js';
import { slotBucket, daysBetween, timeSortKey, addDays } from './utils.js';

function scoreCandidate(schedule, numTeams, slots, weights) {
  const d = scoreDetails(schedule, numTeams, slots);
  let score = 0;
  const W = weights || WEIGHTS;
  for (const key in W) {
    if (d[key] != null) score += d[key] * W[key];
  }
  return score;
}

function scoreDetails(schedule, numTeams, allSlots) {
  const gamesPerTeam = schedule.length * 2 / numTeams;

  const teamGames = new Map();
  for (let t = 0; t < numTeams; t++) teamGames.set(t, []);
  for (const g of schedule) {
    teamGames.get(g.home).push(g);
    teamGames.get(g.away).push(g);
  }

  const teamSortedDates = new Map();
  for (let t = 0; t < numTeams; t++) {
    teamSortedDates.set(t, teamGames.get(t).map(g => g.date).sort());
  }

  const activeWeekends = new Set();
  for (const s of allSlots) {
    if (s.weekendGroup) activeWeekends.add(s.weekendGroup);
  }
  const numActiveWeekends = activeWeekends.size;

  const activeBuckets = new Set();
  for (const s of allSlots) activeBuckets.add(slotBucket(s.dayOfWeek, s.time));

  const activeFields = new Set();
  for (const s of allSlots) activeFields.add(s.field);
  const numFields = activeFields.size;

  const weekdaySlotCount = allSlots.filter(s => !s.weekendGroup).length;

  let weekendSitouts = 0;
  for (let t = 0; t < numTeams; t++) {
    const teamWeekends = new Set();
    for (const g of teamGames.get(t)) {
      if (g.weekendGroup) teamWeekends.add(g.weekendGroup);
    }
    let sitouts = 0;
    for (const wg of activeWeekends) {
      if (!teamWeekends.has(wg)) sitouts++;
    }
    // If a team has fewer games than weekends, some sitouts are unavoidable
    const totalGames = teamGames.get(t).length;
    const expectedSitouts = Math.max(0, numActiveWeekends - totalGames);
    weekendSitouts += Math.max(0, sitouts - expectedSitouts);
  }

  let weekendDoubleHeaders = 0;
  for (let t = 0; t < numTeams; t++) {
    const wgCount = new Map();
    for (const g of teamGames.get(t)) {
      if (g.weekendGroup) wgCount.set(g.weekendGroup, (wgCount.get(g.weekendGroup) || 0) + 1);
    }
    for (const [, c] of wgCount) {
      if (c > 1) weekendDoubleHeaders += c - 1;
    }
  }
  const maxWeekdayGamesPerTeam = Math.min(gamesPerTeam, Math.floor(weekdaySlotCount * 2 / numTeams));
  const minWeekendGamesPerTeam = gamesPerTeam - maxWeekdayGamesPerTeam;
  const minDHPerTeam = Math.max(0, minWeekendGamesPerTeam - numActiveWeekends);
  const minWeekendDH = minDHPerTeam * numTeams;

  let gapVariance = 0;
  for (let t = 0; t < numTeams; t++) {
    const dates = teamSortedDates.get(t);
    if (dates.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(daysBetween(dates[i - 1], dates[i]));
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
    gapVariance += Math.sqrt(variance);
  }


  let shortGapPenalty = 0;
  for (let t = 0; t < numTeams; t++) {
    const dates = teamSortedDates.get(t);
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetween(dates[i - 1], dates[i]);
      if (gap > 0) shortGapPenalty += 1 / gap;
    }
  }

  // Short gap balance: variance of per-team short-gap (< 3 days) counts
  let shortGapBalance = 0;
  {
    const shortGapCounts = [];
    for (let t = 0; t < numTeams; t++) {
      const dates = teamSortedDates.get(t);
      let shortGaps = 0;
      for (let i = 1; i < dates.length; i++) {
        if (daysBetween(dates[i - 1], dates[i]) < 3) shortGaps++;
      }
      shortGapCounts.push(shortGaps);
    }
    const mean = shortGapCounts.reduce((a, b) => a + b, 0) / shortGapCounts.length;
    shortGapBalance = shortGapCounts.reduce((a, v) => a + (v - mean) ** 2, 0) / shortGapCounts.length;
  }

  // Time-slot distribution: weighted variance of weekend bucket counts per team
  // Three weekend buckets (WKND_EARLY, WKND_MID, WKND_LATE) — weekday time distribution is less meaningful
  const weekendBuckets = [...activeBuckets].filter(b => b === 'WKND_EARLY' || b === 'WKND_MID' || b === 'WKND_LATE');
  let timeDistribution = 0;
  if (weekendBuckets.length > 1) {
    for (let t = 0; t < numTeams; t++) {
      const bucketCounts = new Map();
      for (const b of weekendBuckets) bucketCounts.set(b, 0);
      for (const g of teamGames.get(t)) {
        const b = slotBucket(g.dayOfWeek, g.time);
        if (bucketCounts.has(b)) bucketCounts.set(b, bucketCounts.get(b) + 1);
      }
      // Weight early and late more than mid
      const vals = [...bucketCounts.entries()];
      const mean = vals.reduce((a, [,v]) => a + v, 0) / vals.length;
      timeDistribution += vals.reduce((a, [b, v]) => a + (WKND_BUCKET_IMPORTANCE[b] || 1) * (v - mean) ** 2, 0) / vals.length;
    }
  }

  // Time-slot spread: penalize simultaneous games on the same weekend date
  // Umpires can only be at one field at a time, so prefer distinct time slots per date
  let timeSlotSpread = 0;
  {
    const dateTimeCounts = new Map(); // "date|time" → number of games
    for (const g of schedule) {
      if (g.dayOfWeek !== 0 && g.dayOfWeek !== 6) continue;
      const key = g.date + '|' + g.time;
      dateTimeCounts.set(key, (dateTimeCounts.get(key) || 0) + 1);
    }
    for (const count of dateTimeCounts.values()) {
      if (count > 1) timeSlotSpread += count - 1; // each extra simultaneous game is penalized
    }
  }

  // Field balance: variance of field counts per team
  let fieldBalance = 0;
  if (numFields > 1) {
    for (let t = 0; t < numTeams; t++) {
      const fieldCounts = new Map();
      for (const f of activeFields) fieldCounts.set(f, 0);
      for (const g of teamGames.get(t)) {
        fieldCounts.set(g.field, (fieldCounts.get(g.field) || 0) + 1);
      }
      const vals = [...fieldCounts.values()];
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      fieldBalance += vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
    }
  }

  // Early season density: pairs of games within 2 days in first 7 days
  const allDates = [...new Set(schedule.map(g => g.date))].sort();
  const seasonStartDate = allDates[0];
  const earlySeasonCutoff = addDays(seasonStartDate, 6); // first 7 days inclusive
  let earlySeasonDensity = 0;
  for (let t = 0; t < numTeams; t++) {
    const dates = teamSortedDates.get(t);
    const early = dates.filter(d => d >= seasonStartDate && d <= earlySeasonCutoff);
    for (let i = 0; i + 1 < early.length; i++) {
      if (daysBetween(early[i], early[i + 1]) <= 2) earlySeasonDensity++;
    }
  }

  // Weekend B2B timeslot: penalize when 2nd day of Fri/Sat or Sat/Sun b2b has earlier timeslot
  let weekendBTBTimePenalty = 0;
  for (let t = 0; t < numTeams; t++) {
    const games = teamGames.get(t);
    const gamesByDate = new Map();
    for (const g of games) {
      if (!gamesByDate.has(g.date)) gamesByDate.set(g.date, g);
    }
    for (const g of games) {
      const prevDay = addDays(g.date, -1);
      const prevGame = gamesByDate.get(prevDay);
      if (prevGame) {
        const isFriSat = (prevGame.dayOfWeek === 5 && g.dayOfWeek === 6);
        const isSatSun = (prevGame.dayOfWeek === 6 && g.dayOfWeek === 0);
        if (isFriSat || isSatSun) {
          if (timeSortKey(g.time) < timeSortKey(prevGame.time)) {
            weekendBTBTimePenalty++;
          }
        }
      }
    }
  }

  // Sat/Sun balance: variance of proportion Saturday per team
  let satSunBalance = 0;
  for (let t = 0; t < numTeams; t++) {
    let satCount = 0, sunCount = 0;
    for (const g of teamGames.get(t)) {
      if (g.dayOfWeek === 6) satCount++;
      if (g.dayOfWeek === 0) sunCount++;
    }
    const total = satCount + sunCount;
    if (total > 0) {
      const proportion = satCount / total;
      satSunBalance += (proportion - 0.5) ** 2;
    }
  }

  // Field continuity: penalize non-consecutive same-division weekend games on same field
  // For each (field, date) on weekends, find available time slots and this division's games.
  // Penalize empty slots between the division's first and last game on that field.
  let fieldContinuity = 0;
  let loneWeekendGame = 0;
  {
    // Build map of available weekend time slots per (field, date)
    const fieldDateTimes = new Map(); // key: "field|date" -> sorted array of time sort keys
    for (const s of allSlots) {
      if (s.dayOfWeek !== 0 && s.dayOfWeek !== 6) continue;
      const key = s.field + '|' + s.date;
      if (!fieldDateTimes.has(key)) fieldDateTimes.set(key, []);
      fieldDateTimes.get(key).push(timeSortKey(s.time));
    }
    for (const [, arr] of fieldDateTimes) arr.sort((a, b) => a - b);

    // Build map of scheduled game times per (field, date) for this division
    const fieldDateGameTimes = new Map();
    for (const g of schedule) {
      if (g.dayOfWeek !== 0 && g.dayOfWeek !== 6) continue;
      const key = g.field + '|' + g.date;
      if (!fieldDateGameTimes.has(key)) fieldDateGameTimes.set(key, []);
      fieldDateGameTimes.get(key).push(timeSortKey(g.time));
    }
    for (const [, arr] of fieldDateGameTimes) arr.sort((a, b) => a - b);

    // For each (field, date) with games, count empty slots between first and last game
    for (const [key, gameTimes] of fieldDateGameTimes) {
      if (gameTimes.length < 2) continue;
      const allTimes = fieldDateTimes.get(key);
      if (!allTimes) continue;
      const firstGame = gameTimes[0];
      const lastGame = gameTimes[gameTimes.length - 1];
      // Count available slots between first and last game that have no game
      const gameSet = new Set(gameTimes);
      for (const t of allTimes) {
        if (t > firstGame && t < lastGame && !gameSet.has(t)) {
          fieldContinuity++; // gap between this division's games
        }
      }
    }

    // Lone weekend game: field+date combinations with only one game for this division
    for (const gameTimes of fieldDateGameTimes.values()) {
      if (gameTimes.length === 1) loneWeekendGame++;
    }
  }

  // Back-to-back balance: variance of per-team back-to-back (consecutive day) counts
  let btbBalance = 0;
  {
    const btbCounts = [];
    for (let t = 0; t < numTeams; t++) {
      const dates = teamSortedDates.get(t);
      let btb = 0;
      for (let i = 1; i < dates.length; i++) {
        if (daysBetween(dates[i - 1], dates[i]) === 1) btb++;
      }
      btbCounts.push(btb);
    }
    const mean = btbCounts.reduce((a, b) => a + b, 0) / btbCounts.length;
    btbBalance = btbCounts.reduce((a, v) => a + (v - mean) ** 2, 0) / btbCounts.length;
  }

  return {
    weekendSitouts, weekendDoubleHeaders, gapVariance: Math.round(gapVariance * 100) / 100,
    shortGapPenalty: Math.round(shortGapPenalty * 100) / 100,
    shortGapBalance: Math.round(shortGapBalance * 100) / 100,
    timeDistribution: Math.round(timeDistribution * 100) / 100,
    timeSlotSpread: Math.round(timeSlotSpread * 100) / 100,
    fieldBalance: Math.round(fieldBalance * 100) / 100,
    fieldContinuity,
    earlySeasonDensity,
    btbBalance: Math.round(btbBalance * 100) / 100,
    loneWeekendGame,
    weekendBTBTimePenalty,
    satSunBalance: Math.round(satSunBalance * 100) / 100,
    minWeekendDH
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

export { scoreCandidate, scoreDetails, scoreCrossfieldDivisionClustering, scoreWeekendOtherDivField };
