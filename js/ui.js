import { loadState, debouncedSave } from './state.js';
import {
  addDivisionRow, removeDivisionRow, buildPenaltyGrid,
  updateFieldChoices, resetWeights, togglePenalties,
  toggleDivWeights, clearCachedFields
} from './divisions.js';
import { downloadCSV, showError, clearError } from './render.js';
import { generate } from './generate.js';

function restoreState(state) {
  // Restore TSV first so field checkboxes can populate
  if (state.tsv) {
    document.getElementById('tsvInput').value = state.tsv;
    updateFieldChoices();
  }

  // Restore penalty weights
  if (state.weights) {
    for (const key in state.weights) {
      const el = document.getElementById('w_' + key);
      if (el) el.value = state.weights[key];
    }
  }

  // Restore divisions
  if (state.divisions && state.divisions.length > 0) {
    const tbody = document.querySelector('#divisionTable tbody');
    tbody.innerHTML = '';
    for (const div of state.divisions) {
      addDivisionRow(div.name, div.numTeams, div.gamesPerTeam, div.leagueSplit, div.excludedDays || []);
      // Uncheck fields that were unchecked
      const tr = tbody.lastElementChild;
      for (const cb of tr.querySelectorAll('.div-fields input[type="checkbox"]')) {
        if (div.uncheckedFields.includes(cb.value)) cb.checked = false;
      }
    }
  }
}

function clearInputs() {
  // Reset divisions to one empty row
  const tbody = document.querySelector('#divisionTable tbody');
  tbody.innerHTML = '';
  clearCachedFields();
  addDivisionRow();

  // Clear TSV
  document.getElementById('tsvInput').value = '';
  document.getElementById('fileName').textContent = '';

  // Reset penalty weights to defaults
  resetWeights();

  // Clear results and errors
  document.getElementById('results').classList.add('hidden');
  clearError();

  localStorage.removeItem('scheduler_state');
}

function loadSample() {
  // Clear existing division rows and add two sample divisions
  const tbody = document.querySelector('#divisionTable tbody');
  tbody.innerHTML = '';
  addDivisionRow('Majors', 12, 18, false);
  addDivisionRow('Minors', 10, 14, false);

  // 2 fields, 10 weeks starting Saturday April 11, 2026
  const fieldNames = ['Field 1', 'Field 2'];
  const start = new Date(2026, 3, 11);
  const weekdayTimes = '6:00pm';
  const weekendTimes = '9:00am, 11:00am, 1:00pm, 3:00pm';

  const rows = [];
  for (let w = 0; w < 10; w++) {
    const sat = new Date(start);
    sat.setDate(sat.getDate() + w * 7);
    rows.push({ d: new Date(sat), times: weekendTimes });
    const sun = new Date(sat);
    sun.setDate(sun.getDate() + 1);
    rows.push({ d: sun, times: weekendTimes });
    for (let wd = 2; wd <= 6; wd++) {
      const day = new Date(sat);
      day.setDate(day.getDate() + wd);
      rows.push({ d: day, times: weekdayTimes });
    }
  }

  let tsv = 'Date\t' + fieldNames.join('\t') + '\n';
  for (const r of rows) {
    const ds = `${r.d.getMonth() + 1}/${r.d.getDate()}/${r.d.getFullYear()}`;
    tsv += ds + '\t' + fieldNames.map(() => r.times).join('\t') + '\n';
  }

  document.getElementById('tsvInput').value = tsv;
  updateFieldChoices();
  debouncedSave();
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('fileName').textContent = file.name;

  if (file.name.match(/\.xlsx?$/i)) {
    showError('Excel files are not supported. Please export as TSV or CSV first.');
    e.target.value = '';
    document.getElementById('fileName').textContent = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (evt) => {
    document.getElementById('tsvInput').value = evt.target.result;
    updateFieldChoices();
    debouncedSave();
  };
  reader.readAsText(file);
}

// Expose functions referenced by onclick attributes in HTML
window.generate = generate;
window.addDivisionRow = addDivisionRow;
window.clearInputs = clearInputs;
window.resetWeights = resetWeights;
window.togglePenalties = togglePenalties;
window.loadSample = loadSample;
window.removeDivisionRow = removeDivisionRow;
window.toggleDivWeights = toggleDivWeights;
window.downloadCSV = downloadCSV;

document.addEventListener('DOMContentLoaded', () => {
  buildPenaltyGrid();

  // Restore saved state or start with one empty division row
  const saved = loadState();
  if (saved) {
    restoreState(saved);
  } else {
    addDivisionRow();
  }

  // Update field checkboxes when TSV changes
  let debounceTimer;
  document.getElementById('tsvInput').addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updateFieldChoices();
      debouncedSave();
    }, 300);
  });

  // Auto-save on division table changes
  const divTable = document.getElementById('divisionTable');
  divTable.addEventListener('input', debouncedSave);
  divTable.addEventListener('change', debouncedSave);

  // Auto-save on penalty weight changes
  document.getElementById('penaltyGrid').addEventListener('input', debouncedSave);

  document.getElementById('tsvFile').addEventListener('change', handleFileUpload);
});
