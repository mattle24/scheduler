import { WEIGHTS, WEIGHT_LABELS, WEIGHT_DESCRIPTIONS } from './constants.js';
import { debouncedSave } from './state.js';

let cachedFieldNames = [];
function clearCachedFields() { cachedFieldNames = []; }

function togglePenalties() {
  const body = document.getElementById('penaltyWeights');
  const header = document.querySelector('.penalty-header');
  body.classList.toggle('hidden');
  header.classList.toggle('open');
}

function syncWeights() {
  for (const key in WEIGHTS) {
    const el = document.getElementById('w_' + key);
    if (el) WEIGHTS[key] = parseInt(el.value) || 0;
  }
}


function resetWeights() {
  for (const key in WEIGHTS) {
    const el = document.getElementById('w_' + key);
    if (el) el.value = WEIGHTS[key];
  }
  debouncedSave();
}

function buildPenaltyGrid() {
  const grid = document.getElementById('penaltyGrid');
  for (const key in WEIGHTS) {
    const wrapper = document.createElement('div');
    wrapper.className = 'penalty-item';
    const label = document.createElement('label');
    label.textContent = WEIGHT_LABELS[key] || key;
    wrapper.append(label);
    if (WEIGHT_DESCRIPTIONS[key]) {
      const desc = document.createElement('small');
      desc.className = 'penalty-desc';
      desc.textContent = WEIGHT_DESCRIPTIONS[key];
      wrapper.append(desc);
    }
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', id: 'w_' + key, min: '0', max: '50', value: String(WEIGHTS[key]), step: '1' });
    grid.append(wrapper, input);
  }
}

// ─── Division Management ─────────────────────────────────────────────────────

// Keys and labels for per-division weight overrides
const DIV_WEIGHT_KEYS = [
  { key: 'weekendDoubleHeaders', label: 'Weekend Back-to-Back' },
  { key: 'weekendSitouts',       label: 'Weekend Sit-outs' },
  { key: 'btbBalance',           label: 'Back-to-Back Balance' },
  { key: 'satSunBalance',        label: 'Sat/Sun Balance' },
  { key: 'gapVariance',          label: 'Gap Variance' },
  { key: 'shortGapPenalty',      label: 'Short Gap Penalty' },
];

function toggleDivWeights(btn) {
  const tr = btn.closest('tr');
  const weightsTr = tr.nextElementSibling;
  if (weightsTr && weightsTr.classList.contains('div-weights-row')) {
    weightsTr.classList.toggle('hidden');
    btn.classList.toggle('active');
  }
}

function addDivisionRow(name, numTeams, gamesPerTeam, leagueSplit, excludedDays) {
  excludedDays = excludedDays || [];
  const tbody = document.querySelector('#divisionTable tbody');
  const tr = document.createElement('tr');

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayCheckboxes = dayNames.map((d, i) =>
    `<label><input type="checkbox" value="${i}" ${excludedDays.includes(i) ? 'checked' : ''}> ${d}</label>`
  ).join('');

  tr.innerHTML = `
    <td><input type="text" class="div-name" placeholder="e.g. Majors" value="${name || ''}"></td>
    <td><input type="number" class="div-teams" min="2" max="30" value="${numTeams || ''}"></td>
    <td><input type="number" class="div-games" min="1" max="100" value="${gamesPerTeam || ''}"></td>
    <td style="text-align:center;"><input type="checkbox" class="div-league" ${leagueSplit ? 'checked' : ''}></td>
    <td><div class="div-excluded-days">${dayCheckboxes}</div></td>
    <td><div class="div-fields"></div></td>
    <td style="white-space:nowrap;">
      <button class="btn-secondary btn-sm btn-div-weights" onclick="toggleDivWeights(this)" title="Per-division weight overrides">Weights</button>
      <button class="btn-remove" onclick="removeDivisionRow(this)" title="Remove division">&times;</button>
    </td>
  `;

  // Build the weights override row (hidden by default)
  const weightsTr = document.createElement('tr');
  weightsTr.className = 'div-weights-row hidden';
  const weightsTd = document.createElement('td');
  weightsTd.colSpan = 7;

  const panel = document.createElement('div');
  panel.className = 'div-weights-panel';
  const hint = document.createElement('p');
  hint.className = 'penalty-hint';
  hint.textContent = 'Override penalty weights for this division only. Leave blank to use the global value.';
  panel.appendChild(hint);
  const grid = document.createElement('div');
  grid.className = 'div-weights-grid';
  for (const { key, label } of DIV_WEIGHT_KEYS) {
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.placeholder = String(WEIGHTS[key]);
    input.setAttribute('data-weight', key);
    grid.appendChild(lbl);
    grid.appendChild(input);
  }
  panel.appendChild(grid);
  weightsTd.appendChild(panel);
  weightsTr.appendChild(weightsTd);

  tbody.appendChild(tr);
  tbody.appendChild(weightsTr);
  populateFieldCheckboxes(tr);
  debouncedSave();
}

