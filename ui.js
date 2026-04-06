// ─── UI Controller ───────────────────────────────────────────────────────────
let lastCSV = '';
let cachedFieldNames = []; // field names parsed from TSV header
const STORAGE_KEY = 'scheduler_state';

// ─── LocalStorage Persistence ───────────────────────────────────────────────

function saveState() {
  const rows = document.querySelectorAll('#divisionTable tbody tr');
  const divisions = [];
  for (const tr of rows) {
    const uncheckedFields = [];
    for (const cb of tr.querySelectorAll('.div-fields input[type="checkbox"]')) {
      if (!cb.checked) uncheckedFields.push(cb.value);
    }
    divisions.push({
      name: tr.querySelector('.div-name').value,
      numTeams: tr.querySelector('.div-teams').value,
      gamesPerTeam: tr.querySelector('.div-games').value,
      leagueSplit: tr.querySelector('.div-league').checked,
      uncheckedFields
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
      addDivisionRow(div.name, div.numTeams, div.gamesPerTeam, div.leagueSplit);
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
  const defaults = {
    weekendSitouts: 12, weekdayBackToBack: 10, weekendDoubleHeaders: 5,
    crossBoundaryBTB: 7, gapVariance: 6, rollingDensity: 9, sixDayDensity: 10,
    shortGapPenalty: 3, timeDistribution: 3, fieldBalance: 4
  };
  for (const key in defaults) {
    const el = document.getElementById('w_' + key);
    if (el) el.value = defaults[key];
  }

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

function buildPenaltyGrid() {
  const grid = document.getElementById('penaltyGrid');
  for (const key in WEIGHTS) {
    const label = document.createElement('label');
    label.textContent = WEIGHT_LABELS[key] || key;
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', id: 'w_' + key, min: '0', max: '50', value: String(WEIGHTS[key]), step: '1' });
    grid.append(label, input);
  }
}

// ─── Division Management ─────────────────────────────────────────────────────

function addDivisionRow(name, numTeams, gamesPerTeam, leagueSplit) {
  const tbody = document.querySelector('#divisionTable tbody');
  const tr = document.createElement('tr');

  tr.innerHTML = `
    <td><input type="text" class="div-name" placeholder="e.g. Majors" value="${name || ''}"></td>
    <td><input type="number" class="div-teams" min="2" max="30" value="${numTeams || ''}"></td>
    <td><input type="number" class="div-games" min="1" max="100" value="${gamesPerTeam || ''}"></td>
    <td style="text-align:center;"><input type="checkbox" class="div-league" ${leagueSplit ? 'checked' : ''}></td>
    <td><div class="div-fields"></div></td>
    <td><button class="btn-remove" onclick="removeDivisionRow(this)" title="Remove division">&times;</button></td>
  `;

  tbody.appendChild(tr);
  populateFieldCheckboxes(tr);
  debouncedSave();
}

function removeDivisionRow(btn) {
  const tbody = document.querySelector('#divisionTable tbody');
  if (tbody.rows.length <= 1) return;
  btn.closest('tr').remove();
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

  const rows = document.querySelectorAll('#divisionTable tbody tr');
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

function readDivisions() {
  const rows = document.querySelectorAll('#divisionTable tbody tr');
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

    if (!name) throw new Error(`Division ${i + 1}: please enter a name`);
    if (!numTeams || numTeams < 2) throw new Error(`Division "${name}": need at least 2 teams`);
    if (!gamesPerTeam || gamesPerTeam < 1) throw new Error(`Division "${name}": need at least 1 game per team`);
    if (fields.length === 0) throw new Error(`Division "${name}": select at least one field`);

    divs.push({ name, numTeams, gamesPerTeam, leagueSplit, fields });
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

      for (let i = 0; i < divs.length; i++) {
        const div = divs[i];
        const divLabel = `Division "${div.name}" (${i + 1}/${divs.length})`;

        // Filter slots to this division's valid fields minus already-claimed slots
        const divSlots = allSlots.filter(s =>
          div.fields.includes(s.field) && !claimedKeys.has(s.sortKey)
        );

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
        }, { leagueSplit: div.leagueSplit });

        const finalSchedule = result.schedule;
        const finalDetails = scoreDetails(finalSchedule, div.numTeams, divSlots);

        // Claim the slots used by this division
        for (const g of finalSchedule) {
          const key = g.date + '-' + String(timeSortKey(g.time)).padStart(5, '0') + '-' + g.field;
          claimedKeys.add(key);
        }

        divisionResults.push({
          division: div,
          schedule: finalSchedule,
          details: finalDetails,
          greedyDetails: result.details,
          slots: divSlots
        });
      }

      lastCSV = formatMultiDivisionCSV(divisionResults);
      renderMultiDivisionResults(divisionResults);
      statusBox.classList.add('hidden');
      document.getElementById('results').classList.remove('hidden');
    } catch (e) {
      statusBox.classList.add('hidden');
      showError(e.message);
    }
  }, 50);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function weightedScore(d) {
  return d.weekendSitouts * WEIGHTS.weekendSitouts + d.weekdayBackToBack * WEIGHTS.weekdayBackToBack + d.weekendDoubleHeaders * WEIGHTS.weekendDoubleHeaders + d.crossBoundaryBTB * WEIGHTS.crossBoundaryBTB + d.gapVariance * WEIGHTS.gapVariance
    + d.rollingDensity * WEIGHTS.rollingDensity + d.sixDayDensity * WEIGHTS.sixDayDensity + d.shortGapPenalty * WEIGHTS.shortGapPenalty + d.timeDistribution * WEIGHTS.timeDistribution + d.fieldBalance * WEIGHTS.fieldBalance;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderMultiDivisionResults(divisionResults) {
  const container = document.getElementById('results');
  container.innerHTML = '';

  // Slot utilization by field
  renderSlotStats(container, divisionResults);

  // Floating TOC
  if (divisionResults.length > 1) {
    const toc = document.createElement('nav');
    toc.className = 'results-toc';
    toc.innerHTML = '<span class="toc-label">Jump to:</span>' +
      divisionResults.map((dr, i) =>
        `<a href="#division-${i}">${dr.division.name}</a>`
      ).join('');
    container.appendChild(toc);
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

function renderSlotStats(container, divisionResults) {
  // Collect all slots and all scheduled games across divisions, grouped by field
  const allSlots = divisionResults.flatMap(dr => dr.slots);
  const allGames = divisionResults.flatMap(dr => dr.schedule);

  // Unique fields from slots
  const fieldNames = [...new Set(allSlots.map(s => s.field))].sort();

  // Count per field: total slots, weekend slots, weekday slots, used weekend, used weekday
  const gamesByField = new Map();
  for (const g of allGames) {
    if (!gamesByField.has(g.field)) gamesByField.set(g.field, []);
    gamesByField.get(g.field).push(g);
  }

  // Also need total unique slots per field (avoid double-counting shared slots)
  const slotKeysByField = new Map();
  for (const dr of divisionResults) {
    for (const s of dr.slots) {
      if (!slotKeysByField.has(s.field)) slotKeysByField.set(s.field, new Set());
      slotKeysByField.get(s.field).add(s.sortKey);
    }
  }

  let html = '<table><thead><tr><th>Field</th><th>Weekend Slots</th><th>Weekday Slots</th><th>Total</th></tr></thead><tbody>';
  for (const field of fieldNames) {
    const slots = allSlots.filter(s => s.field === field);
    const seen = new Set();
    let weekendTotal = 0, weekdayTotal = 0;
    for (const s of slots) {
      if (seen.has(s.sortKey)) continue;
      seen.add(s.sortKey);
      if (s.dayOfWeek === 0 || s.dayOfWeek === 6) weekendTotal++;
      else weekdayTotal++;
    }
    const games = gamesByField.get(field) || [];
    let weekendUsed = 0, weekdayUsed = 0;
    for (const g of games) {
      const dow = new Date(g.date + 'T00:00:00').getDay();
      if (dow === 0 || dow === 6) weekendUsed++;
      else weekdayUsed++;
    }
    const total = weekendUsed + weekdayUsed;
    const totalSlots = weekendTotal + weekdayTotal;
    html += `<tr><td>${field}</td><td>${weekendUsed} / ${weekendTotal}</td><td>${weekdayUsed} / ${weekdayTotal}</td><td>${total} / ${totalSlots}</td></tr>`;
  }
  html += '</tbody></table>';

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2>Slot Utilization by Field</h2>' + html;
  container.appendChild(card);
}

function renderDivisionBlock(container, schedule, details, numTeams, leagueSplit) {
  // Score cards
  const cards = [
    { label: 'Weekend Sit-outs', value: details.weekendSitouts, min: 0,
      tip: 'Number of times a team has zero games on a weekend that has available slots. Lower is better.' },
    { label: 'Weekend Back-to-Back', value: details.weekendDoubleHeaders, min: details.minWeekendDH,
      tip: 'Number of times a team plays 2+ games in the same Sat-Sun weekend. Each extra game beyond 1 counts as 1.' },
    { label: 'Weekday Back-to-Back', value: details.weekdayBackToBack, min: 0,
      tip: 'Number of times a team plays on consecutive weekdays (e.g. Mon+Tue). Bad for pitcher rest. Lower is better.' },
    { label: 'Fri/Sat · Sun/Mon BTB', value: details.crossBoundaryBTB, min: 0,
      tip: 'Back-to-back games crossing the weekday/weekend boundary (Fri→Sat or Sun→Mon). Bad for pitcher rest.' },
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
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    html += `<th class="date-header">${label}</th>`;
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
