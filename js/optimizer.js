import { slotKey, timeSortKey, isoWeek, teamHasThreeInFourDays } from './utils.js';
import { scoreCandidate } from './scoring.js';

// ─── Module 4b: Simulated Annealing ─────────────────────────────────────────
function annealSchedule(schedule, numTeams, slots, maxIterations, weights, onProgress) {
  if (!maxIterations) maxIterations = 2000;
  const current = schedule.map(g => ({...g}));
  let currentScore = scoreCandidate(current, numTeams, slots, weights);
  const initialScore = currentScore;
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
  let dateToGameIndices = buildDateIndex();
  const multiGameDates = () => [...dateToGameIndices.entries()].filter(([, idx]) => idx.length >= 2);

  // Build slot lookup by sortKey for relocations
  const slotBySortKey = new Map();
  for (const s of slots) slotBySortKey.set(s.sortKey, s);

  // Track which slot sortKeys are currently used
  const usedKeys = new Set();
  for (const g of current) usedKeys.add(g.sortKey);

  // Unused slots array (rebuilt periodically since relocations change it)
  let unusedSlots = slots.filter(s => !usedKeys.has(s.sortKey));

  // Precompute field+date → time-sorted slots for slide moves
  const fieldDateSlots = new Map();
  for (const s of slots) {
    if (s.dayOfWeek !== 0 && s.dayOfWeek !== 6) continue;
    const fdKey = s.field + '|' + s.date;
    if (!fieldDateSlots.has(fdKey)) fieldDateSlots.set(fdKey, []);
    fieldDateSlots.get(fdKey).push(s);
  }
  for (const [, arr] of fieldDateSlots) arr.sort((a, b) => timeSortKey(a.time) - timeSortKey(b.time));

  // Hard constraint validation for a single game's teams after relocation
  function relocateValid(gameIdx) {
    const teams = [current[gameIdx].home, current[gameIdx].away];
    for (const t of teams) {
      const dates = [];
      for (const g of current) {
        if (g.home === t || g.away === t) dates.push(g.date);
      }
      dates.sort();
      for (let k = 1; k < dates.length; k++) {
        if (dates[k] === dates[k - 1]) return false;
      }
      if (teamHasThreeInFourDays(dates)) return false;
      const weekdayByWeek = new Map();
      for (const d of dates) {
        const dt = new Date(d + 'T00:00:00');
        const dow = dt.getDay();
        if (dow >= 1 && dow <= 5) {
          const wk = isoWeek(d);
          weekdayByWeek.set(wk, (weekdayByWeek.get(wk) || 0) + 1);
          if (weekdayByWeek.get(wk) > 1) return false;
        }
      }
    }
    return true;
  }

  // Hard constraint validation for cross-date swaps (applied after swap)
  function crossDateSwapValid(i, j) {
    const affectedTeams = new Set([current[i].home, current[i].away, current[j].home, current[j].away]);
    for (const t of affectedTeams) {
      const dates = [];
      for (const g of current) {
        if (g.home === t || g.away === t) dates.push(g.date);
      }
      dates.sort();
      for (let k = 1; k < dates.length; k++) {
        if (dates[k] === dates[k - 1]) return false;
      }
      if (teamHasThreeInFourDays(dates)) return false;
      const weekdayByWeek = new Map();
      for (const d of dates) {
        const dt = new Date(d + 'T00:00:00');
        const dow = dt.getDay();
        if (dow >= 1 && dow <= 5) {
          const wk = isoWeek(d);
          weekdayByWeek.set(wk, (weekdayByWeek.get(wk) || 0) + 1);
          if (weekdayByWeek.get(wk) > 1) return false;
        }
      }
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
    function step() {
      const batchEnd = Math.min(iter + 100, maxIterations);
      for (; iter < batchEnd; iter++) {
        const r = Math.random();
        // Move types: 40% same-date swap, 15% cross-date swap, 25% relocate, 20% slide
        if (r < 0.4) {
          // Same-date swap
          const candidates = multiGameDates();
          if (candidates.length === 0) { T *= alpha; continue; }
          const [, indices] = candidates[Math.floor(Math.random() * candidates.length)];
          const a = Math.floor(Math.random() * indices.length);
          let b = Math.floor(Math.random() * (indices.length - 1));
          if (b >= a) b++;
          const swapI = indices[a], swapJ = indices[b];
          const saved = swapSlots(swapI, swapJ, true);

          const newScore = scoreCandidate(current, numTeams, slots, weights);
          const delta = newScore - currentScore;
          if (delta < 0 || Math.random() < Math.exp(-delta / T)) {
            currentScore = newScore;
            if (currentScore < bestScore) { bestScore = currentScore; bestSchedule = current.map(g => ({...g, sortKey: slotKey(g)})); }
          } else {
            revertSwap(swapI, swapJ, saved);
          }
        } else if (r < 0.55) {
          // Cross-date swap
          const swapI = Math.floor(Math.random() * current.length);
          let swapJ = Math.floor(Math.random() * (current.length - 1));
          if (swapJ >= swapI) swapJ++;
          if (current[swapI].date === current[swapJ].date) { T *= alpha; continue; }
          const saved = swapSlots(swapI, swapJ, false);
          if (!crossDateSwapValid(swapI, swapJ)) {
            revertSwap(swapI, swapJ, saved);
            T *= alpha;
            continue;
          }

          const newScore = scoreCandidate(current, numTeams, slots, weights);
          const delta = newScore - currentScore;
          if (delta < 0 || Math.random() < Math.exp(-delta / T)) {
            currentScore = newScore;
            dateToGameIndices = buildDateIndex();
            if (currentScore < bestScore) { bestScore = currentScore; bestSchedule = current.map(g => ({...g, sortKey: slotKey(g)})); }
          } else {
            revertSwap(swapI, swapJ, saved);
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
          g.date = newSlot.date;
          g.dayOfWeek = newSlot.dayOfWeek;
          g.weekendGroup = newSlot.weekendGroup;
          g.time = newSlot.time;
          g.field = newSlot.field;

          if (!relocateValid(gi)) {
            // Revert
            Object.assign(g, savedSlot);
            T *= alpha;
            continue;
          }

          const newScore = scoreCandidate(current, numTeams, slots, weights);
          const delta = newScore - currentScore;
          if (delta < 0 || Math.random() < Math.exp(-delta / T)) {
            currentScore = newScore;
            // Update used/unused tracking
            usedKeys.delete(oldKey);
            usedKeys.add(newSlot.sortKey);
            unusedSlots[si] = slotBySortKey.get(oldKey) || { ...savedSlot, sortKey: oldKey };
            dateToGameIndices = buildDateIndex();
            if (currentScore < bestScore) { bestScore = currentScore; bestSchedule = current.map(g => ({...g, sortKey: slotKey(g)})); }
          } else {
            Object.assign(g, savedSlot);
          }
        } else {
          // Slide: move a weekend game one slot earlier or later on the same field+date
          const weekendIndices = [];
          for (let k = 0; k < current.length; k++) {
            if (current[k].dayOfWeek === 0 || current[k].dayOfWeek === 6) weekendIndices.push(k);
          }
          if (weekendIndices.length === 0) { T *= alpha; continue; }
          const gi = weekendIndices[Math.floor(Math.random() * weekendIndices.length)];
          const g = current[gi];
          const fdKey = g.field + '|' + g.date;
          const fdSlots = fieldDateSlots.get(fdKey);
          if (!fdSlots) { T *= alpha; continue; }
          const idx = fdSlots.findIndex(s => s.time === g.time);
          if (idx === -1) { T *= alpha; continue; }

          const candidates = [];
          if (idx > 0 && !usedKeys.has(fdSlots[idx - 1].sortKey)) candidates.push(fdSlots[idx - 1]);
          if (idx < fdSlots.length - 1 && !usedKeys.has(fdSlots[idx + 1].sortKey)) candidates.push(fdSlots[idx + 1]);
          if (candidates.length === 0) { T *= alpha; continue; }

          const newSlot = candidates[Math.floor(Math.random() * candidates.length)];
          const oldKey = slotKey(g);
          const savedTime = g.time;
          g.time = newSlot.time;

          const newScore = scoreCandidate(current, numTeams, slots, weights);
          const delta = newScore - currentScore;
          if (delta < 0 || Math.random() < Math.exp(-delta / T)) {
            currentScore = newScore;
            usedKeys.delete(oldKey);
            usedKeys.add(newSlot.sortKey);
            const newSlotUnusedIdx = unusedSlots.findIndex(s => s.sortKey === newSlot.sortKey);
            if (newSlotUnusedIdx !== -1) unusedSlots[newSlotUnusedIdx] = slotBySortKey.get(oldKey);
            if (currentScore < bestScore) { bestScore = currentScore; bestSchedule = current.map(g => ({...g, sortKey: slotKey(g)})); }
          } else {
            g.time = savedTime;
          }
        }

        T *= alpha;
      }
      if (onProgress) onProgress(iter / maxIterations, bestScore);
      if (iter < maxIterations) {
        setTimeout(step, 0);
      } else {
        resolve({ schedule: bestSchedule, score: bestScore, improved: bestScore < initialScore });
      }
    }
    step();
  });
}

// ─── Field Consolidation ──────────────────────────────────────────────────────
// For each weekend (field, date) with 1-2 games (source), try moving those games
// to another field (target) on the same date that has >= as many games and enough
// free slots to hold all games consecutively. Accepts only score improvements.
function consolidateFields(schedule, numTeams, slots, weights) {
  const current = schedule.map(g => ({...g}));

  const fieldDateSlots = new Map();
  for (const s of slots) {
    if (s.dayOfWeek !== 0 && s.dayOfWeek !== 6) continue;
    const fdKey = s.field + '|' + s.date;
    if (!fieldDateSlots.has(fdKey)) fieldDateSlots.set(fdKey, []);
    fieldDateSlots.get(fdKey).push(s);
  }
  for (const [, arr] of fieldDateSlots) arr.sort((a, b) => timeSortKey(a.time) - timeSortKey(b.time));

  let currentScore = scoreCandidate(current, numTeams, slots, weights);

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
            const newScore = scoreCandidate(current, numTeams, slots, weights);
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
function slideCleanup(schedule, numTeams, slots, weights) {
  const current = schedule.map(g => ({...g}));

  const fieldDateSlots = new Map();
  for (const s of slots) {
    if (s.dayOfWeek !== 0 && s.dayOfWeek !== 6) continue;
    const fdKey = s.field + '|' + s.date;
    if (!fieldDateSlots.has(fdKey)) fieldDateSlots.set(fdKey, []);
    fieldDateSlots.get(fdKey).push(s);
  }
  for (const [, arr] of fieldDateSlots) arr.sort((a, b) => timeSortKey(a.time) - timeSortKey(b.time));

  let currentScore = scoreCandidate(current, numTeams, slots, weights);

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
        const newScore = scoreCandidate(current, numTeams, slots, weights);
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
