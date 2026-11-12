import { WEIGHTS } from './constants.js';
import { scoreDetails } from './scoring.js';
import { renderMultiDivisionResults, setLastCSV, formatMultiDivisionCSV } from './render.js?v=3';
import { SCHEDULE_STORAGE_KEY, saveScheduleSnapshot, decodeSchedule } from './scheduleStorage.js';
import { mountEditor } from './scheduleEditor.js';

let session = null;
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
  storageNotice(
    saved
      ? ''
      : 'This schedule is available in this session, but could not be saved for refresh. Download CSV to keep a copy.'
  );
}
function refreshResults() {
  for (const r of session.results)
    r.details = scoreDetails(r.schedule, r.division.numTeams, r.slots);
  setLastCSV(formatMultiDivisionCSV(session.results));
  renderMultiDivisionResults(session.results, session.allSlots);
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
  };
  refreshResults();
  mountEditor(session, (games) => {
    session.results.forEach((r, i) => {
      r.schedule = games
        .filter((g) => g.division === String(i))
        .map(({ id, division, ...g }) => ({ ...g, home: g.home - 1, away: g.away - 1 }));
    });
    refreshResults();
    persist();
  });
  if (save) persist();
  document.dispatchEvent(new Event('scheduler:results-ready'));
}
export function restoreSchedule() {
  try {
    const text = localStorage.getItem(SCHEDULE_STORAGE_KEY);
    if (!text) return;
    const { results, allSlots, baseWeights } = decodeSchedule(text);
    startSchedule(results, allSlots, baseWeights, false);
  } catch {
    clearSchedule();
    storageNotice('The saved schedule could not be restored. Generate a new schedule from Setup.');
  }
}
export function clearSchedule() {
  session = null;
  try {
    localStorage.removeItem(SCHEDULE_STORAGE_KEY);
  } catch {}
  document.getElementById('editSchedule').replaceChildren();
  document.getElementById('editTab').disabled = true;
  storageNotice();
}
