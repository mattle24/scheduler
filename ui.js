// ─── UI Controller ───────────────────────────────────────────────────────────
let lastCSV = '';
let cachedFieldNames = []; // field names parsed from TSV header
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
  cachedFieldNames = [];
  addDivisionRow();

  // Clear TSV
  document.getElementById('tsvInput').value = '';
  document.getElementById('fileName').textContent = '';

  // Reset penalty weights to defaults
  resetWeights();

  // Clear results and errors
  document.getElementById('results').classList.add('hidden');
  clearError();

  localStorage.removeItem(STORAGE_KEY);
}

let saveTimer;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 500);
}

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

// ─── Schedule Generation ─────────────────────────────────────────────────────

function generate() {
  clearError();
  document.getElementById('results').classList.add('hidden');
  const statusBox = document.getElementById('statusBox');
  statusBox.classList.remove('hidden');
  statusBox.innerHTML = 'Preparing...';

  setTimeout(async () => {
    try {
      const divs = readDivisions();
      const tsvText = document.getElementById('tsvInput').value;
      if (!tsvText.trim()) throw new Error('Please enter field availability data');

      syncWeights();
      const allSlots = parseTSV(tsvText);
      const claimedKeys = new Set();
      const divisionResults = [];

      // Strategy 2: Compute slot scarcity — how many divisions can use each slot
      // Higher scarcity = more divisions competing for this slot, so current division
      // should prefer alternatives when available
      const slotScarcity = new Map();
      if (divs.length > 1) {
        for (const s of allSlots) {
          let divCount = 0;
          for (const d of divs) {
            if (d.fields.includes(s.field) && !d.excludedDays.includes(s.dayOfWeek)) divCount++;
          }
          // Only record scarcity for shared slots (2+ divisions)
          if (divCount > 1) slotScarcity.set(s.sortKey, divCount - 1);
        }
      }

      const mainRows = document.querySelectorAll('#divisionTable tbody tr:not(.div-weights-row)');

      for (let i = 0; i < divs.length; i++) {
        const div = divs[i];
        const divLabel = `Division "${div.name}" (${i + 1}/${divs.length})`;

        // Filter slots to this division's valid fields minus already-claimed slots and excluded days
        const divSlots = allSlots.filter(s =>
          div.fields.includes(s.field) && !claimedKeys.has(s.sortKey) && !div.excludedDays.includes(s.dayOfWeek)
        );

        // Read per-division weight overrides from the weights panel for this row
        const divWeightOverrides = readDivWeightOverrides(mainRows[i]);

        // Phase 1: Build
        statusBox.innerHTML = `
          <div>${divLabel}: Building schedule...</div>
          <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
          <div class="progress-label" id="progressLabel">0%</div>`;

        const result = await buildSchedule(div.numTeams, div.gamesPerTeam, divSlots, (pct, score) => {
          const percent = Math.round(pct * 100);
          document.getElementById('progressFill').style.width = percent + '%';
          const label = score === Infinity ? percent + '%' : percent + '% — score: ' + score.toFixed(1);
          document.getElementById('progressLabel').textContent = label;
        }, { leagueSplit: div.leagueSplit, slotScarcity, weights: divWeightOverrides });

        const finalSchedule = result.schedule;
        const finalDetails = scoreDetails(finalSchedule, div.numTeams, divSlots);

        // Claim the slots used by this division
        for (const g of finalSchedule) claimedKeys.add(g.sortKey);

        divisionResults.push({
          division: div,
          schedule: finalSchedule,
          details: finalDetails,
          greedyDetails: result.details,
          slots: divSlots
        });
      }

      // Strategy 1: Iterative re-scheduling — release each division's slots and
      // re-schedule it with knowledge of what other divisions actually claimed.
      // Accept the new schedule only if the global score improves.
      if (divs.length > 1) {
        const MAX_ROUNDS = 3;
        for (let round = 0; round < MAX_ROUNDS; round++) {
          let improved = false;

          let currentGlobalScore = globalScore(divisionResults);

          for (let i = 0; i < divisionResults.length; i++) {
            const dr = divisionResults[i];
            const div = dr.division;
            const divLabel = `Re-optimizing "${div.name}" (round ${round + 1}/${MAX_ROUNDS})`;

            // Release this division's slots
            const releasedKeys = new Set();
            for (const g of dr.schedule) {
              claimedKeys.delete(g.sortKey);
              releasedKeys.add(g.sortKey);
            }

            // Re-filter slots for this division (its fields, minus other divisions' claims and excluded days)
            const divSlots = allSlots.filter(s =>
              div.fields.includes(s.field) && !claimedKeys.has(s.sortKey) && !div.excludedDays.includes(s.dayOfWeek)
            );

            statusBox.innerHTML = `
              <div>${divLabel}</div>
              <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
              <div class="progress-label" id="progressLabel">0%</div>`;

            // Collect other divisions' games so the greedy builder can cluster
            const otherDivisionGames = divisionResults
              .filter((_, j) => j !== i)
              .flatMap(r => r.schedule);

            const divWeightOverrides = readDivWeightOverrides(mainRows[i]);
            const result = await buildSchedule(div.numTeams, div.gamesPerTeam, divSlots, (pct, score) => {
              const percent = Math.round(pct * 100);
              document.getElementById('progressFill').style.width = percent + '%';
              const label = score === Infinity ? percent + '%' : percent + '% — score: ' + score.toFixed(1);
              document.getElementById('progressLabel').textContent = label;
            }, { leagueSplit: div.leagueSplit, slotScarcity, otherDivisionGames, weights: divWeightOverrides });

            const newSchedule = result.schedule;
            const newDetails = scoreDetails(newSchedule, div.numTeams, divSlots);

            // Compare: does replacing this division improve the global score (including cross-division clustering)?
            // Temporarily swap in the new schedule to compute global scores
            const oldDetails = dr.details;
            const oldSchedule = dr.schedule;
            divisionResults[i] = { ...dr, schedule: newSchedule, details: newDetails, slots: divSlots };
            const newGlobalScore = globalScore(divisionResults);
            divisionResults[i] = { ...dr, schedule: oldSchedule, details: oldDetails };

            if (newGlobalScore < currentGlobalScore) {
              // Accept: update division result and claim new slots
              divisionResults[i] = {
                division: div,
                schedule: newSchedule,
                details: newDetails,
                greedyDetails: result.details,
                slots: divSlots
              };
              for (const g of newSchedule) claimedKeys.add(g.sortKey);
              currentGlobalScore = newGlobalScore;
              improved = true;
            } else {
              // Reject: re-claim original slots
              for (const key of releasedKeys) claimedKeys.add(key);
            }
          }

          if (!improved) break; // No division improved — converged
        }
      }

      lastCSV = formatMultiDivisionCSV(divisionResults);
      renderMultiDivisionResults(divisionResults, allSlots);
      statusBox.classList.add('hidden');
      document.getElementById('results').classList.remove('hidden');
    } catch (e) {
      statusBox.classList.add('hidden');
      showError(e.message);
    }
  }, 50);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function globalScore(divisionResults) {
  return divisionResults.reduce((sum, r) => sum + weightedScore(r.details), 0)
    + scoreCrossfieldDivisionClustering(divisionResults) * (WEIGHTS.fieldDivisionClustering || 0)
    + scoreWeekendOtherDivField(divisionResults) * (WEIGHTS.weekendOtherDivField || 0);
}

function weightedScore(d) {
  let score = 0;
  for (const key in WEIGHTS) {
    if (d[key] != null) score += d[key] * WEIGHTS[key];
  }
  return score;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderMultiDivisionResults(divisionResults, allSlots) {
  const container = document.getElementById('results');
  container.innerHTML = '';

  // Floating TOC — fields + divisions
  const fieldNames = [...new Set((allSlots || []).map(s => s.field))].sort();
  {
    const toc = document.createElement('nav');
    toc.className = 'results-toc';
    const links = [];
    if (fieldNames.length > 0) {
      for (const f of fieldNames) links.push(`<a href="#field-${f.replace(/\s+/g, '-')}">${f}</a>`);
    }
    for (let i = 0; i < divisionResults.length; i++) {
      links.push(`<a href="#division-${i}">${divisionResults[i].division.name}</a>`);
    }
    toc.innerHTML = '<span class="toc-label">Jump to:</span>' + links.join('');
    container.appendChild(toc);
  }

  // Per-field sections with heatmaps
  if (allSlots && allSlots.length > 0) {
    renderFieldSections(container, divisionResults, allSlots, fieldNames);
  }

  for (let i = 0; i < divisionResults.length; i++) {
    const dr = divisionResults[i];
    const section = document.createElement('div');
    section.className = 'division-section';
    section.id = `division-${i}`;
    const heading = document.createElement('h2');
    heading.textContent = dr.division.name;
    section.appendChild(heading);

    renderDivisionBlock(section, dr.schedule, dr.details, dr.division.numTeams, dr.division.leagueSplit);
    container.appendChild(section);
  }

  // Download button at the bottom
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = '<button class="btn-secondary btn-sm" onclick="downloadCSV()">Download CSV</button>';
  container.appendChild(actions);
}

function renderFieldSections(container, divisionResults, allSlots, fieldNames) {
  // Build the set of all (date, time) columns across all fields, sorted chronologically
  // and a lookup: field -> Set of "date|time" keys that are available
  const fieldSlotKeys = new Map(); // field -> Set of "date|time"
  for (const s of allSlots) {
    if (!fieldSlotKeys.has(s.field)) fieldSlotKeys.set(s.field, new Set());
    fieldSlotKeys.get(s.field).add(s.date + '|' + s.time);
  }

  // Build game lookup: field -> "date|time" -> division name
  const fieldGameDiv = new Map(); // field -> Map("date|time" -> divisionName)
  for (const dr of divisionResults) {
    for (const g of dr.schedule) {
      if (!fieldGameDiv.has(g.field)) fieldGameDiv.set(g.field, new Map());
      fieldGameDiv.get(g.field).set(g.date + '|' + g.time, dr.division.name);
    }
  }

  // Division names + colors
  const divNames = divisionResults.map(dr => dr.division.name);
  const divColors = ['#2d5a27', '#2563eb', '#9333ea', '#dc2626', '#ea580c', '#0891b2', '#4f46e5', '#be185d'];

  // Precompute columns (date+time pairs that exist on any field) — shared across all field sections
  const allDates = [...new Set(allSlots.map(s => s.date))].sort();
  const allTimes = [...new Set(allSlots.map(s => s.time))].sort((a, b) => timeSortKey(a) - timeSortKey(b));
  const existingDateTimes = new Set(allSlots.map(s => s.date + '|' + s.time));
  const columns = [];
  for (const date of allDates) {
    for (const time of allTimes) {
      if (existingDateTimes.has(date + '|' + time)) columns.push({ date, time, dateTime: date + '|' + time });
    }
  }
  const colSpanByDate = new Map();
  for (const col of columns) colSpanByDate.set(col.date, (colSpanByDate.get(col.date) || 0) + 1);

  for (const field of fieldNames) {
    const section = document.createElement('div');
    section.className = 'division-section';
    section.id = `field-${field.replace(/\s+/g, '-')}`;
    const heading = document.createElement('h2');
    heading.textContent = field;
    section.appendChild(heading);

    const available = fieldSlotKeys.get(field) || new Set();
    const gameMap = fieldGameDiv.get(field) || new Map();

    // Utilization stats
    const totalSlots = available.size;
    const usedSlots = [...available].filter(k => gameMap.has(k)).length;

    const card = document.createElement('div');
    card.className = 'card';

    let html = `<div class="field-stats">${usedSlots} / ${totalSlots} slots used</div>`;
    html += '<div style="overflow-x:auto;">';
    html += '<table class="heatmap-table field-heatmap"><thead>';

    // Date header row
    html += '<tr><th></th>';
    let prevDate = '';
    for (const col of columns) {
      if (col.date !== prevDate) {
        const span = colSpanByDate.get(col.date);
        const d = new Date(col.date + 'T00:00:00');
        const dow = d.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const label = `${d.getMonth() + 1}/${d.getDate()}`;
        html += `<th colspan="${span}" class="date-header field-date-header${isWeekend ? ' weekend' : ''}">${label}</th>`;
        prevDate = col.date;
      }
    }
    html += '</tr>';

    // Time header row
    html += '<tr><th></th>';
    for (const col of columns) {
      html += `<th class="time-header">${formatTimeDisplay(col.time)}</th>`;
    }
    html += '</tr></thead><tbody>';

    // One row per division
    for (let di = 0; di < divNames.length; di++) {
      const divName = divNames[di];
      const color = divColors[di % divColors.length];
      html += `<tr><td class="team-name">${divName}</td>`;
      for (const col of columns) {
        const key = col.dateTime;
        const isAvailable = available.has(key);
        const gameDiv = gameMap.get(key);
        let cls, style;
        if (!isAvailable) {
          cls = 'field-unavail';
          style = '';
        } else if (gameDiv === divName) {
          cls = 'field-used';
          style = ` style="background:${color}"`;
        } else {
          cls = 'field-free';
          style = '';
        }
        html += `<td class="heatmap-cell ${cls}"${style}></td>`;
      }
      html += '</tr>';
    }

    html += '</tbody></table></div>';
    card.innerHTML = `<h3>Field Heatmap</h3>` + html;
    section.appendChild(card);
    container.appendChild(section);
  }
}

function renderDivisionBlock(container, schedule, details, numTeams, leagueSplit) {
  // Score cards
  const cards = [
    { label: 'Weekend Sit-outs', value: details.weekendSitouts, min: 0,
      tip: 'Number of times a team has zero games on a weekend that has available slots. Lower is better.' },
    { label: 'Weekend Back-to-Back', value: details.weekendDoubleHeaders, min: details.minWeekendDH,
      tip: 'Number of times a team plays 2+ games in the same Sat-Sun weekend. Each extra game beyond 1 counts as 1.' },
    { label: 'Early Season Density', value: details.earlySeasonDensity, min: 0,
      tip: 'Pairs of games within 2 days of each other in the first 7 days of the season.' },
    { label: 'Weekend B2B Timeslot', value: details.weekendBTBTimePenalty, min: 0,
      tip: 'Cases where 2nd day of a Fri/Sat or Sat/Sun back-to-back has an earlier timeslot than the 1st day.' },
    { label: 'Sat/Sun Balance', value: details.satSunBalance, min: 0,
      tip: 'How uneven Saturday vs Sunday game counts are per team. 0 = perfectly balanced.' },
    { label: 'Back-to-Back Balance', value: details.btbBalance, min: 0,
      tip: 'Variance of back-to-back (consecutive day) game counts across teams. 0 = all teams have equal back-to-backs.' },
    { label: 'Short Gap Balance', value: details.shortGapBalance, min: 0,
      tip: 'Variance of short-rest game counts across teams (< 3 days rest). 0 = all teams have equal numbers of short-rest games.' },
  ];

  const scoreCard = document.createElement('div');
  scoreCard.className = 'card';
  scoreCard.innerHTML = '<h2>Constraint Scores</h2><div class="score-grid">' + cards.map(c => {
    let cls;
    if (c.rawClass) {
      cls = c.rawClass;
    } else {
      const excess = c.min != null ? c.value - c.min : c.value;
      cls = excess === 0 ? 'good' : excess <= 3 ? 'ok' : 'bad';
    }
    const minNote = c.min != null && c.min > 0 ? `<div class="min-note">best possible: ${c.min}</div>` : '';
    const tipAttr = c.tip ? ` data-tip="${c.tip}"` : '';
    return `<div class="score-card"${tipAttr}><div class="label">${c.label}</div><div class="value ${cls}">${c.value}</div>${minNote}</div>`;
  }).join('') + '</div>';
  container.appendChild(scoreCard);

  // Per-team summary
  // Odd display numbers (1B,3B,5B…) → AL, even (2B,4B,6B…) → NL
  const isAL = t => (t + 1) % 2 === 1;
  const teamData = [];
  for (let t = 0; t < numTeams; t++) {
    const games = schedule.filter(g => g.home === t || g.away === t);
    const homeGames = schedule.filter(g => g.home === t).length;
    const awayGames = schedule.filter(g => g.away === t).length;
    const dates = games.map(g => g.date).sort();
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
    const avgGap = gaps.length ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1) : '-';

    let btb = 0;
    for (const gap of gaps) {
      if (gap === 1) btb++;
    }

    let intraLeague = 0, interLeague = 0;
    if (leagueSplit) {
      for (const g of games) {
        const opponent = g.home === t ? g.away : g.home;
        const sameLeague = isAL(t) === isAL(opponent);
        if (sameLeague) intraLeague++;
        else interLeague++;
      }
    }

    const fieldCounts = new Map();
    for (const g of games) {
      fieldCounts.set(g.field, (fieldCounts.get(g.field) || 0) + 1);
    }

    teamData.push({
      team: `${t + 1}B`,
      league: leagueSplit ? (isAL(t) ? 'AL' : 'NL') : null,
      games: games.length,
      home: homeGames,
      away: awayGames,
      haDiff: homeGames - awayGames,
      avgGap,
      btb,
      intraLeague,
      interLeague,
      fieldCounts
    });
  }

  // Sort by league (AL first) then team number
  if (leagueSplit) {
    teamData.sort((a, b) => {
      if (a.league !== b.league) return a.league === 'AL' ? -1 : 1;
      return parseInt(a.team) - parseInt(b.team);
    });
  }

  const allFields = [...new Set(schedule.map(g => g.field))].sort();

  let html = '<table><thead><tr>';
  if (leagueSplit) html += '<th>League</th>';
  html += '<th>Team</th><th>Games</th><th>Home</th><th>Away</th><th>H/A Diff</th><th>Avg Gap</th><th>Back-to-Back</th>';
  if (leagueSplit) html += '<th>Intra</th><th>Inter</th>';
  for (const f of allFields) html += `<th>${f}</th>`;
  html += '</tr></thead><tbody>';
  for (const r of teamData) {
    html += '<tr>';
    if (leagueSplit) html += `<td>${r.league}</td>`;
    html += `<td>${r.team}</td><td>${r.games}</td><td>${r.home}</td><td>${r.away}</td><td>${r.haDiff >= 0 ? '+' : ''}${r.haDiff}</td><td>${r.avgGap}</td><td>${r.btb}</td>`;
    if (leagueSplit) html += `<td>${r.intraLeague}</td><td>${r.interLeague}</td>`;
    for (const f of allFields) html += `<td>${r.fieldCounts.get(f) || 0}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';

  const summaryCard = document.createElement('div');
  summaryCard.className = 'card';
  summaryCard.innerHTML = '<h2>Per-Team Summary</h2>' + html;
  container.appendChild(summaryCard);

  // Time Slot Distribution table
  {
    const bucketNames = ['WKND_EARLY', 'WKND_MID', 'WKND_LATE'];
    const bucketLabels = { WKND_EARLY: 'Early (<10:30a)', WKND_MID: 'Mid (10:30a–3p)', WKND_LATE: 'Late (≥3p)' };

    // Compute per-team bucket counts (reuse teamData ordering from above)
    const teamBuckets = [];
    for (const r of teamData) {
      const t = parseInt(r.team) - 1;
      const counts = new Map();
      for (const b of bucketNames) counts.set(b, 0);
      for (const g of schedule.filter(g => g.home === t || g.away === t)) {
        if (g.dayOfWeek !== 0 && g.dayOfWeek !== 6) continue;
        const b = slotBucket(g.dayOfWeek, g.time);
        if (counts.has(b)) counts.set(b, counts.get(b) + 1);
      }
      teamBuckets.push({ team: r.team, league: r.league, counts });
    }

    const hasWeekendGames = teamBuckets.some(tb => [...tb.counts.values()].some(v => v > 0));
    if (hasWeekendGames) {
      const activeBuckets = bucketNames.filter(b => teamBuckets.some(tb => tb.counts.get(b) > 0));
      const stats = new Map();
      for (const b of activeBuckets) {
        const vals = teamBuckets.map(tb => tb.counts.get(b));
        const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
        const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
        stats.set(b, { mean, stdDev: Math.sqrt(variance) });
      }

      let thtml = '<table><thead><tr>';
      if (leagueSplit) thtml += '<th>League</th>';
      thtml += '<th>Team</th>';
      for (const b of activeBuckets) thtml += `<th>${bucketLabels[b] || b}</th>`;
      thtml += '</tr></thead><tbody>';

      for (const tb of teamBuckets) {
        thtml += '<tr>';
        if (leagueSplit) thtml += `<td>${tb.league}</td>`;
        thtml += `<td>${tb.team}</td>`;
        for (const b of activeBuckets) {
          const val = tb.counts.get(b);
          const s = stats.get(b);
          let cls = '';
          if (s && s.stdDev > 0) {
            const zscore = Math.abs(val - s.mean) / s.stdDev;
            if (zscore > 1.5) cls = ' class="bad"';
            else if (zscore > 0.8) cls = ' class="ok"';
            else cls = ' class="good"';
          }
          thtml += `<td${cls}>${val}</td>`;
        }
        thtml += '</tr>';
      }
      thtml += '</tbody></table>';

      const timeCard = document.createElement('div');
      timeCard.className = 'card';
      timeCard.innerHTML = '<h2>Weekend Time Slot Distribution</h2>' + thtml;
      container.appendChild(timeCard);
    }
  }

  // Schedule table
  const sorted = [...schedule].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ta = timeSortKey(a.time), tb = timeSortKey(b.time);
    if (ta !== tb) return ta - tb;
    return a.field < b.field ? -1 : 1;
  });

  let shtml = '<table class="schedule-table"><thead><tr><th>Day</th><th>Date</th><th>Time</th><th>Field</th><th>Away</th><th>Home</th></tr></thead><tbody>';
  for (const g of sorted) {
    const d = new Date(g.date + 'T00:00:00');
    const day = DAYS[d.getDay()].slice(0, 3);
    const dateDisplay = `${d.getMonth() + 1}/${d.getDate()}`;
    shtml += `<tr><td>${day}</td><td>${dateDisplay}</td><td>${formatTimeDisplay(g.time)}</td><td>${g.field}</td><td>${g.away + 1}B</td><td>${g.home + 1}B</td></tr>`;
  }
  shtml += '</tbody></table>';

  const schedCard = document.createElement('div');
  schedCard.className = 'card';
  schedCard.innerHTML = '<h2>Schedule</h2>' + shtml;
  container.appendChild(schedCard);

  // Heatmap
  const heatmapCard = document.createElement('div');
  heatmapCard.className = 'card';
  heatmapCard.innerHTML = '<h2>Team Heatmap</h2><div style="overflow-x:auto;"></div>';
  renderHeatmapInto(heatmapCard.querySelector('div'), schedule, numTeams);
  container.appendChild(heatmapCard);
}

function renderHeatmapInto(container, schedule, numTeams) {
  const gameDates = schedule.map(g => g.date).sort();
  const dates = [];
  if (gameDates.length > 0) {
    const cur = new Date(gameDates[0] + 'T00:00:00');
    const end = new Date(gameDates[gameDates.length - 1] + 'T00:00:00');
    while (cur <= end) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
  }

  const teamDates = [];
  for (let t = 0; t < numTeams; t++) {
    const s = new Set();
    for (const g of schedule) {
      if (g.home === t || g.away === t) s.add(g.date);
    }
    teamDates.push(s);
  }

  let html = '<table class="heatmap-table"><thead><tr><th></th>';
  for (const date of dates) {
    const d = new Date(date + 'T00:00:00');
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    html += `<th class="date-header${isWeekend ? ' weekend' : ''}">${label}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let t = 0; t < numTeams; t++) {
    html += `<tr><td class="team-name">${t + 1}B</td>`;
    for (const date of dates) {
      const cls = teamDates[t].has(date) ? 'active' : 'inactive';
      html += `<td class="heatmap-cell ${cls}"></td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ─── CSV Export ──────────────────────────────────────────────────────────────

function formatMultiDivisionCSV(divisionResults) {
  const allGames = [];
  for (const dr of divisionResults) {
    for (const g of dr.schedule) {
      allGames.push({ ...g, divisionName: dr.division.name });
    }
  }
  allGames.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ta = timeSortKey(a.time), tb = timeSortKey(b.time);
    if (ta !== tb) return ta - tb;
    return a.field < b.field ? -1 : 1;
  });

  const lines = ['Division,Day,Date,Time,Field,Away Team,Home Team'];
  for (const g of allGames) {
    const d = new Date(g.date + 'T00:00:00');
    const day = DAYS[d.getDay()];
    const dateDisplay = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    lines.push(`${g.divisionName},${day},${dateDisplay},${formatTimeDisplay(g.time)},${g.field},${g.away + 1}B,${g.home + 1}B`);
  }
  return lines.join('\n');
}

function downloadCSV() {
  if (!lastCSV) return;
  const blob = new Blob([lastCSV], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'schedule.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Error Display ───────────────────────────────────────────────────────────

function showError(msg) {
  const el = document.getElementById('errorBox');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError() {
  document.getElementById('errorBox').classList.add('hidden');
}

// ─── Sample Data ─────────────────────────────────────────────────────────────

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

// ─── Init ────────────────────────────────────────────────────────────────────

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
