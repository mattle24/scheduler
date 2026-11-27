import { hasSchedule, startSchedule } from './scheduleSession.js';
import { WEIGHTS } from './constants.js';
import { parseTSV } from './parser.js?v=3';
import { buildSchedule } from './builder.js?v=3';
import { scoreCrossfieldDivisionClustering, scoreDetails, scoreWeekendOtherDivField } from './scoring.js';
import { readDivisions, readDivWeightOverrides, syncWeights } from './divisions.js?v=5';
import { showError, clearError } from './render.js?v=3';

function generate() {
  clearError();
  document.getElementById('editTab').disabled = true;
  document.getElementById('results').classList.add('hidden');
  document.getElementById('resultsTab').disabled = true;
  const statusBox = document.getElementById('statusBox');
  statusBox.classList.remove('hidden');
  statusBox.innerHTML = 'Preparing...';

  setTimeout(async () => {
    try {
      const divs = readDivisions();
      const tsvText = document.getElementById('tsvInput').value;
      if (!tsvText.trim()) throw new Error('Please enter field availability data');

      syncWeights();
      const allSlots = parseTSV(tsvText);
      const claimedKeys = new Set();
      const divisionResults = [];
      const MAX_ROUNDS = 3;
      const maxPasses = divs.length * (1 + MAX_ROUNDS);
      let completedPasses = 0;
      const updateProgress = (activity, pct, score) => {
        const percent = Math.floor(completedPasses / maxPasses * 100);
        document.getElementById('progressFill').style.width = percent + '%';
        const activityLabel = pct == null ? `${activity}…` : `${activity}: ${Math.round(pct * 100)}%`;
        const label = `${completedPasses} of up to ${maxPasses} passes completed — ${activityLabel}`;
        document.getElementById('progressLabel').textContent = Number.isFinite(score) ? label + ' — quality score: ' + score.toFixed(1) + ' (lower is better)' : label;
      };

      // Strategy 2: Compute slot scarcity — how many divisions can use each slot
      // Higher scarcity = more divisions competing for this slot, so current division
      // should prefer alternatives when available
      const slotScarcity = new Map();
      if (divs.length > 1) {
        for (const s of allSlots) {
          let divCount = 0;
          for (const d of divs) {
            if (d.fields.includes(s.field) && !d.excludedDays.includes(s.dayOfWeek)) divCount++;
          }
          // Only record scarcity for shared slots (2+ divisions)
          if (divCount > 1) slotScarcity.set(s.sortKey, divCount - 1);
        }
      }

      const divisionWeights = Array.from(
        document.querySelectorAll('#divisionTable tbody tr:not(.div-weights-row)'),
        readDivWeightOverrides
      );

      for (let i = 0; i < divs.length; i++) {
        const div = divs[i];
        const divLabel = `Initial build — division ${i + 1} of ${divs.length}: "${div.name}"`;

        // Filter slots to this division's valid fields minus already-claimed slots and excluded days
        const divSlots = allSlots.filter(s =>
          div.fields.includes(s.field) && !claimedKeys.has(s.sortKey) && !div.excludedDays.includes(s.dayOfWeek)
        );

        // Read per-division weight overrides from the weights panel for this row
        const divWeightOverrides = divisionWeights[i];

        // Phase 1: Build
        statusBox.innerHTML = `
          <div>${divLabel}</div>
          <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
          <div class="progress-label" id="progressLabel">0% of maximum passes</div>`;
        updateProgress('Building candidates', 0, Infinity);

        const result = await buildSchedule(div.numTeams, div.gamesPerTeam, divSlots, updateProgress,
          { leagueSplit: div.leagueSplit, slotScarcity, weights: divWeightOverrides });
        completedPasses++;

        const finalSchedule = result.schedule;
        const finalDetails = scoreDetails(finalSchedule, div.numTeams, divSlots);

        // Claim the slots used by this division
        for (const g of finalSchedule) claimedKeys.add(g.sortKey);

        divisionResults.push({
          division: div,
          weights: divWeightOverrides,
          schedule: finalSchedule,
          details: finalDetails,
          greedyDetails: result.details,
          slots: divSlots
        });
      }

      // Strategy 1: Iterative re-scheduling — release each division's slots and
      // re-schedule it with knowledge of what other divisions actually claimed.
      // Accept the new schedule only if the global score improves.
      // For single divisions this still helps: each round is an independent
      // greedy+anneal attempt with fresh randomness; best result is kept.
      {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          let improved = false;


          for (let i = 0; i < divisionResults.length; i++) {
            const dr = divisionResults[i];
            const div = dr.division;
            const divLabel = `Re-optimization round ${round + 1} of up to ${MAX_ROUNDS} — division ${i + 1} of ${divisionResults.length}: "${div.name}"`;

            // Release this division's slots
            const releasedKeys = new Set();
            for (const g of dr.schedule) {
              claimedKeys.delete(g.sortKey);
              releasedKeys.add(g.sortKey);
            }

            // Re-filter slots for this division (its fields, minus other divisions' claims and excluded days)
            const divSlots = allSlots.filter(s =>
              div.fields.includes(s.field) && !claimedKeys.has(s.sortKey) && !div.excludedDays.includes(s.dayOfWeek)
            );

            statusBox.innerHTML = `
              <div>${divLabel}</div>
              <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
              <div class="progress-label" id="progressLabel">0% of maximum passes</div>`;
            updateProgress('Building candidates', 0, Infinity);

            // Collect other divisions' games (tagged with division name) so the
            // greedy builder and optimizer can score cross-division clustering
            const otherDivisionGames = divisionResults
              .filter((_, j) => j !== i)
              .flatMap(r => r.schedule.map(g => ({ ...g, division: r.division.name })));

            const divWeightOverrides = divisionWeights[i];
            const result = await buildSchedule(div.numTeams, div.gamesPerTeam, divSlots, updateProgress,
              { leagueSplit: div.leagueSplit, slotScarcity, otherDivisionGames, weights: divWeightOverrides });
            completedPasses++;

            const newSchedule = result.schedule;
            const newDetails = scoreDetails(newSchedule, div.numTeams, divSlots);

            // Compare: does replacing this division improve the global score (including cross-division clustering)?
            // Temporarily swap in the new schedule to compute global scores
            // Score old and new against the same slot pool (divSlots) so the
            // comparison isn't skewed by slot-derived terms like active weekends.
            const oldRescored = scoreDetails(dr.schedule, div.numTeams, divSlots);
            divisionResults[i] = { ...dr, details: oldRescored, slots: divSlots };
            const currentGlobalScore = globalScore(divisionResults);
            divisionResults[i] = { ...dr, schedule: newSchedule, details: newDetails, slots: divSlots };
            const newGlobalScore = globalScore(divisionResults);
            divisionResults[i] = dr;

            if (newGlobalScore < currentGlobalScore) {
              // Accept: update division result and claim new slots
              divisionResults[i] = {
                division: div,
                weights: divWeightOverrides,
                schedule: newSchedule,
                details: newDetails,
                greedyDetails: result.details,
                slots: divSlots
              };
              for (const g of newSchedule) claimedKeys.add(g.sortKey);
              improved = true;
            } else {
              // Reject: re-claim original slots
              for (const key of releasedKeys) claimedKeys.add(key);
            }
          }

          if (!improved) break; // No division improved — converged
        }
      }

      startSchedule(divisionResults, allSlots, {...WEIGHTS});
      statusBox.classList.add('hidden');
      document.getElementById('results').classList.remove('hidden');

    } catch (e) {
      statusBox.classList.add('hidden');
      document.getElementById('resultsTab').disabled = !hasSchedule();
      document.getElementById('editTab').disabled = !hasSchedule();
      showError(e.message);
    }
  }, 50);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function globalScore(divisionResults) {
  return divisionResults.reduce((sum, r) => sum + weightedScore(r.details, r.weights), 0)
    + scoreCrossfieldDivisionClustering(divisionResults) * (WEIGHTS.fieldDivisionClustering || 0)
    + scoreWeekendOtherDivField(divisionResults) * (WEIGHTS.weekendOtherDivField || 0);
}

// Per-division score using the same weights (global + division overrides) the
// division was optimized with.
function weightedScore(d, overrides) {
  const W = overrides ? { ...WEIGHTS, ...overrides } : WEIGHTS;
  let score = 0;
  for (const key in W) {
    if (d[key] != null) score += d[key] * W[key];
  }
  return score;
}

export { generate, globalScore, weightedScore };
