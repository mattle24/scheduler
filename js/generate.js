// @ts-check
/** @typedef {import('./types.js').Slot} Slot */
/** @typedef {import('./types.js').DivisionConfig} DivisionConfig */
/** @typedef {import('./types.js').DivisionResult} DivisionResult */
/** @typedef {import('./types.js').Weights} Weights */
/** @typedef {import('./types.js').ScoreDetails} ScoreDetails */
import { hasSchedule, startSchedule } from './scheduleSession.js';
import { WEIGHTS } from './constants.js';
// @ts-expect-error Browser cache-busting query strings are not resolved by TypeScript.
import { parseTSV } from './parser.js?v=3';
// @ts-expect-error Browser cache-busting query strings are not resolved by TypeScript.
import { buildSchedule } from './builder.js?v=3';
import { scoreCrossfieldDivisionClustering, scoreDetails, scoreWeekendOtherDivField } from './scoring.js';
// @ts-expect-error Browser cache-busting query strings are not resolved by TypeScript.
import { readDivisions, readDivWeightOverrides, syncWeights } from './divisions.js?v=5';
// @ts-expect-error Browser cache-busting query strings are not resolved by TypeScript.
import { showError, clearError } from './render.js?v=4';

/** @template {HTMLElement} T @param {string} id @param {{new (...args: any[]): T}} Ctor @returns {T} */
function byId(id, Ctor) {
  const node = document.getElementById(id);
  if (!(node instanceof Ctor)) throw new Error(`Missing or invalid element: ${id}`);
  return node;
}

let generating = false;

function isGenerating() {
  return generating;
}

function generate() {
  if (generating) return;
  clearError();
  byId('editTab', HTMLButtonElement).disabled = true;
  byId('results', HTMLElement).classList.add('hidden');
  byId('resultsTab', HTMLButtonElement).disabled = true;
  const statusBox = byId('statusBox', HTMLElement);
  statusBox.classList.remove('hidden');
  statusBox.textContent = 'Preparing...';
  generating = true;
  document.dispatchEvent(new Event('scheduler:generation-status'));

  setTimeout(async () => {
    try {
      const divs = /** @type {DivisionConfig[]} */ (readDivisions());
      const tsvText = byId('tsvInput', HTMLTextAreaElement).value;
      if (!tsvText.trim()) throw new Error('Please enter field availability data');

      syncWeights();
      const allSlots = /** @type {Slot[]} */ (parseTSV(tsvText));
      const claimedKeys = new Set();
      /** @type {(DivisionResult & {schedule: (import("./types.js").Game & {sortKey: string})[]})[]} */
      const divisionResults = [];
      const MAX_ROUNDS = 3;
      const maxPasses = divs.length * (1 + MAX_ROUNDS);
      let completedPasses = 0;
      statusBox.innerHTML = `
        <div></div>
        <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
        <div class="progress-label" id="progressLabel"></div>`;
      const divisionLabel = /** @type {HTMLElement} */ (statusBox.firstElementChild);
      const progressFill = /** @type {HTMLElement} */ (statusBox.querySelector('#progressFill'));
      const progressLabel = /** @type {HTMLElement} */ (statusBox.querySelector('#progressLabel'));
      /** @param {string} activity @param {number|null} pct @param {number} score */
      const updateProgress = (activity, pct, score) => {
        const percent = Math.floor(completedPasses / maxPasses * 100);
        progressFill.style.width = percent + '%';
        const activityLabel = pct == null ? `${activity}…` : `${activity}: ${Math.round(pct * 100)}%`;
        const label = `${completedPasses} of up to ${maxPasses} passes completed — ${activityLabel}`;
        progressLabel.textContent = Number.isFinite(score) ? label + ' — quality score: ' + score.toFixed(1) + ' (lower is better)' : label;
      };
      /** @param {string} label */
      const showDivisionProgress = label => {
        divisionLabel.textContent = label;
        updateProgress('Building candidates', 0, Infinity);
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
        showDivisionProgress(divLabel);

        const result = await (/** @type {typeof import('./builder.js').buildSchedule} */ (buildSchedule))(div.numTeams, div.gamesPerTeam, divSlots, updateProgress,
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

            showDivisionProgress(divLabel);

            // Collect other divisions' games (tagged with division name) so the
            // greedy builder and optimizer can score cross-division clustering
            const otherDivisionGames = divisionResults
              .filter((_, j) => j !== i)
              .flatMap(r => r.schedule.map(g => ({ ...g, division: r.division.name })));

            const divWeightOverrides = divisionWeights[i];
            const result = await (/** @type {typeof import('./builder.js').buildSchedule} */ (buildSchedule))(div.numTeams, div.gamesPerTeam, divSlots, updateProgress,
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
      byId('results', HTMLElement).classList.remove('hidden');

    } catch (e) {
      byId('resultsTab', HTMLButtonElement).disabled = !hasSchedule();
      byId('editTab', HTMLButtonElement).disabled = !hasSchedule();
      showError(/** @type {Error} */ (e).message);
    } finally {
      statusBox.classList.add('hidden');
      generating = false;
      document.dispatchEvent(new Event('scheduler:generation-status'));
    }
  }, 50);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/** @param {DivisionResult[]} divisionResults */
function globalScore(divisionResults) {
  return divisionResults.reduce((sum, r) => sum + weightedScore(r.details, r.weights), 0)
    + scoreCrossfieldDivisionClustering(divisionResults) * (WEIGHTS.fieldDivisionClustering || 0)
    + scoreWeekendOtherDivField(divisionResults) * (WEIGHTS.weekendOtherDivField || 0);
}

// Per-division score using the same weights (global + division overrides) the
// division was optimized with.
/** @param {ScoreDetails} d @param {Partial<Weights>|undefined} overrides */
function weightedScore(d, overrides) {
  const W = overrides ? { ...WEIGHTS, ...overrides } : WEIGHTS;
  let score = 0;
  for (const key of /** @type {(keyof ScoreDetails & keyof Weights)[]} */ (Object.keys(W))) {
    if (d[key] != null) score += d[key] * W[key];
  }
  return score;
}

export { generate, isGenerating, globalScore, weightedScore };
