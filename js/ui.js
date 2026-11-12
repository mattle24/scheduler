import { loadState, debouncedSave } from './state.js';
import {
  addDivisionRow, removeDivisionRow, buildPenaltyGrid,
  updateFieldChoices, resetWeights, togglePenalties,
  toggleDivWeights, clearCachedFields, readDivisions
} from './divisions.js?v=4';
import { downloadCSV, showError, clearError } from './render.js?v=2';
import { generate } from './generate.js?v=8';
import { parseTSV } from './parser.js?v=3';

function updateAvailabilityPreview() {
  const preview = document.getElementById('availabilityPreview');
  const text = document.getElementById('tsvInput').value;
  preview.classList.toggle('hidden', !text.trim());
  preview.classList.remove('invalid');
  if (!text.trim()) { preview.textContent = ''; return; }
  try {
    const slots = parseTSV(text);
    if (!slots.length) throw new Error('No available field times found.');
    const fields = [...new Set(slots.map(slot => slot.field))];
    const dates = slots.map(slot => slot.date).sort();
    const formatDate = date => new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
    preview.textContent = `Found ${slots.length} available game ${slots.length === 1 ? 'time' : 'times'} from ${formatDate(dates[0])} to ${formatDate(dates[dates.length - 1])}. Fields with availability: ${fields.join(', ')}.`;
  } catch (err) {
    preview.classList.add('invalid');
    preview.textContent = `Check your availability: ${err.message}`;
  }
}

function updateReadiness() {
  const list = document.getElementById('readinessList');
  const items = [];
  let slots;
  try {
    const text = document.getElementById('tsvInput').value;
    if (!text.trim()) throw new Error('Add field availability in step 1.');
    slots = parseTSV(text);
    if (!slots.length) { slots = null; throw new Error('Add at least one available game time in step 1.'); }
    items.push([true, 'Field availability is ready.']);
  } catch (err) {
    items.push([false, `Field availability: ${err.message}`]);
  }
  let divisions;
  try {
    divisions = readDivisions();
    items.push([true, 'Division details and fields are complete.']);
  } catch (err) {
    items.push([false, err.message + (slots ? '' : ' (Fields are available after adding availability.)')]);
  }
  if (slots && divisions) {
    const needed = divisions.reduce((sum, div) => sum + Math.ceil(div.numTeams * div.gamesPerTeam / 2), 0);
    const usable = new Set(slots.filter(slot => divisions.some(div => div.fields.includes(slot.field) && !div.excludedDays.includes(slot.dayOfWeek))).map(slot => slot.sortKey)).size;
    items.push([usable >= needed, usable >= needed
      ? `There are ${usable} available field times for at least ${needed} games. Other scheduling rules still apply.`
      : `More field times are needed: ${usable} available for at least ${needed} games.`]);
  } else {
    items.push([false, 'Add field availability and division details to see if there are enough game times.']);
  }
  const ready = items.every(([complete]) => complete);
  document.getElementById('generateButton').disabled = !ready;
  document.getElementById('readinessSummary').textContent = ready
    ? 'Your setup is ready. Generate a schedule to review the results.'
    : 'Complete the items below to generate your schedule.';
  list.replaceChildren(...items.map(([ready, message]) => {
    const item = document.createElement('li');
    item.textContent = `${ready ? 'Complete' : 'To do'}: ${message}`;
    item.className = ready ? 'ready' : 'not-ready';
    return item;
  }));
}

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
  if (!window.confirm('Clear all inputs and results? This cannot be undone.')) return;
  // Reset divisions to one empty row
  const tbody = document.querySelector('#divisionTable tbody');
  tbody.innerHTML = '';
  clearCachedFields();
  addDivisionRow();

  // Clear TSV
  document.getElementById('tsvInput').value = '';
  document.getElementById('fileName').textContent = '';
  document.getElementById('tsvFile').value = '';
  updateAvailabilityPreview();
  updateReadiness();

  // Reset penalty weights to defaults
  resetWeights();

  // Clear results and errors
  document.getElementById('results').classList.add('hidden');
  document.getElementById('resultsTab').disabled = true;
  showView('setup');
  clearError();

  localStorage.removeItem('scheduler_state');
}

function showView(view) {
  if (view === 'results' && document.getElementById('resultsTab').disabled) return;
  const showingResults = view === 'results';
  document.getElementById('settingsCard').classList.toggle('hidden', showingResults);
  document.getElementById('results').classList.toggle('hidden', !showingResults);
  for (const [tab, active] of [[document.getElementById('setupTab'), !showingResults], [document.getElementById('resultsTab'), showingResults]]) {
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  updateAvailabilityPreview();
  updateReadiness();
  debouncedSave();
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('fileName').textContent = file.name;

  if (file.name.match(/\.xlsx?$/i)) {
    showError('Excel files are not supported. Copy and paste the spreadsheet cells, or save the sheet as a tab-separated text file and upload it.');
    e.target.value = '';
    document.getElementById('fileName').textContent = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (evt) => {
    document.getElementById('tsvInput').value = evt.target.result;
    updateFieldChoices();
    updateAvailabilityPreview();
    updateReadiness();
    debouncedSave();
  };
  reader.readAsText(file);
}

// Expose functions referenced by onclick attributes in HTML
window.generate = generate;
window.addDivisionRow = (...args) => { addDivisionRow(...args); updateReadiness(); };
window.clearInputs = clearInputs;
window.resetWeights = resetWeights;
window.togglePenalties = togglePenalties;
window.loadSample = loadSample;
window.removeDivisionRow = (...args) => { removeDivisionRow(...args); updateReadiness(); };
window.toggleDivWeights = toggleDivWeights;
window.downloadCSV = downloadCSV;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('setupTab').addEventListener('click', () => showView('setup'));
  document.getElementById('resultsTab').addEventListener('click', () => showView('results'));
  document.addEventListener('scheduler:results-ready', () => {
    document.getElementById('resultsTab').disabled = false;
    showView('results');
  });
  buildPenaltyGrid();

  // Restore saved state or start with one empty division row
  const saved = loadState();
  if (saved) {
    restoreState(saved);
  } else {
    addDivisionRow();
  }

  updateAvailabilityPreview();
  updateReadiness();

  // Update field checkboxes when TSV changes
  let debounceTimer;
  document.getElementById('tsvInput').addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updateFieldChoices();
      updateAvailabilityPreview();
      updateReadiness();
      debouncedSave();
    }, 300);
  });

  // Auto-save on division table changes
  const divTable = document.getElementById('divisionTable');
  divTable.addEventListener('input', () => { debouncedSave(); updateReadiness(); });
  divTable.addEventListener('change', () => { debouncedSave(); updateReadiness(); });

  // Auto-save on penalty weight changes
  document.getElementById('penaltyGrid').addEventListener('input', debouncedSave);

  document.getElementById('tsvFile').addEventListener('change', handleFileUpload);
});
