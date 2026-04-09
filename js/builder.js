import { WEIGHTS, NUM_ATTEMPTS } from './constants.js';
import { isoWeek, addDays, hasThreeInFourDays, shuffle } from './utils.js';
import { generateTournamentRounds, selectMatchups, selectMatchupsWithLeagues, validateLeagueSplit, assignHomeAway, rebalanceHomeAway } from './matchups.js';
import { scoreCandidate, scoreDetails } from './scoring.js';
import { annealSchedule, consolidateFields, slideCleanup } from './optimizer.js';

function tryBuildSchedule(games, slots, numTeams, onProgress, precomputedMatchups, weights) {
  const totalGames = games.length;
  if (slots.length < totalGames) {
    throw new Error(`Not enough slots: need ${totalGames} games but only ${slots.length} slots available.`);
  }

  // Scarcity map: sortKey → number of other divisions that also need this slot
  // Higher values mean we should avoid claiming this slot if alternatives exist
  const slotScarcity = (precomputedMatchups && precomputedMatchups.slotScarcity) || null;

  // Other divisions' games: used for cross-division clustering in slot scoring
  // Map of "field|date" → count of games from other divisions
  const otherDivGames = (precomputedMatchups && precomputedMatchups.otherDivisionGames) || null;
  const otherDivFieldDate = new Map(); // "field|date" → count
  if (otherDivGames) {
    for (const g of otherDivGames) {
      const key = g.field + '|' + g.date;
      otherDivFieldDate.set(key, (otherDivFieldDate.get(key) || 0) + 1);
    }
  }

  // Precompute date-to-day-number map to avoid Date allocations in hot loops
  const dateToDay = new Map();
  const dateToDow = new Map(); // date → day-of-week (0=Sun..6=Sat)
  const dateToWeekdayWeek = new Map(); // date → isoWeek key (only for weekdays, null for weekends)
  for (const s of slots) {
    if (!dateToDay.has(s.date)) {
      dateToDay.set(s.date, Math.round(new Date(s.date + 'T00:00:00') / 86400000));
      const dow = new Date(s.date + 'T00:00:00').getDay();
      dateToDow.set(s.date, dow);
      dateToWeekdayWeek.set(s.date, (dow >= 1 && dow <= 5) ? isoWeek(s.date) : null);
    }
  }
  // Binary search for nearest day distance in a sorted array of day-numbers
  function nearestDayDistance(sortedDays, targetDay) {
    const arr = sortedDays;
    if (arr.length === 0) return 14;
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < targetDay) lo = mid + 1;
      else hi = mid;
    }
    let best = Math.abs(arr[lo] - targetDay);
    if (lo > 0) best = Math.min(best, Math.abs(arr[lo - 1] - targetDay));
    return Math.min(best, 14);
  }

  // Insert a value into a sorted array in order (binary search insertion)
  function insertSorted(arr, val) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < val) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, val);
  }

  // End-of-season tracking (soft penalty, but still tracked for recordAssignment)
  const allDates = [...new Set(slots.map(s => s.date))].sort();
  const seasonEndDate = allDates[allDates.length - 1];
  const endOfSeasonCutoff = addDays(seasonEndDate, -4); // 5-day window inclusive

  // Identify weekend groups from slots
  const weekendGroupSet = new Set();
  for (const s of slots) {
    if (s.weekendGroup) weekendGroupSet.add(s.weekendGroup);
  }
  const weekendGroups = [...weekendGroupSet].sort();
  const numWeekends = weekendGroups.length;

  // Group weekend slots by weekendGroup
  const weekendSlotsByGroup = new Map();
  for (const wg of weekendGroups) {
    weekendSlotsByGroup.set(wg, []);
  }
  for (const s of slots) {
    if (s.weekendGroup && weekendSlotsByGroup.has(s.weekendGroup)) {
      weekendSlotsByGroup.get(s.weekendGroup).push(s);
    }
  }

  // Weekday slots
  const weekdaySlots = slots.filter(s => !s.weekendGroup);

  // Determine how many games per team from the data
  const gamesPerTeam = totalGames * 2 / numTeams;

  // Use precomputed matchups if provided, otherwise generate from tournament rounds
  let weekendRounds, weekdayGames;
  if (precomputedMatchups) {
    ({ weekendRounds, weekdayGames } = precomputedMatchups);
  } else {
    const rounds = generateTournamentRounds(numTeams);
    ({ weekendRounds, weekdayGames } = selectMatchups(rounds, numTeams, gamesPerTeam, numWeekends));
  }

  // Convert tournament [a,b] pairs to {home, away} using the provided games' H/A assignments
  // Build a lookup from the input games
  const haLookup = new Map();
  const gameCounts = new Map(); // track how many times each pair appears
  for (const g of games) {
    const key = Math.min(g.home, g.away) + ',' + Math.max(g.home, g.away);
    if (!haLookup.has(key)) {
      haLookup.set(key, []);
      gameCounts.set(key, 0);
    }
    haLookup.get(key).push({ home: g.home, away: g.away });
  }

  function getHomeAway(a, b) {
    const key = Math.min(a, b) + ',' + Math.max(a, b);
    const options = haLookup.get(key);
    if (!options || options.length === 0) {
      // Fallback: random assignment
      return Math.random() < 0.5 ? { home: a, away: b } : { home: b, away: a };
    }
    const idx = gameCounts.get(key);
    gameCounts.set(key, idx + 1);
    return options[idx % options.length];
  }

  let bestSchedule = null;
  let bestScore = Infinity;
  let lastFailureInfo = null; // diagnostic info from the most recent failed attempt

  function runAttempt(attempt) {
    // Reset the H/A counter each attempt
    for (const key of gameCounts.keys()) gameCounts.set(key, 0);

    const schedule = [];
    const taken = new Set();
    const teamDay = new Map();
    const teamDaySorted = new Map(); // sorted arrays of day-numbers per team
    const teamWeekend = new Map();
    const teamWeek = new Map();
    const teamWeekdayWeek = new Map(); // weekday games per M-F week per team
    const teamField = new Map();
    const divFieldDate = new Map(); // "field|date" → count of this division's games (for clustering)
    const lastGameDate = new Map();
    for (let t = 0; t < numTeams; t++) {
      teamDay.set(t, new Set());
      teamDaySorted.set(t, []);
      teamWeekend.set(t, new Map());
      teamWeek.set(t, new Map());
      teamWeekdayWeek.set(t, new Map());
      teamField.set(t, new Map());
    }
    const teamEndGames = new Map(); // games per team in last 5 days
    for (let t = 0; t < numTeams; t++) teamEndGames.set(t, 0);
    const teamBtbCount = new Array(numTeams).fill(0); // back-to-back game count per team
    let failed = false;
    let runningPenalty = 0; // running estimate of penalties for early exit

    // Check if placing a game on `date` for team `t` would create a new back-to-back.
    // Uses pre-existing teamDaySorted (before recordAssignment inserts the new day).
    // The sorted array is ascending, so we only need to check neighbors around dayNum.
    function wouldCreateBtb(t, date) {
      const dayNum = dateToDay.get(date);
      return nearestDayDistance(teamDaySorted.get(t), dayNum) === 1;
    }

    // Add b2b penalty to runningPenalty for a team after a b2b was created.
    // Approximates marginal cost of the exponential (max-min) formula: exp(spread)-1.
    function addBtbPenalty(team) {
      const minBtb = Math.min(...teamBtbCount);
      const maxBtb = Math.max(...teamBtbCount);
      const spread = maxBtb - minBtb;
      if (spread > 0) {
        // Marginal cost = derivative of exp(spread)-1 = exp(spread)
        runningPenalty += (weights || WEIGHTS).btbBalance * Math.exp(spread);
      }
    }

    // Clustering score: prefer fields where this division already has games, avoid other-division fields.
    // Weights mirror loneWeekendGame (1) and weekendOtherDivField (4) scoring penalties.
    function clusteringScore(field, date) {
      const key = field + '|' + date;
      let score = 0;
      // Reward joining an existing own-division game on this field+date (avoids lone game penalty)
      const own = divFieldDate.get(key) || 0;
      if (own > 0) score += 1;
      // Penalize sharing a field+date with another division
      if (otherDivFieldDate.size > 0) {
        const other = otherDivFieldDate.get(key) || 0;
        if (other > 0) score -= 4;
      }
      return score;
    }

    // Shuffle which rounds go to which weekends
    const roundOrder = shuffle([...Array(weekendRounds.length).keys()]);
    // Also shuffle weekday games
    const shuffledWeekdayGames = shuffle(weekdayGames);

    // Phase 1: Assign weekend rounds
    const dateGameCount = new Map(); // track games per date for Sat/Sun spreading
    for (let wi = 0; wi < weekendGroups.length && wi < roundOrder.length; wi++) {
      const wg = weekendGroups[wi];
      const round = weekendRounds[roundOrder[wi]];
      const groupSlots = weekendSlotsByGroup.get(wg);

      const shuffledRound = shuffle(round);

      for (const pair of shuffledRound) {
        const game = getHomeAway(pair[0], pair[1]);
        const { home, away } = game;

        const eligible = groupSlots.filter(s => {
          if (taken.has(s.sortKey)) return false;
          if (teamDay.get(home).has(s.date) || teamDay.get(away).has(s.date)) return false;
          const slotDayNum = dateToDay.get(s.date);
          if (hasThreeInFourDays(teamDaySorted.get(home), slotDayNum) || hasThreeInFourDays(teamDaySorted.get(away), slotDayNum)) return false;
          const wdwk = dateToWeekdayWeek.get(s.date);
          if (wdwk && ((teamWeekdayWeek.get(home).get(wdwk) || 0) >= 1 || (teamWeekdayWeek.get(away).get(wdwk) || 0) >= 1)) return false;
          return true;
        });

        let bestSlot;
        if (eligible.length === 0) {
          const fallback = groupSlots.filter(s => !taken.has(s.sortKey));
          if (fallback.length === 0) {
            failed = true;
            lastFailureInfo = { phase: 'weekend', stuckGame: `${game.home + 1}B vs ${game.away + 1}B`, totalWeekendSlots: groupSlots.length, weekendGroup: wg };
            break;
          }
          bestSlot = fallback[Math.floor(Math.random() * fallback.length)];
        } else {
          // Spread across Sat and Sun, prefer underused fields, avoid scarce shared slots
          let bestScore = -Infinity;
          bestSlot = eligible[0];
          for (const s of eligible) {
            let score = -(dateGameCount.get(s.date) || 0);
            score -= (teamField.get(home).get(s.field) || 0) * 0.3;
            score -= (teamField.get(away).get(s.field) || 0) * 0.3;
            if (slotScarcity) score -= (slotScarcity.get(s.sortKey) || 0) * 0.5;
            score += clusteringScore(s.field, s.date);
            score += Math.random() * 0.3;
            if (score > bestScore) { bestScore = score; bestSlot = s; }
          }
        }

        const homeBtb1 = wouldCreateBtb(home, bestSlot.date);
        const awayBtb1 = wouldCreateBtb(away, bestSlot.date);
        taken.add(bestSlot.sortKey);
        dateGameCount.set(bestSlot.date, (dateGameCount.get(bestSlot.date) || 0) + 1);
        const fdKey = bestSlot.field + '|' + bestSlot.date;
        divFieldDate.set(fdKey, (divFieldDate.get(fdKey) || 0) + 1);
        recordAssignment(schedule, bestSlot, home, away, teamDay, teamDaySorted, teamWeekend, teamWeek, teamWeekdayWeek, lastGameDate, teamField, teamEndGames, endOfSeasonCutoff, dateToDay, dateToWeekdayWeek, insertSorted);

        // Track weekend double-headers for early exit
        if (bestSlot.weekendGroup) {
          for (const t of [home, away]) {
            const wgCount = teamWeekend.get(t).get(bestSlot.weekendGroup) || 0;
            if (wgCount > 1) {
              // This game just created (or added to) a double-header
              runningPenalty += (weights || WEIGHTS).weekendDoubleHeaders;
            }
          }
        }
        // Track b2b imbalance for early exit
        if (homeBtb1) { teamBtbCount[home]++; addBtbPenalty(home); }
        if (awayBtb1) { teamBtbCount[away]++; addBtbPenalty(away); }
        if (runningPenalty > bestScore) { failed = true; break; }
      }
      if (failed) return;
    }

    if (failed) return;

    // Phase 1.5: Weekend overflow — place weekday games into unused weekend slots,
    // but only when weekday capacity is genuinely tight.
    // If there are enough untaken weekday slots for all weekday games, skip overflow
    // entirely to avoid creating unnecessary back-to-backs.
    const availableWeekdayCount = weekdaySlots.reduce((n, s) => n + (taken.has(s.sortKey) ? 0 : 1), 0);
    const remainingWeekdayGames = [];
    for (const pair of shuffledWeekdayGames) {
      const tA = pair[0], tB = pair[1];

      // If weekday capacity is ample, defer everything to Phase 2.
      if (availableWeekdayCount >= shuffledWeekdayGames.length) {
        remainingWeekdayGames.push(pair);
        continue;
      }

      // Weekday capacity is tight — check if this specific game has any eligible weekday slot.
      let hasEligibleWeekday = false;
      for (const s of weekdaySlots) {
        if (taken.has(s.sortKey)) continue;
        if (teamDay.get(tA).has(s.date) || teamDay.get(tB).has(s.date)) continue;
        const slotDayNum = dateToDay.get(s.date);
        if (hasThreeInFourDays(teamDaySorted.get(tA), slotDayNum) || hasThreeInFourDays(teamDaySorted.get(tB), slotDayNum)) continue;
        const wdwk = dateToWeekdayWeek.get(s.date);
        if (wdwk && ((teamWeekdayWeek.get(tA).get(wdwk) || 0) >= 1 || (teamWeekdayWeek.get(tB).get(wdwk) || 0) >= 1)) continue;
        hasEligibleWeekday = true;
        break;
      }
      if (hasEligibleWeekday) {
        remainingWeekdayGames.push(pair);
        continue;
      }

      // No weekday options — try weekend overflow.
      let overflowBest = null;
      let overflowBestScore = -Infinity;
      for (const [, groupSlots] of weekendSlotsByGroup) {
        for (const s of groupSlots) {
          if (taken.has(s.sortKey)) continue;
          if (teamDay.get(tA).has(s.date) || teamDay.get(tB).has(s.date)) continue;
          const slotDayNum = dateToDay.get(s.date);
          if (hasThreeInFourDays(teamDaySorted.get(tA), slotDayNum) || hasThreeInFourDays(teamDaySorted.get(tB), slotDayNum)) continue;
          // Same-day check already above (line 987); back-to-back Sat/Sun is allowed
          let score = 0;
          score -= (dateGameCount.get(s.date) || 0);
          score -= (teamField.get(tA).get(s.field) || 0) * 0.3;
          score -= (teamField.get(tB).get(s.field) || 0) * 0.3;
          if (slotScarcity) score -= (slotScarcity.get(s.sortKey) || 0) * 0.5;
          score += clusteringScore(s.field, s.date);
          score += Math.random() * 0.3;
          if (score > overflowBestScore) { overflowBestScore = score; overflowBest = s; }
        }
      }

      if (overflowBest) {
        // Only resolve H/A when actually placing the game
        const game = getHomeAway(tA, tB);
        const homeBtb15 = wouldCreateBtb(game.home, overflowBest.date);
        const awayBtb15 = wouldCreateBtb(game.away, overflowBest.date);
        taken.add(overflowBest.sortKey);
        dateGameCount.set(overflowBest.date, (dateGameCount.get(overflowBest.date) || 0) + 1);
        const fdKey2 = overflowBest.field + '|' + overflowBest.date;
        divFieldDate.set(fdKey2, (divFieldDate.get(fdKey2) || 0) + 1);
        recordAssignment(schedule, overflowBest, game.home, game.away, teamDay, teamDaySorted, teamWeekend, teamWeek, teamWeekdayWeek, lastGameDate, teamField, teamEndGames, endOfSeasonCutoff, dateToDay, dateToWeekdayWeek, insertSorted);
        if (overflowBest.weekendGroup) {
          for (const t of [game.home, game.away]) {
            const wgCount = teamWeekend.get(t).get(overflowBest.weekendGroup) || 0;
            if (wgCount > 1) runningPenalty += (weights || WEIGHTS).weekendDoubleHeaders;
          }
        }
        // Track b2b imbalance for early exit
        if (homeBtb15) { teamBtbCount[game.home]++; addBtbPenalty(game.home); }
        if (awayBtb15) { teamBtbCount[game.away]++; addBtbPenalty(game.away); }
      } else {
        remainingWeekdayGames.push(pair);
      }
    }

    if (runningPenalty > bestScore) return;

    // Phase 2: Assign weekday games via MRV greedy
    // Instead of iterating in random order, dynamically pick the most constrained game first
    const unplacedWeekday = remainingWeekdayGames.slice();
    while (unplacedWeekday.length > 0) {
      // Find the game with the fewest eligible slots (MRV)
      let minEligible = Infinity;
      let bestGameIdx = 0;
      for (let i = 0; i < unplacedWeekday.length; i++) {
        const pair = unplacedWeekday[i];
        const tA = pair[0], tB = pair[1];

        let count = 0;
        for (const s of weekdaySlots) {
          if (taken.has(s.sortKey)) continue;
          if (teamDay.get(tA).has(s.date) || teamDay.get(tB).has(s.date)) continue;
          const slotDayNum = dateToDay.get(s.date);
          if (hasThreeInFourDays(teamDaySorted.get(tA), slotDayNum) || hasThreeInFourDays(teamDaySorted.get(tB), slotDayNum)) continue;
          const wdwk = dateToWeekdayWeek.get(s.date);
          if (wdwk && ((teamWeekdayWeek.get(tA).get(wdwk) || 0) >= 1 || (teamWeekdayWeek.get(tB).get(wdwk) || 0) >= 1)) continue;
          count++;
          if (count >= minEligible) break; // can't beat current best, stop counting
        }

        if (count < minEligible) {
          minEligible = count;
          bestGameIdx = i;
          if (count === 0) break; // can't do better, fail fast
        }
      }

      if (minEligible === 0) {
        failed = true;
        // Diagnose why the most-constrained game is stuck
        const stuckPair = unplacedWeekday[bestGameIdx];
        const tA = stuckPair[0], tB = stuckPair[1];
        const reasons = { sameDay: 0, threeInFour: 0, weekdayPerWeek: 0, taken: 0 };
        let availableSlots = 0;
        for (const s of weekdaySlots) {
          if (taken.has(s.sortKey)) { reasons.taken++; continue; }
          availableSlots++;
          if (teamDay.get(tA).has(s.date) || teamDay.get(tB).has(s.date)) { reasons.sameDay++; continue; }
          const slotDayNum = dateToDay.get(s.date);
          if (hasThreeInFourDays(teamDaySorted.get(tA), slotDayNum) || hasThreeInFourDays(teamDaySorted.get(tB), slotDayNum)) { reasons.threeInFour++; continue; }
          const wdwk = dateToWeekdayWeek.get(s.date);
          if (wdwk && ((teamWeekdayWeek.get(tA).get(wdwk) || 0) >= 1 || (teamWeekdayWeek.get(tB).get(wdwk) || 0) >= 1)) { reasons.weekdayPerWeek++; }
        }
        lastFailureInfo = {
          phase: 'weekday',
          stuckGame: `${tA + 1}B vs ${tB + 1}B`,
          remainingGames: unplacedWeekday.length,
          availableSlots,
          reasons,
          totalWeekdaySlots: weekdaySlots.length,
        };
        break;
      }

      const pair = unplacedWeekday.splice(bestGameIdx, 1)[0];
      const game = getHomeAway(pair[0], pair[1]);
      const { home, away } = game;

      // Re-filter eligible slots for the chosen game
      const eligible = weekdaySlots.filter(s => {
        if (taken.has(s.sortKey)) return false;
        if (teamDay.get(home).has(s.date) || teamDay.get(away).has(s.date)) return false;
        const slotDayNum = dateToDay.get(s.date);
        if (hasThreeInFourDays(teamDaySorted.get(home), slotDayNum) || hasThreeInFourDays(teamDaySorted.get(away), slotDayNum)) return false;
        const wdwk = dateToWeekdayWeek.get(s.date);
        if (wdwk && ((teamWeekdayWeek.get(home).get(wdwk) || 0) >= 1 || (teamWeekdayWeek.get(away).get(wdwk) || 0) >= 1)) return false;
        return true;
      });

      if (eligible.length === 0) { failed = true; break; }

      let bestSlot = null;
      let bestSlotScore = -Infinity;
      for (const s of eligible) {
        let score = 0;
        // For each team, find the minimum absolute distance from this slot
        // to any existing game date — prefer slots in the biggest schedule gaps
        // Uses binary search on sorted day-number arrays for O(log n) lookup
        const slotDay = dateToDay.get(s.date);
        score += nearestDayDistance(teamDaySorted.get(home), slotDay);
        score += nearestDayDistance(teamDaySorted.get(away), slotDay);

        const hWeekCount = teamWeek.get(home).get(s.week) || 0;
        const aWeekCount = teamWeek.get(away).get(s.week) || 0;
        score -= (hWeekCount + aWeekCount) * 5;

        // Prefer underused fields for both teams
        score -= (teamField.get(home).get(s.field) || 0) * 2;
        score -= (teamField.get(away).get(s.field) || 0) * 2;

        // Avoid slots that other divisions also need
        if (slotScarcity) score -= (slotScarcity.get(s.sortKey) || 0) * 2;

        // Division clustering: prefer fields where this division already has games
        score += clusteringScore(s.field, s.date);

        // LCV: penalize slots in weeks that would constrain remaining games
        const sWdwk = dateToWeekdayWeek.get(s.date);
        if (sWdwk && unplacedWeekday.length <= 20) {
          let futureImpact = 0;
          for (const rp of unplacedWeekday) {
            const ra = rp[0], rb = rp[1];
            if (ra === home || ra === away || rb === home || rb === away) continue;
            if ((teamWeekdayWeek.get(ra).get(sWdwk) || 0) >= 1 || (teamWeekdayWeek.get(rb).get(sWdwk) || 0) >= 1) futureImpact++;
          }
          score -= futureImpact * 0.5;
        }

        score += Math.random() * 0.5;

        if (score > bestSlotScore) {
          bestSlotScore = score;
          bestSlot = s;
        }
      }

      const homeBtb2 = wouldCreateBtb(home, bestSlot.date);
      const awayBtb2 = wouldCreateBtb(away, bestSlot.date);
      taken.add(bestSlot.sortKey);
      const fdKey3 = bestSlot.field + '|' + bestSlot.date;
      divFieldDate.set(fdKey3, (divFieldDate.get(fdKey3) || 0) + 1);
      recordAssignment(schedule, bestSlot, home, away, teamDay, teamDaySorted, teamWeekend, teamWeek, teamWeekdayWeek, lastGameDate, teamField, teamEndGames, endOfSeasonCutoff, dateToDay, dateToWeekdayWeek, insertSorted);
      // Track b2b imbalance for early exit
      if (homeBtb2) { teamBtbCount[home]++; addBtbPenalty(home); }
      if (awayBtb2) { teamBtbCount[away]++; addBtbPenalty(away); }

      if (runningPenalty > bestScore) { failed = true; break; }
    }

    if (failed) return;

    const score = scoreCandidate(schedule, numTeams, slots, weights);
    if (score < bestScore) {
      bestScore = score;
      bestSchedule = schedule;
    }
  }

  return new Promise(function (resolve, reject) {
    var attempt = 0;
    function step() {
      // Run a batch of attempts before yielding
      var batchEnd = Math.min(attempt + 5, NUM_ATTEMPTS);
      for (; attempt < batchEnd; attempt++) {
        runAttempt(attempt);
      }
      if (onProgress) onProgress(attempt / NUM_ATTEMPTS, bestScore);
      if (attempt < NUM_ATTEMPTS) {
        setTimeout(step, 0);
      } else {
        if (!bestSchedule) {
          let msg = 'Could not build a valid schedule after ' + NUM_ATTEMPTS + ' attempts.';
          if (lastFailureInfo) {
            const f = lastFailureInfo;
            if (f.phase === 'weekend') {
              msg += ` No slots left on weekend ${f.weekendGroup} to place game ${f.stuckGame} (${f.totalWeekendSlots} slots on that weekend, all taken).`;
              msg += ' Try adding more weekend slots or reducing games per team.';
            } else {
              msg += ` Stuck placing weekday game ${f.stuckGame} (${f.remainingGames} games left).`;
              msg += ` ${f.availableSlots} of ${f.totalWeekdaySlots} weekday slots were untaken,`;
              msg += ` but all were blocked: ${f.reasons.sameDay} by same-day conflict,`;
              msg += ` ${f.reasons.threeInFour} by 3-games-in-4-days limit,`;
              msg += ` ${f.reasons.weekdayPerWeek} by 1-weekday-per-week limit.`;
            }
          } else {
            msg += ' Try adding more slots or reducing games per team.';
          }
          reject(new Error(msg));
        } else {
          resolve({ schedule: bestSchedule, score: bestScore, details: scoreDetails(bestSchedule, numTeams, slots) });
        }
      }
    }
    step();
  });
}

