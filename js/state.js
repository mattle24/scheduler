// @ts-check
/** @typedef {import('./types.js').Setup} Setup */
/** @typedef {import('./types.js').WeightKey} WeightKey */
import { WEIGHTS } from './constants.js';

export const STORAGE_KEY = 'scheduler_state';

// ─── LocalStorage Persistence ───────────────────────────────────────────────

/** @returns {Setup} */
function readSetup() {
  const rows = document.querySelectorAll('#divisionTable tbody tr:not(.div-weights-row)');
  const divisions = [];
  for (const tr of rows) {
    /** @type {Partial<Record<WeightKey, string>>} */
    const weightOverrides = {};
    for (const input of (/** @type {Element} */ (tr.nextElementSibling)).querySelectorAll(/** @type {'input'} */ (/** @type {unknown} */ ('[data-weight]')))) {
      weightOverrides[/** @type {WeightKey} */ (input.dataset.weight)] = input.value;
    }
    const uncheckedFields = [];
    for (const cb of tr.querySelectorAll(/** @type {'input'} */ (/** @type {unknown} */ ('.div-fields input[type="checkbox"]')))) {
      if (!cb.checked) uncheckedFields.push(cb.value);
    }
    const excludedDays = [];
    for (const cb of tr.querySelectorAll(/** @type {'input'} */ (/** @type {unknown} */ ('.div-excluded-days input[type="checkbox"]')))) {
      if (cb.checked) excludedDays.push(parseInt(cb.value));
    }
    divisions.push({
      name: (/** @type {HTMLInputElement} */ (tr.querySelector('.div-name'))).value,
      numTeams: (/** @type {HTMLInputElement} */ (tr.querySelector('.div-teams'))).value,
      gamesPerTeam: (/** @type {HTMLInputElement} */ (tr.querySelector('.div-games'))).value,
      leagueSplit: (/** @type {HTMLInputElement} */ (tr.querySelector('.div-league'))).checked,
      uncheckedFields,
      excludedDays,
      weightOverrides
    });
  }

  /** @type {Partial<Record<WeightKey, string>>} */
  const weights = {};
  for (const key of /** @type {WeightKey[]} */ (Object.keys(WEIGHTS))) {
    const el = document.getElementById('w_' + key);
    if (el) weights[key] = /** @type {HTMLInputElement} */ (el).value;
  }

  return {
    divisions,
    tsv: (/** @type {HTMLTextAreaElement} */ (document.getElementById('tsvInput'))).value,
    weights,
    fileName: (/** @type {string} */ ((/** @type {HTMLElement} */ (document.getElementById('fileName'))).textContent))
  };
}

function loadState() {
  let state;
  try { state = JSON.parse(/** @type {string} */ (localStorage.getItem(STORAGE_KEY))); } catch (e) { return null; }
  return state;
}

/** @type {ReturnType<typeof setTimeout>|undefined} */
let saveTimer;
let setupUnsaved = false;

function isSetupUnsaved() {
  return setupUnsaved;
}

/** @param {boolean} unsaved */
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
