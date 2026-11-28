// @ts-check
/** @typedef {import('./types.js').Game} Game */
/** @typedef {import('./types.js').Slot} Slot */
/** @typedef {import('./types.js').Weights} Weights */
/** @typedef {import('./types.js').DivisionConfig} DivisionConfig */
/** @typedef {{division: DivisionConfig, weights?: Partial<Weights>, schedule: Game[], details?: import('./types.js').ScoreDetails, slots?: Slot[]}} InputResult */
/** @typedef {InputResult & {slots: Slot[], weights: Weights}} SessionResult */
/** @typedef {{results: SessionResult[], allSlots: Slot[], baseWeights: Weights, reviewState: any[], selectGameForReview?: (divisionIndex: number, game: Game) => boolean}} Session */
/** @typedef {Game & {id: string, division: string}} EditorGame */
import { WEIGHTS } from './constants.js';
import { scoreDetails } from './scoring.js';
// @ts-expect-error Browser cache-busting query strings are not resolved by TypeScript.
import { renderMultiDivisionResults, setLastCSV, formatMultiDivisionCSV } from './render.js?v=4';
import { SCHEDULE_STORAGE_KEY, saveScheduleSnapshot, decodeSchedule } from './scheduleStorage.js';
import { mountEditor } from './scheduleEditor.js';

/** @type {Session|null} */
let session = null;
let scheduleUnsaved = false;

export function hasSchedule() {
  return session !== null;
}

export function getScheduleSnapshot() {
  if (!session) return null;
  const { results, allSlots, baseWeights } = session;
  return { results, allSlots, baseWeights };
}

export function isScheduleUnsaved() {
  return scheduleUnsaved;
}

/** @param {boolean} unsaved */
function setSaveStatus(unsaved) {
  if (scheduleUnsaved === unsaved) return;
  scheduleUnsaved = unsaved;
  document.dispatchEvent(new CustomEvent('scheduler:save-status', {
    detail: { part: 'schedule', unsaved },
  }));
}

function storageNotice(message = '') {
  const el = /** @type {HTMLElement} */ (document.getElementById('scheduleStorageNotice'));
  el.textContent = message;
  el.hidden = !message;
}
function persist() {
  let saved = false;
  try {
    saved = saveScheduleSnapshot(/** @type {Session} */ (session), localStorage);
  } catch {}
  setSaveStatus(!saved);
  return saved;
}
function refreshResults() {
  const active = /** @type {Session} */ (session);
  for (const r of active.results)
    r.details = scoreDetails(r.schedule, r.division.numTeams, r.slots);
  setLastCSV(formatMultiDivisionCSV(active.results));
  renderMultiDivisionResults(active.results, active.allSlots, {
    reviewState: active.reviewState,
    /** @param {number} divisionIndex @param {Game} game */
    onEditGame(divisionIndex, game) {
      if (/** @type {NonNullable<Session["selectGameForReview"]>} */ (active.selectGameForReview)(divisionIndex, game)) {
        const tab = /** @type {HTMLElement} */ (document.getElementById('editTab'));
        tab.click();
        tab.focus();
      }
    }
  });
}
/** @param {InputResult[]} results @param {Slot[]} allSlots @param {Weights} [baseWeights] @param {boolean} [save] */
export function startSchedule(results, allSlots, baseWeights = { ...WEIGHTS }, save = true) {
  session = {
    results: results.map((r) => ({
      ...r,
      division: structuredClone(r.division),
      weights: { ...baseWeights, ...r.weights },
      // A manual cross-division swap can reach any eligible slot. Keep one fixed
      // availability pool for all previews, independent of which games occupy it.
      slots: allSlots.filter(
        (s) => r.division.fields.includes(s.field) && !r.division.excludedDays.includes(s.dayOfWeek)
      ),
      schedule: r.schedule.map((g) => ({ ...g })),
    })),
    allSlots,
    baseWeights: { ...baseWeights },
    reviewState: [],
  };
  session.selectGameForReview = mountEditor(session, (/** @type {EditorGame[]} */ games) => {
    /** @type {Session} */ (session).results.forEach((r, i) => {
      r.schedule = games
        .filter((g) => g.division === String(i))
        .map(({ id, division, ...g }) => ({ ...g, home: g.home - 1, away: g.away - 1 }));
    });
    refreshResults();
    persist();
  });
  refreshResults();
  storageNotice();
  const saved = !save || persist();
  if (!save) setSaveStatus(false);
  document.dispatchEvent(new Event('scheduler:results-ready'));
  return saved;
}
export function restoreSchedule({ remote = false } = {}) {
  try {
    const text = localStorage.getItem(SCHEDULE_STORAGE_KEY);
    if (!text) {
      if (remote) clearSchedule({ remote });
      return;
    }
    const { results, allSlots, baseWeights } = decodeSchedule(text);
    startSchedule(results, allSlots, baseWeights, false);
  } catch {
    clearSchedule({ remote: true });
    if (!remote) removeSavedSchedule();
    storageNotice('The saved schedule could not be restored. Generate a new schedule from Setup.');
  }
}

function removeSavedSchedule() {
  try {
    localStorage.removeItem(SCHEDULE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function clearSchedule({ remote = false } = {}) {
  session = null;
  const saved = remote || removeSavedSchedule();
  setLastCSV('');
  (/** @type {HTMLElement} */ (document.getElementById('results'))).replaceChildren();
  (/** @type {HTMLElement} */ (document.getElementById('editSchedule'))).replaceChildren();
  (/** @type {HTMLButtonElement} */ (document.getElementById('editTab'))).disabled = true;
  (/** @type {HTMLButtonElement} */ (document.getElementById('resultsTab'))).disabled = true;
  storageNotice();
  setSaveStatus(!saved);
  document.dispatchEvent(new Event('scheduler:schedule-cleared'));
  return saved;
}