// Entry point called by ui.js — handles matchup generation, H/A, and scheduling in one call
function buildSchedule(numTeams, gamesPerTeam, slots, onProgress, options) {
  options = options || {};
  const leagueSplit = options.leagueSplit || false;
  const slotScarcity = options.slotScarcity || null;
  const otherDivisionGames = options.otherDivisionGames || null;
  const W = options.weights ? { ...WEIGHTS, ...options.weights } : WEIGHTS;

  // Determine weekend count from slots so selectMatchups uses the same pairs as scheduling
  const weekendGroupSet = new Set();
  for (const s of slots) {
    if (s.weekendGroup) weekendGroupSet.add(s.weekendGroup);
  }
  const numWeekends = weekendGroupSet.size;

  let weekendRounds, weekdayGames;
  if (leagueSplit) {
    const err = validateLeagueSplit(numTeams, gamesPerTeam);
    if (err) throw new Error(err);
    ({ weekendRounds, weekdayGames } = selectMatchupsWithLeagues(numTeams, gamesPerTeam, numWeekends));
  } else {
    const rounds = generateTournamentRounds(numTeams);
    ({ weekendRounds, weekdayGames } = selectMatchups(rounds, numTeams, gamesPerTeam, numWeekends));
  }

  // Flatten the actual selected pairs, then assign H/A on exactly those pairs
  const allPairs = [];
  for (const round of weekendRounds) {
    for (const pair of round) allPairs.push({ teamA: pair[0], teamB: pair[1] });
  }
  for (const pair of weekdayGames) allPairs.push({ teamA: pair[0], teamB: pair[1] });

  const haGames = assignHomeAway(allPairs, numTeams);
  const games = haGames.map(g => ({ home: g.home, away: g.away }));
  const greedyProgress = onProgress ? (pct, score) => onProgress(pct * 0.7, score) : null;
  const annealProgress = onProgress ? (pct, score) => onProgress(0.7 + pct * 0.3, score) : null;
  return tryBuildSchedule(games, slots, numTeams, greedyProgress, { weekendRounds, weekdayGames, slotScarcity, otherDivisionGames }, W).then(result => {
    const preAnnealScore = scoreCandidate(result.schedule, numTeams, slots, W);
    return annealSchedule(result.schedule, numTeams, slots, undefined, W, annealProgress).then(saResult => {
      console.log(`Anneal: ${preAnnealScore.toFixed(2)} → ${saResult.score.toFixed(2)} (${saResult.improved ? 'improved' : 'no improvement'})`);
      if (saResult.improved) {
        result.schedule = saResult.schedule;
      }
      const preSlideScore = scoreCandidate(result.schedule, numTeams, slots, W);
      result.schedule = consolidateFields(result.schedule, numTeams, slots, W);
      result.schedule = slideCleanup(result.schedule, numTeams, slots, W);
      const postSlideScore = scoreCandidate(result.schedule, numTeams, slots, W);
      console.log(`Consolidate+repack: ${preSlideScore.toFixed(2)} → ${postSlideScore.toFixed(2)}`);
      rebalanceHomeAway(result.schedule, numTeams, gamesPerTeam);
      result.details = scoreDetails(result.schedule, numTeams, slots);
      return result;
    });
  });
}

