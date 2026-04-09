import { WEIGHTS } from './constants.js';

const STORAGE_KEY = 'scheduler_state';

// ─── LocalStorage Persistence ───────────────────────────────────────────────

function saveState() {
  const rows = document.querySelectorAll('#divisionTable tbody tr:not(.div-weights-row)');
  const divisions = [];
  for (const tr of rows) {
    const uncheckedFields = [];
    for (const cb of tr.querySelectorAll('.div-fields input[type="checkbox"]')) {
      if (!cb.checked) uncheckedFields.push(cb.value);
    }
    const excludedDays = [];
    for (const cb of tr.querySelectorAll('.div-excluded-days input[type="checkbox"]')) {
      if (cb.checked) excludedDays.push(parseInt(cb.value));
    }
    divisions.push({
      name: tr.querySelector('.div-name').value,
      numTeams: tr.querySelector('.div-teams').value,
      gamesPerTeam: tr.querySelector('.div-games').value,
      leagueSplit: tr.querySelector('.div-league').checked,
      uncheckedFields,
      excludedDays
    });
  }

  const weights = {};
  for (const key in WEIGHTS) {
    const el = document.getElementById('w_' + key);
    if (el) weights[key] = el.value;
  }

  const state = {
    divisions,
    tsv: document.getElementById('tsvInput').value,
    weights
  };

  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* quota exceeded */ }
}

function loadState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  return state;
}

let saveTimer;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 500);
}

export { saveState, loadState, debouncedSave };
