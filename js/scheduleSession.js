// @ts-nocheck -- Pending migration to checked JSDoc.
import { WEIGHTS } from './constants.js';
import { scoreDetails } from './scoring.js';
import { renderMultiDivisionResults, setLastCSV, formatMultiDivisionCSV } from './render.js?v=4';
import { SCHEDULE_STORAGE_KEY, saveScheduleSnapshot, decodeSchedule } from './scheduleStorage.js';
import { mountEditor } from './scheduleEditor.js';

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

function setSaveStatus(unsaved) {
  if (scheduleUnsaved === unsaved) return;
  scheduleUnsaved = unsaved;
  document.dispatchEvent(new CustomEvent('scheduler:save-status', {
    detail: { part: 'schedule', unsaved },
  }));
}

function storageNotice(message = '') {
  const el = document.getElementById('scheduleStorageNotice');
  el.textContent = message;
  el.hidden = !message;
}
function persist() {
  let saved = false;
  try {
    saved = saveScheduleSnapshot(session, localStorage);
  } catch {}
  setSaveStatus(!saved);
  return saved;
}
function refreshResults() {
  for (const r of session.results)
    r.details = scoreDetails(r.schedule, r.division.numTeams, r.slots);
  setLastCSV(formatMultiDivisionCSV(session.results));
  renderMultiDivisionResults(session.results, session.allSlots, {
    reviewState: session.reviewState,
    onEditGame(divisionIndex, game) {
      if (session.selectGameForReview(divisionIndex, game)) {
        const tab = document.getElementById('editTab');
        tab.click();
        tab.focus();
      }
    }
  });
}
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
  session.selectGameForReview = mountEditor(session, (games) => {
    session.results.forEach((r, i) => {
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
  document.getElementById('results').replaceChildren();
  document.getElementById('editSchedule').replaceChildren();
  document.getElementById('editTab').disabled = true;
  document.getElementById('resultsTab').disabled = true;
  storageNotice();
  setSaveStatus(!saved);
  document.dispatchEvent(new Event('scheduler:schedule-cleared'));
  return saved;
}
