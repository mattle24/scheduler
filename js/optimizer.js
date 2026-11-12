import { slotKey, timeSortKey, isoWeek, teamHasThreeInFourDays } from './utils.js';
import { scoreCandidate, scoreCrossDivision } from './scoring.js';
import { IncrementalScorer } from './incrementalScore.js';

// Per-division score plus cross-division penalties against other divisions' games,
// so post-greedy optimization doesn't undo cross-division clustering.
function makeScorer(numTeams, slots, weights, otherGames) {
  return sched => scoreCandidate(sched, numTeams, slots, weights) + scoreCrossDivision(sched, otherGames, weights);
}

// Precomputed date → weekday ISO-week key (null for weekend dates). Avoids
// constructing Date objects inside the annealer's constraint checks.
const weekdayWeekCache = new Map();
function weekdayWeekOf(date, dayOfWeek) {
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;
  let wk = weekdayWeekCache.get(date);
  if (wk === undefined) { wk = isoWeek(date); weekdayWeekCache.set(date, wk); }
  return wk;
}

// ─── Module 4b: Simulated Annealing ─────────────────────────────────────────
function annealSchedule(schedule, numTeams, slots, maxIterations, weights, onProgress, otherGames) {
  if (!maxIterations) maxIterations = 2000;
  const score = makeScorer(numTeams, slots, weights, otherGames);
  const current = schedule.map(g => ({...g}));
  const initialFullScore = score(current);
  // Moves are scored incrementally (only touched teams/field-dates recomputed);
  // the full scorer is used only for the reported initial/final scores.
  const scorer = new IncrementalScorer(current, numTeams, slots, weights, otherGames);
  let currentScore = scorer.total();
  let bestSchedule = current.map(g => ({...g, sortKey: slotKey(g)}));
  let bestScore = currentScore;

  // Build date → game indices map for same-date swaps
  function buildDateIndex() {
    const map = new Map();
    for (let i = 0; i < current.length; i++) {
      const d = current[i].date;
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(i);
    }
    return map;
  }
  function buildWeekendIndices() {
    const out = [];
    for (let k = 0; k < current.length; k++) {
      if (current[k].dayOfWeek === 0 || current[k].dayOfWeek === 6) out.push(k);
    }
    return out;
  }
  // Cached move candidates; rebuilt only when a date-changing move is accepted
  let multiGameDates, weekendIndices;
  function rebuildIndices() {
    multiGameDates = [...buildDateIndex().values()].filter(idx => idx.length >= 2);
    weekendIndices = buildWeekendIndices();
  }
  rebuildIndices();

  // Build slot lookup by sortKey for relocations
  const slotBySortKey = new Map();
  for (const s of slots) slotBySortKey.set(s.sortKey, s);

  // Track which slot sortKeys are currently used
  const usedKeys = new Set();
  for (const g of current) usedKeys.add(g.sortKey);

  // Unused slots array, with sortKey → index for O(1) swaps
  const unusedSlots = slots.filter(s => !usedKeys.has(s.sortKey));
  const unusedIndex = new Map(unusedSlots.map((s, i) => [s.sortKey, i]));
  function markUsed(newKey, oldKey) {
    usedKeys.delete(oldKey);
    usedKeys.add(newKey);
    const i = unusedIndex.get(newKey);
    if (i === undefined) return;
    unusedIndex.delete(newKey);
    unusedSlots[i] = slotBySortKey.get(oldKey);
    unusedIndex.set(oldKey, i);
  }

  // Precompute field+date → time-sorted slots for slide moves
  const fieldDateSlots = new Map();
  for (const s of slots) {
    if (s.dayOfWeek !== 0 && s.dayOfWeek !== 6) continue;
    const fdKey = s.field + '|' + s.date;
    if (!fieldDateSlots.has(fdKey)) fieldDateSlots.set(fdKey, []);
    fieldDateSlots.get(fdKey).push(s);
  }
  for (const [, arr] of fieldDateSlots) arr.sort((a, b) => timeSortKey(a.time) - timeSortKey(b.time));

  // Hard constraints for the given games' teams, checked on the current state:
  // no same-day games, no 3 in 4 days, max 1 weekday game per Mon–Fri week.
  function teamsValid(gameIndices) {
    const teams = new Set();
    for (const gi of gameIndices) { teams.add(current[gi].home); teams.add(current[gi].away); }
    for (const t of teams) {
      const dates = [];
      const weekdayWeeks = new Set();
      for (const g of current) {
        if (g.home !== t && g.away !== t) continue;
        dates.push(g.date);
        const wk = weekdayWeekOf(g.date, g.dayOfWeek);
        if (wk) {
          if (weekdayWeeks.has(wk)) return false;
          weekdayWeeks.add(wk);
        }
      }
      dates.sort();
      for (let k = 1; k < dates.length; k++) {
        if (dates[k] === dates[k - 1]) return false;
      }
      if (teamHasThreeInFourDays(dates)) return false;
    }
    return true;
  }

  function swapSlots(i, j, sameDate) {
    const saved = {
      i: { date: current[i].date, dayOfWeek: current[i].dayOfWeek, weekendGroup: current[i].weekendGroup, time: current[i].time, field: current[i].field },
      j: { date: current[j].date, dayOfWeek: current[j].dayOfWeek, weekendGroup: current[j].weekendGroup, time: current[j].time, field: current[j].field }
    };
    if (sameDate) {
      [current[i].time, current[j].time] = [current[j].time, current[i].time];
      [current[i].field, current[j].field] = [current[j].field, current[i].field];
    } else {
      [current[i].date, current[j].date] = [current[j].date, current[i].date];
      [current[i].dayOfWeek, current[j].dayOfWeek] = [current[j].dayOfWeek, current[i].dayOfWeek];
      [current[i].weekendGroup, current[j].weekendGroup] = [current[j].weekendGroup, current[i].weekendGroup];
      [current[i].time, current[j].time] = [current[j].time, current[i].time];
      [current[i].field, current[j].field] = [current[j].field, current[i].field];
    }
    return saved;
  }

  function revertSwap(i, j, saved) {
    Object.assign(current[i], saved.i);
    Object.assign(current[j], saved.j);
  }

  const T_START = 2.0;
  const T_END = 0.01;
  const alpha = Math.pow(T_END / T_START, 1 / maxIterations);
  let T = T_START;

  return new Promise((resolve) => {
    let iter = 0;
    // Yield to the UI about once per frame. Time-based batching avoids the
    // browser's ~4ms clamp on nested setTimeout(0) dominating short batches.
    function step() {
      const sliceEnd = performance.now() + 16;
      for (; iter < maxIterations && (iter % 50 !== 0 || performance.now() < sliceEnd); iter++) {
        const r = Math.random();
        // Move types: 40% same-date swap, 15% cross-date swap, 25% relocate, 20% slide
        if (r < 0.4) {
          // Same-date swap
          if (multiGameDates.length === 0) { T *= alpha; continue; }
          const indices = multiGameDates[Math.floor(Math.random() * multiGameDates.length)];
          const a = Math.floor(Math.random() * indices.length);
          let b = Math.floor(Math.random() * (indices.length - 1));
          if (b >= a) b++;
          const swapI = indices[a], swapJ = indices[b];
          scorer.begin([swapI, swapJ]);
          const saved = swapSlots(swapI, swapJ, true);
          const newScore = scorer.end();
          const delta = newScore - currentScore;
          if (delta < 0 || Math.random() < Math.exp(-delta / T)) {
            currentScore = newScore;
            if (currentScore < bestScore) { bestScore = currentScore; bestSchedule = current.map(g => ({...g, sortKey: slotKey(g)})); }
          } else {
            scorer.begin([swapI, swapJ]);
            revertSwap(swapI, swapJ, saved);
            scorer.end();
          }
        } else if (r < 0.55) {
          // Cross-date swap
          const swapI = Math.floor(Math.random() * current.length);
          let swapJ = Math.floor(Math.random() * (current.length - 1));
          if (swapJ >= swapI) swapJ++;
          if (current[swapI].date === current[swapJ].date) { T *= alpha; continue; }
          scorer.begin([swapI, swapJ]);
          const saved = swapSlots(swapI, swapJ, false);
          if (!teamsValid([swapI, swapJ])) {
            revertSwap(swapI, swapJ, saved);
            scorer.end();
            T *= alpha;
            continue;
          }
          const newScore = scorer.end();
          const delta = newScore - currentScore;
          if (delta < 0 || Math.random() < Math.exp(-delta / T)) {
            currentScore = newScore;
            rebuildIndices();
            if (currentScore < bestScore) { bestScore = currentScore; bestSchedule = current.map(g => ({...g, sortKey: slotKey(g)})); }
          } else {
            scorer.begin([swapI, swapJ]);
            revertSwap(swapI, swapJ, saved);
            scorer.end();
          }
        } else if (r < 0.80) {
          // Relocate: move a game to an unused slot
          if (unusedSlots.length === 0) { T *= alpha; continue; }
          const gi = Math.floor(Math.random() * current.length);
          const si = Math.floor(Math.random() * unusedSlots.length);
          const newSlot = unusedSlots[si];
          const g = current[gi];
          const savedSlot = { date: g.date, dayOfWeek: g.dayOfWeek, weekendGroup: g.weekendGroup, time: g.time, field: g.field };
          const oldKey = slotKey(g);

          // Apply relocation
          scorer.begin([gi]);
          g.date = newSlot.date;
          g.dayOfWeek = newSlot.dayOfWeek;
          g.weekendGroup = newSlot.weekendGroup;
          g.time = newSlot.time;
          g.field = newSlot.field;

          if (!teamsValid([gi])) {
            // Revert
            Object.assign(g, savedSlot);
            scorer.end();
            T *= alpha;
            continue;
          }
          const newScore = scorer.end();
          const delta = newScore - currentScore;
          if (delta < 0 || Math.random() < Math.exp(-delta / T)) {
            currentScore = newScore;
            // Update used/unused tracking
            markUsed(newSlot.sortKey, oldKey);
            rebuildIndices();
            if (currentScore < bestScore) { bestScore = currentScore; bestSchedule = current.map(g => ({...g, sortKey: slotKey(g)})); }
          } else {
            scorer.begin([gi]);
            Object.assign(g, savedSlot);
            scorer.end();
          }
        } else {
          // Slide: move a weekend game to the nearest free slot earlier or later on the same field+date
          if (weekendIndices.length === 0) { T *= alpha; continue; }
          const gi = weekendIndices[Math.floor(Math.random() * weekendIndices.length)];
          const g = current[gi];
          const fdSlots = fieldDateSlots.get(g.field + '|' + g.date);
          if (!fdSlots) { T *= alpha; continue; }
          const idx = fdSlots.findIndex(s => s.time === g.time);
          if (idx === -1) { T *= alpha; continue; }

          const candidates = [];
          for (let k = idx - 1; k >= 0; k--) {
            if (!usedKeys.has(fdSlots[k].sortKey)) { candidates.push(fdSlots[k]); break; }
          }
          for (let k = idx + 1; k < fdSlots.length; k++) {
            if (!usedKeys.has(fdSlots[k].sortKey)) { candidates.push(fdSlots[k]); break; }
          }
          if (candidates.length === 0) { T *= alpha; continue; }

          const newSlot = candidates[Math.floor(Math.random() * candidates.length)];
          const oldKey = slotKey(g);
          const savedTime = g.time;
          scorer.begin([gi]);
          g.time = newSlot.time;
          const newScore = scorer.end();
          const delta = newScore - currentScore;
          if (delta < 0 || Math.random() < Math.exp(-delta / T)) {
            currentScore = newScore;
            markUsed(newSlot.sortKey, oldKey);
            if (currentScore < bestScore) { bestScore = currentScore; bestSchedule = current.map(g => ({...g, sortKey: slotKey(g)})); }
          } else {
            scorer.begin([gi]);
            g.time = savedTime;
            scorer.end();
          }
        }

        T *= alpha;
      }
      if (onProgress) onProgress(iter / maxIterations, bestScore);
      if (iter < maxIterations) {
        setTimeout(step, 0);
      } else {
        const finalScore = score(bestSchedule);
        resolve({ schedule: bestSchedule, score: finalScore, improved: finalScore < initialFullScore });
      }
    }
    step();
  });
}

