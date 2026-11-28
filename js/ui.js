// @ts-nocheck -- UI event and window-handler migration is pending.
import { restoreSchedule, clearSchedule, startSchedule, getScheduleSnapshot, isScheduleUnsaved } from './scheduleSession.js';
import { SCHEDULE_STORAGE_KEY } from './scheduleStorage.js';
import { STORAGE_KEY, loadState, readSetup, saveState, debouncedSave, cancelSave, flushSave, clearSavedState, isSetupUnsaved } from './state.js';
import { encodeBackup, decodeBackup } from './schedulerBackup.js';
import {
  addDivisionRow, removeDivisionRow, buildPenaltyGrid,
  updateFieldChoices, resetWeights, togglePenalties,
  toggleDivWeights, clearCachedFields, readDivisions
} from './divisions.js?v=5';
import { downloadCSV, showError, clearError } from './render.js?v=4';
import { generate, isGenerating } from './generate.js?v=11';
import { parseTSV } from './parser.js?v=3';
import { parseDate, dateStr, formatTimeDisplay } from './utils.js';

function updateAvailabilityPreview() {
  const preview = document.getElementById('availabilityPreview');
  const text = document.getElementById('tsvInput').value;
  preview.classList.toggle('hidden', !text.trim());
  preview.classList.remove('invalid');
  preview.replaceChildren();
  if (!text.trim()) return;
  try {
    const slots = parseTSV(text);
    if (!slots.length) throw new Error('No available field times found.');
    const lines = text.trim().split('\n').filter(line => line.trim());
    const clean = value => (value || '').trim().replace(/^["']|["']$/g, '');
    const first = lines[1].split('\t');
    const offset = isNaN(parseDate(clean(first[0])).getTime()) && !isNaN(parseDate(clean(first[1])).getTime()) ? 1 : 0;
    const fields = lines[0].split('\t').slice(1 + offset).map(clean);
    const dates = [...new Set(lines.slice(1).map(line => clean(line.split('\t')[offset])).filter(Boolean).map(value => dateStr(parseDate(value))))].sort();
    const title = document.createElement('h4');
    title.className = 'availability-preview-title';
    title.textContent = 'Availability preview';
    const summary = document.createElement('p');
    summary.className = 'availability-summary';
    const years = new Set(dates.map(date => date.slice(0, 4)));
    summary.textContent = `${years.size === 1 ? [...years][0] + ' · ' : ''}${dates.length} ${dates.length === 1 ? 'date' : 'dates'} · ${fields.length} ${fields.length === 1 ? 'field' : 'fields'} · ${slots.length} ${slots.length === 1 ? 'time' : 'times'}`;
    const wrap = document.createElement('div');
    wrap.className = 'availability-table-scroll';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Field availability preview');
    wrap.tabIndex = 0;
    const table = document.createElement('table');
    table.className = 'availability-table';
    const head = table.createTHead().insertRow();
    for (const name of ['Date', ...fields]) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = name;
      head.appendChild(th);
    }
    const byCell = new Map();
    for (const slot of slots) {
      const key = JSON.stringify([slot.date, slot.field]);
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key).push(slot.time);
    }
    const body = table.createTBody();
    for (const date of dates) {
      const row = body.insertRow();
      const dateCell = document.createElement('th');
      dateCell.scope = 'row';
      dateCell.textContent = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(years.size > 1 ? { year: 'numeric' } : {}) });
      if (body.rows.length > 7) row.hidden = true;
      row.appendChild(dateCell);
      for (const field of fields) {
        const cell = row.insertCell();
        const times = byCell.get(JSON.stringify([date, field])) || [];
        if (!times.length) { cell.textContent = '—'; cell.className = 'availability-empty'; }
        for (const time of times) {
          const badge = document.createElement('span');
          badge.className = 'availability-time';
          badge.textContent = formatTimeDisplay(time).replace(/^0/, '');
          cell.appendChild(badge);
        }
      }
    }
    wrap.appendChild(table);
    preview.append(title, summary, wrap);
    if (dates.length > 7) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'availability-show-all';
      toggle.textContent = `Show all ${dates.length} dates`;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        for (const row of [...body.rows].slice(7)) row.hidden = expanded;
        toggle.setAttribute('aria-expanded', String(!expanded));
        toggle.textContent = expanded ? `Show all ${dates.length} dates` : 'Show fewer dates';
      });
      preview.appendChild(toggle);
    }
  } catch (err) {
    preview.classList.add('invalid');
    preview.textContent = `Check your availability: ${err.message}`;
    document.getElementById('availabilitySource').open = true;
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

let previewTimer;
let uploadReader;

function restoreState(state) {
  clearTimeout(previewTimer);
  uploadReader?.abort();
  uploadReader = undefined;
  const tbody = document.querySelector('#divisionTable tbody');
  tbody.replaceChildren();
  document.getElementById('tsvInput').value = state?.tsv ?? '';
  document.getElementById('fileName').textContent = state?.fileName ?? '';
  document.getElementById('tsvFile').value = '';
  clearCachedFields();
  updateFieldChoices();

  for (const input of document.querySelectorAll('#penaltyGrid input')) {
    input.value = state?.weights?.[input.id.slice(2)] ?? input.defaultValue;
  }

  if (!state?.divisions?.length) addDivisionRow();
  for (const div of state?.divisions ?? []) {
    addDivisionRow(div.name, div.numTeams, div.gamesPerTeam, div.leagueSplit, div.excludedDays);
    const weightsRow = tbody.lastElementChild;
    for (const cb of weightsRow.previousElementSibling.querySelectorAll('.div-fields input[type="checkbox"]')) {
      cb.checked = !div.uncheckedFields?.includes(cb.value);
    }
    for (const input of weightsRow.querySelectorAll('[data-weight]')) {
      input.value = div.weightOverrides?.[input.dataset.weight] ?? '';
    }
  }

  updateAvailabilityPreview();
  updateReadiness();
}

function clearInputs() {
  if (!window.confirm('Clear all inputs and results? This cannot be undone.')) return;
  cancelSave();
  restoreState(null);
  clearError();
  clearSavedState();
  clearSchedule();
}

function showBackupStatus(message = '', failed = false) {
  const status = document.getElementById('backupStatus');
  status.textContent = message;
  status.classList.toggle('failed', failed);
}

function exportBackup() {
  try {
    const text = encodeBackup(readSetup(), getScheduleSnapshot());
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'little-league-scheduler.json';
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    showBackupStatus('JSON backup download started.');
  } catch (err) {
    showBackupStatus(`Could not export the backup. ${err.message}`, true);
  }
}

let importingBackup = false;

function updateImportButton() {
  document.getElementById('importBackup').disabled = importingBackup || isGenerating();
}

async function importBackup(event) {
  const input = event.currentTarget;
  const file = input.files[0];
  input.value = '';
  if (!file || importingBackup) return;
  importingBackup = true;
  updateImportButton();
  showBackupStatus();
  try {
    const { setup, schedule } = decodeBackup(await file.text());
    if (isGenerating()) throw new Error('Wait for schedule generation to finish, then try again.');
    if (!window.confirm('Replace the current setup and schedule with this JSON backup?')) return;

    cancelSave();
    restoreState(setup);
    clearError();
    const scheduleSaved = schedule
      ? startSchedule(schedule.results, schedule.allSlots, schedule.baseWeights)
      : clearSchedule();
    const setupSaved = saveState();
    showBackupStatus(setupSaved && scheduleSaved
      ? 'JSON backup imported and saved in this browser.'
      : 'JSON backup imported. Browser storage could not save all imported data.');
  } catch (err) {
    showBackupStatus(`Could not import the backup. ${err.message}`, true);
  } finally {
    importingBackup = false;
    updateImportButton();
  }
}

function warnBeforeLeaving(event) {
  event.preventDefault();
  event.returnValue = true;
}

function updateSaveWarning() {
  const unsaved = isSetupUnsaved() || isScheduleUnsaved();
  document.getElementById('unsavedNotice').hidden = !unsaved;
  if (unsaved) window.addEventListener('beforeunload', warnBeforeLeaving);
  else window.removeEventListener('beforeunload', warnBeforeLeaving);
}

function showView(view) {
  if (view !== 'setup' && document.getElementById(view === 'edit' ? 'editTab' : 'resultsTab').disabled) return;
  for (const [name,id] of [['setup','settingsCard'],['results','results'],['edit','editSchedule']]) {
    document.getElementById(id).classList.toggle('hidden',view!==name);
    const tab=document.getElementById(name==='setup'?'setupTab':name==='results'?'resultsTab':'editTab');
    tab.classList.toggle('active',view===name);
    if(view===name) tab.setAttribute('aria-current','page'); else tab.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadSample() {
  uploadReader?.abort();
  document.getElementById('fileName').textContent = '';
  document.getElementById('tsvFile').value = '';
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

  uploadReader?.abort();

  if (file.name.match(/\.xlsx?$/i)) {
    showError('Excel files are not supported. Copy and paste the spreadsheet cells, or save the sheet as a tab-separated text file and upload it.');
    e.target.value = '';
    return;
  }

  const reader = uploadReader = new FileReader();
  reader.onload = (evt) => {
    uploadReader = undefined;
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('tsvInput').value = evt.target.result;
    document.getElementById('availabilitySource').open = false;
    updateFieldChoices();
    updateAvailabilityPreview();
    updateReadiness();
    debouncedSave();
  };
  reader.readAsText(file);
}

// Expose functions referenced by onclick attributes in HTML
window.generate = generate;
window.addDivisionRow = (...args) => { addDivisionRow(...args); updateReadiness(); debouncedSave(); };
window.clearInputs = clearInputs;
window.resetWeights = resetWeights;
window.togglePenalties = togglePenalties;
window.loadSample = loadSample;
window.removeDivisionRow = (...args) => { removeDivisionRow(...args); updateReadiness(); };
window.toggleDivWeights = toggleDivWeights;
window.downloadCSV = downloadCSV;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('setupTab').addEventListener('click', () => showView('setup'));
  document.getElementById('editTab').addEventListener('click', () => showView('edit'));
  document.getElementById('resultsTab').addEventListener('click', () => showView('results'));
  document.getElementById('exportBackup').addEventListener('click', exportBackup);
  const backupFile = document.getElementById('backupFile');
  document.getElementById('importBackup').addEventListener('click', () => backupFile.click());
  backupFile.addEventListener('change', importBackup);
  document.addEventListener('scheduler:generation-status', updateImportButton);
  document.addEventListener('scheduler:save-status', updateSaveWarning);
  let remoteScheduleUpdate = false;
  document.addEventListener('scheduler:results-ready', () => {
    document.getElementById('resultsTab').disabled = false;
    document.getElementById('editTab').disabled = false;
    if (!remoteScheduleUpdate) showView('results');
  });
  document.addEventListener('scheduler:schedule-cleared', () => {
    if (!document.getElementById('setupTab').classList.contains('active')) showView('setup');
  });
  buildPenaltyGrid();
  restoreState(loadState());
  restoreSchedule();
  updateSaveWarning();

  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage) return;
    if ((event.key === STORAGE_KEY || event.key === null) && !isSetupUnsaved()) {
      // A newer write may have landed while this event was queued.
      if (event.key === null || localStorage.getItem(STORAGE_KEY) === event.newValue) {
        cancelSave();
        restoreState(loadState());
      }
    }
    if ((event.key === SCHEDULE_STORAGE_KEY || event.key === null) && !isScheduleUnsaved()) {
      if (event.key === null || localStorage.getItem(SCHEDULE_STORAGE_KEY) === event.newValue) {
        remoteScheduleUpdate = true;
        try {
          restoreSchedule({ remote: true });
        } finally {
          remoteScheduleUpdate = false;
        }
      }
    }
  });
  window.addEventListener('pagehide', flushSave);

  document.getElementById('tsvInput').addEventListener('input', () => {
    uploadReader?.abort();
    document.getElementById('fileName').textContent = '';
    document.getElementById('tsvFile').value = '';
    clearTimeout(previewTimer);
    updateFieldChoices();
    debouncedSave();
    previewTimer = setTimeout(() => {
      updateAvailabilityPreview();
      updateReadiness();
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
