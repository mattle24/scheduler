import { WEIGHTS } from './constants.js';
import { parseTSV } from './parser.js';
import { buildSchedule } from './builder.js';
import { scoreCrossfieldDivisionClustering, scoreDetails, scoreWeekendOtherDivField } from './scoring.js';
import { readDivisions, readDivWeightOverrides, syncWeights } from './divisions.js';
import { renderMultiDivisionResults, showError, clearError, setLastCSV, formatMultiDivisionCSV } from './render.js';

function generate() {
  clearError();
  document.getElementById('results').classList.add('hidden');
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

      const mainRows = document.querySelectorAll('#divisionTable tbody tr:not(.div-weights-row)');

      for (let i = 0; i < divs.length; i++) {
        const div = divs[i];
        const divLabel = `Division "${div.name}" (${i + 1}/${divs.length})`;

        // Filter slots to this division's valid fields minus already-claimed slots and excluded days
        const divSlots = allSlots.filter(s =>
          div.fields.includes(s.field) && !claimedKeys.has(s.sortKey) && !div.excludedDays.includes(s.dayOfWeek)
        );

        // Read per-division weight overrides from the weights panel for this row
        const divWeightOverrides = readDivWeightOverrides(mainRows[i]);

        // Phase 1: Build
        statusBox.innerHTML = `
          <div>${divLabel}: Building schedule...</div>
          <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
          <div class="progress-label" id="progressLabel">0%</div>`;

        const result = await buildSchedule(div.numTeams, div.gamesPerTeam, divSlots, (pct, score) => {
          const percent = Math.round(pct * 100);
          document.getElementById('progressFill').style.width = percent + '%';
          const label = score === Infinity ? percent + '%' : percent + '% — score: ' + score.toFixed(1);
          document.getElementById('progressLabel').textContent = label;
        }, { leagueSplit: div.leagueSplit, slotScarcity, weights: divWeightOverrides });

        const finalSchedule = result.schedule;
        const finalDetails = scoreDetails(finalSchedule, div.numTeams, divSlots);

        // Claim the slots used by this division
        for (const g of finalSchedule) claimedKeys.add(g.sortKey);

        divisionResults.push({
          division: div,
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
        const MAX_ROUNDS = 3;
        for (let round = 0; round < MAX_ROUNDS; round++) {
          let improved = false;

          let currentGlobalScore = globalScore(divisionResults);

          for (let i = 0; i < divisionResults.length; i++) {
            const dr = divisionResults[i];
            const div = dr.division;
            const divLabel = `Re-optimizing "${div.name}" (round ${round + 1}/${MAX_ROUNDS})`;

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
              <div class="progress-label" id="progressLabel">0%</div>`;

            // Collect other divisions' games so the greedy builder can cluster
            const otherDivisionGames = divisionResults
              .filter((_, j) => j !== i)
              .flatMap(r => r.schedule);

            const divWeightOverrides = readDivWeightOverrides(mainRows[i]);
            const result = await buildSchedule(div.numTeams, div.gamesPerTeam, divSlots, (pct, score) => {
              const percent = Math.round(pct * 100);
              document.getElementById('progressFill').style.width = percent + '%';
              const label = score === Infinity ? percent + '%' : percent + '% — score: ' + score.toFixed(1);
              document.getElementById('progressLabel').textContent = label;
            }, { leagueSplit: div.leagueSplit, slotScarcity, otherDivisionGames, weights: divWeightOverrides });

            const newSchedule = result.schedule;
            const newDetails = scoreDetails(newSchedule, div.numTeams, divSlots);

            // Compare: does replacing this division improve the global score (including cross-division clustering)?
            // Temporarily swap in the new schedule to compute global scores
            const oldDetails = dr.details;
            const oldSchedule = dr.schedule;
            divisionResults[i] = { ...dr, schedule: newSchedule, details: newDetails, slots: divSlots };
            const newGlobalScore = globalScore(divisionResults);
            divisionResults[i] = { ...dr, schedule: oldSchedule, details: oldDetails };

            if (newGlobalScore < currentGlobalScore) {
              // Accept: update division result and claim new slots
              divisionResults[i] = {
                division: div,
                schedule: newSchedule,
                details: newDetails,
                greedyDetails: result.details,
                slots: divSlots
              };
              for (const g of newSchedule) claimedKeys.add(g.sortKey);
              currentGlobalScore = newGlobalScore;
              improved = true;
            } else {
              // Reject: re-claim original slots
              for (const key of releasedKeys) claimedKeys.add(key);
            }
          }

          if (!improved) break; // No division improved — converged
        }
      }

      setLastCSV(formatMultiDivisionCSV(divisionResults));
      renderMultiDivisionResults(divisionResults, allSlots);
      statusBox.classList.add('hidden');
      document.getElementById('results').classList.remove('hidden');
    } catch (e) {
      statusBox.classList.add('hidden');
      showError(e.message);
    }
  }, 50);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function globalScore(divisionResults) {
  return divisionResults.reduce((sum, r) => sum + weightedScore(r.details), 0)
    + scoreCrossfieldDivisionClustering(divisionResults) * (WEIGHTS.fieldDivisionClustering || 0)
    + scoreWeekendOtherDivField(divisionResults) * (WEIGHTS.weekendOtherDivField || 0);
}

function weightedScore(d) {
  let score = 0;
  for (const key in WEIGHTS) {
    if (d[key] != null) score += d[key] * WEIGHTS[key];
  }
  return score;
}

export { generate, globalScore, weightedScore };
