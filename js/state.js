import { WEIGHTS } from './constants.js';

export const STORAGE_KEY = 'scheduler_state';

// ─── LocalStorage Persistence ───────────────────────────────────────────────

function readSetup() {
  const rows = document.querySelectorAll('#divisionTable tbody tr:not(.div-weights-row)');
  const divisions = [];
  for (const tr of rows) {
    const weightOverrides = {};
    for (const input of tr.nextElementSibling.querySelectorAll('[data-weight]')) {
      weightOverrides[input.dataset.weight] = input.value;
    }
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
      excludedDays,
      weightOverrides
    });
  }

  const weights = {};
  for (const key in WEIGHTS) {
    const el = document.getElementById('w_' + key);
    if (el) weights[key] = el.value;
  }

  return {
    divisions,
    tsv: document.getElementById('tsvInput').value,
    weights,
    fileName: document.getElementById('fileName').textContent
  };
}

function loadState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  return state;
}

let saveTimer;
let setupUnsaved = false;

function isSetupUnsaved() {
  return setupUnsaved;
}

function setSaveStatus(unsaved) {
  if (setupUnsaved === unsaved) return;
  setupUnsaved = unsaved;
  document.dispatchEvent(new CustomEvent('scheduler:save-status', {
    detail: { part: 'setup', unsaved },
  }));
}

function saveState() {
  cancelSave();
  let saved = false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readSetup()));
    saved = true;
  } catch {}
  setSaveStatus(!saved);
  return saved;
}

function clearSavedState() {
  cancelSave();
  let cleared = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
    cleared = true;
  } catch {}
  setSaveStatus(!cleared);
  return cleared;
}

function cancelSave() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
}

function flushSave() {
  if (saveTimer === undefined) return;
  return saveState();
}

function debouncedSave() {
  cancelSave();
  saveTimer = setTimeout(flushSave, 500);
  setSaveStatus(true);
}

export {
  readSetup, loadState, saveState, clearSavedState, isSetupUnsaved,
  debouncedSave, cancelSave, flushSave,
};