// Helper to record a game assignment and update tracking structures
function recordAssignment(schedule, slot, home, away, teamDay, teamDaySorted, teamWeekend, teamWeek, teamWeekdayWeek, lastGameDate, teamField, teamEndGames, endOfSeasonCutoff, dateToDay, dateToWeekdayWeek, insertSorted) {
  teamDay.get(home).add(slot.date);
  teamDay.get(away).add(slot.date);
  const dayNum = dateToDay.get(slot.date);
  insertSorted(teamDaySorted.get(home), dayNum);
  insertSorted(teamDaySorted.get(away), dayNum);
  if (slot.weekendGroup) {
    const hwm = teamWeekend.get(home);
    hwm.set(slot.weekendGroup, (hwm.get(slot.weekendGroup) || 0) + 1);
    const awm = teamWeekend.get(away);
    awm.set(slot.weekendGroup, (awm.get(slot.weekendGroup) || 0) + 1);
  }
  const hwk = teamWeek.get(home);
  hwk.set(slot.week, (hwk.get(slot.week) || 0) + 1);
  const awk = teamWeek.get(away);
  awk.set(slot.week, (awk.get(slot.week) || 0) + 1);
  if (teamWeekdayWeek && dateToWeekdayWeek) {
    const wdwk = dateToWeekdayWeek.get(slot.date);
    if (wdwk) {
      const hwdw = teamWeekdayWeek.get(home);
      hwdw.set(wdwk, (hwdw.get(wdwk) || 0) + 1);
      const awdw = teamWeekdayWeek.get(away);
      awdw.set(wdwk, (awdw.get(wdwk) || 0) + 1);
    }
  }
  lastGameDate.set(home, slot.date);
  lastGameDate.set(away, slot.date);
  if (teamField) {
    const hf = teamField.get(home);
    hf.set(slot.field, (hf.get(slot.field) || 0) + 1);
    const af = teamField.get(away);
    af.set(slot.field, (af.get(slot.field) || 0) + 1);
  }
  if (teamEndGames && endOfSeasonCutoff && slot.date >= endOfSeasonCutoff) {
    teamEndGames.set(home, teamEndGames.get(home) + 1);
    teamEndGames.set(away, teamEndGames.get(away) + 1);
  }

  schedule.push({
    date: slot.date,
    dayOfWeek: slot.dayOfWeek,
    weekendGroup: slot.weekendGroup,
    sortKey: slot.sortKey,
    time: slot.time,
    field: slot.field,
    home,
    away
  });
}

export { tryBuildSchedule, buildSchedule };