function removeDivisionRow(btn) {
  const tbody = document.querySelector('#divisionTable tbody');
  // Count only main rows (not weights rows) to prevent removing last division
  const mainRows = tbody.querySelectorAll('tr:not(.div-weights-row)');
  if (mainRows.length <= 1) return;
  const tr = btn.closest('tr');
  const weightsTr = tr.nextElementSibling;
  if (weightsTr && weightsTr.classList.contains('div-weights-row')) weightsTr.remove();
  tr.remove();
  debouncedSave();
}

function populateFieldCheckboxes(tr) {
  const container = tr.querySelector('.div-fields');
  if (cachedFieldNames.length === 0) {
    container.innerHTML = '<span class="field-hint">Paste TSV first</span>';
    return;
  }
  container.innerHTML = '';
  for (const field of cachedFieldNames) {
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.value = field;
    lbl.append(cb, ' ' + field);
    container.appendChild(lbl);
  }
}

function updateFieldChoices() {
  const tsvText = document.getElementById('tsvInput').value;
  const firstLine = tsvText.split(/\r?\n/)[0] || '';
  const cols = firstLine.split('\t');
  const fields = cols.slice(1).map(s => s.trim()).filter(Boolean);

  // Only update if field names actually changed
  if (JSON.stringify(fields) === JSON.stringify(cachedFieldNames)) return;
  cachedFieldNames = fields;

  const rows = document.querySelectorAll('#divisionTable tbody tr:not(.div-weights-row)');
  for (const tr of rows) {
    // Preserve checked state for fields that still exist
    const prev = new Map();
    for (const cb of tr.querySelectorAll('.div-fields input[type="checkbox"]')) {
      prev.set(cb.value, cb.checked);
    }
    const container = tr.querySelector('.div-fields');
    if (fields.length === 0) {
      container.innerHTML = '<span class="field-hint">Paste TSV first</span>';
      continue;
    }
    container.innerHTML = '';
    for (const field of fields) {
      const lbl = document.createElement('label');
      lbl.classList.add('field-cb');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = prev.has(field) ? prev.get(field) : true;
      cb.value = field;
      lbl.append(cb, ' ' + field);
      container.appendChild(lbl);
    }
  }
}

function readDivWeightOverrides(tr) {
  const overrides = {};
  const weightsTr = tr && tr.nextElementSibling;
  if (!weightsTr || !weightsTr.classList.contains('div-weights-row')) return overrides;
  for (const { key } of DIV_WEIGHT_KEYS) {
    const input = weightsTr.querySelector(`[data-weight="${key}"]`);
    if (input && input.value !== '') {
      const v = parseFloat(input.value);
      if (!isNaN(v)) overrides[key] = v;
    }
  }
  return overrides;
}

function readDivisions() {
  const rows = document.querySelectorAll('#divisionTable tbody tr:not(.div-weights-row)');
  if (rows.length === 0) throw new Error('Add at least one division');
  const divs = [];
  for (let i = 0; i < rows.length; i++) {
    const tr = rows[i];
    const name = tr.querySelector('.div-name').value.trim();
    const numTeams = parseInt(tr.querySelector('.div-teams').value);
    const gamesPerTeam = parseInt(tr.querySelector('.div-games').value);
    const leagueSplit = tr.querySelector('.div-league').checked;
    const fields = [];
    for (const cb of tr.querySelectorAll('.div-fields input[type="checkbox"]')) {
      if (cb.checked) fields.push(cb.value);
    }
    const excludedDays = [];
    for (const cb of tr.querySelectorAll('.div-excluded-days input[type="checkbox"]')) {
      if (cb.checked) excludedDays.push(parseInt(cb.value));
    }

    if (!name) throw new Error(`Division ${i + 1}: please enter a name`);
    if (!numTeams || numTeams < 2) throw new Error(`Division "${name}": need at least 2 teams`);
    if (!gamesPerTeam || gamesPerTeam < 1) throw new Error(`Division "${name}": need at least 1 game per team`);
    if (fields.length === 0) throw new Error(`Division "${name}": select at least one field`);

    divs.push({ name, numTeams, gamesPerTeam, leagueSplit, fields, excludedDays });
  }
  return divs;
}

export {
  togglePenalties, syncWeights, resetWeights, buildPenaltyGrid,
  DIV_WEIGHT_KEYS, toggleDivWeights, addDivisionRow, removeDivisionRow,
  populateFieldCheckboxes, updateFieldChoices, readDivWeightOverrides,
  readDivisions, clearCachedFields
};