// ─── Field Consolidation ──────────────────────────────────────────────────────
// For each weekend (field, date) with 1-2 games (source), try moving those games
// to another field (target) on the same date that has >= as many games and enough
// free slots to hold all games consecutively. Accepts only score improvements.
function consolidateFields(schedule, numTeams, slots, weights, otherGames) {
  const score = makeScorer(numTeams, slots, weights, otherGames);
  const current = schedule.map(g => ({...g}));

  const fieldDateSlots = new Map();
  for (const s of slots) {
    if (s.dayOfWeek !== 0 && s.dayOfWeek !== 6) continue;
    const fdKey = s.field + '|' + s.date;
    if (!fieldDateSlots.has(fdKey)) fieldDateSlots.set(fdKey, []);
    fieldDateSlots.get(fdKey).push(s);
  }
  for (const [, arr] of fieldDateSlots) arr.sort((a, b) => timeSortKey(a.time) - timeSortKey(b.time));

  let currentScore = score(current);

  function buildFieldDateGames() {
    const map = new Map();
    for (let gi = 0; gi < current.length; gi++) {
      const g = current[gi];
      if (g.dayOfWeek !== 0 && g.dayOfWeek !== 6) continue;
      const fdKey = g.field + '|' + g.date;
      if (!map.has(fdKey)) map.set(fdKey, []);
      map.get(fdKey).push(gi);
    }
    return map;
  }

  let anyImproved = true;
  while (anyImproved) {
    anyImproved = false;
    const fieldDateGames = buildFieldDateGames();

    // Group fd keys by date
    const dateToFdKeys = new Map();
    for (const fdKey of fieldDateGames.keys()) {
      const date = fdKey.split('|')[1];
      if (!dateToFdKeys.has(date)) dateToFdKeys.set(date, []);
      dateToFdKeys.get(date).push(fdKey);
    }

    outer:
    for (const fdKeys of dateToFdKeys.values()) {
      if (fdKeys.length < 2) continue;

      for (const srcKey of fdKeys) {
        const srcGames = fieldDateGames.get(srcKey);
        if (srcGames.length > 2) continue; // only consolidate small groups

        for (const tgtKey of fdKeys) {
          if (tgtKey === srcKey) continue;
          const tgtGames = fieldDateGames.get(tgtKey);
          if (tgtGames.length < srcGames.length) continue; // target must be at least as large

          const tgtField = tgtKey.split('|')[0];
          const tgtSlots = fieldDateSlots.get(tgtKey);
          if (!tgtSlots) continue;

          const combinedN = srcGames.length + tgtGames.length;
          if (tgtSlots.length < combinedN) continue; // not enough slots on target field

          // All games moving to target field, sorted by current time to preserve order
          const allIndices = [...srcGames, ...tgtGames];
          allIndices.sort((a, b) => timeSortKey(current[a].time) - timeSortKey(current[b].time));
          const savedState = allIndices.map(gi => ({ field: current[gi].field, time: current[gi].time }));

          let bestScore = currentScore;
          let bestWindow = -1;

          for (let w = 0; w <= tgtSlots.length - combinedN; w++) {
            for (let i = 0; i < combinedN; i++) {
              current[allIndices[i]].field = tgtField;
              current[allIndices[i]].time = tgtSlots[w + i].time;
            }
            const newScore = score(current);
            if (newScore < bestScore) { bestScore = newScore; bestWindow = w; }
            for (let i = 0; i < combinedN; i++) {
              current[allIndices[i]].field = savedState[i].field;
              current[allIndices[i]].time = savedState[i].time;
            }
          }

          if (bestWindow !== -1) {
            for (let i = 0; i < combinedN; i++) {
              current[allIndices[i]].field = tgtField;
              current[allIndices[i]].time = tgtSlots[bestWindow + i].time;
            }
            currentScore = bestScore;
            anyImproved = true;
            break outer;
          }
        }
      }
    }
  }

  for (const g of current) g.sortKey = slotKey(g);
  return current;
}

// ─── Field Repack Cleanup ─────────────────────────────────────────────────────
// For each weekend (field, date) with multiple games, try all windows of N
// consecutive available slots and apply the best packing. Repeats until no
// improvement or 100 passes.
function slideCleanup(schedule, numTeams, slots, weights, otherGames) {
  const score = makeScorer(numTeams, slots, weights, otherGames);
  const current = schedule.map(g => ({...g}));

  const fieldDateSlots = new Map();
  for (const s of slots) {
    if (s.dayOfWeek !== 0 && s.dayOfWeek !== 6) continue;
    const fdKey = s.field + '|' + s.date;
    if (!fieldDateSlots.has(fdKey)) fieldDateSlots.set(fdKey, []);
    fieldDateSlots.get(fdKey).push(s);
  }
  for (const [, arr] of fieldDateSlots) arr.sort((a, b) => timeSortKey(a.time) - timeSortKey(b.time));

  let currentScore = score(current);

  for (let pass = 0; pass < 100; pass++) {
    let improved = false;

    // Group game indices by field+date
    const fieldDateGames = new Map();
    for (let gi = 0; gi < current.length; gi++) {
      const g = current[gi];
      if (g.dayOfWeek !== 0 && g.dayOfWeek !== 6) continue;
      const fdKey = g.field + '|' + g.date;
      if (!fieldDateGames.has(fdKey)) fieldDateGames.set(fdKey, []);
      fieldDateGames.get(fdKey).push(gi);
    }

    for (const [fdKey, gameIndices] of fieldDateGames) {
      if (gameIndices.length < 2) continue;
      const fdSlots = fieldDateSlots.get(fdKey);
      if (!fdSlots || fdSlots.length < gameIndices.length) continue;

      const N = gameIndices.length;
      const M = fdSlots.length;
      if (N === M) continue; // already fills all slots, nothing to repack

      // Sort game indices by current time so assignment preserves order
      gameIndices.sort((a, b) => timeSortKey(current[a].time) - timeSortKey(current[b].time));
      const savedTimes = gameIndices.map(gi => current[gi].time);

      let bestScore = currentScore;
      let bestWindow = -1;

      for (let w = 0; w <= M - N; w++) {
        for (let i = 0; i < N; i++) current[gameIndices[i]].time = fdSlots[w + i].time;
        const newScore = score(current);
        if (newScore < bestScore) { bestScore = newScore; bestWindow = w; }
        for (let i = 0; i < N; i++) current[gameIndices[i]].time = savedTimes[i];
      }

      if (bestWindow !== -1) {
        for (let i = 0; i < N; i++) current[gameIndices[i]].time = fdSlots[bestWindow + i].time;
        currentScore = bestScore;
        improved = true;
      }
    }

    if (!improved) break;
  }

  for (const g of current) g.sortKey = slotKey(g);
  return current;
}

export { annealSchedule, consolidateFields, slideCleanup };
