// ─── UI Controller ───────────────────────────────────────────────────────────
let lastCSV = '';

document.addEventListener('DOMContentLoaded', () => {
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
  };
  reader.readAsText(file);
}

function showError(msg) {
  const el = document.getElementById('errorBox');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError() {
  document.getElementById('errorBox').classList.add('hidden');
}

function generate() {
  clearError();
  document.getElementById('results').classList.add('hidden');
  const statusBox = document.getElementById('statusBox');
  statusBox.classList.remove('hidden');
  statusBox.innerHTML = 'Phase 1: Building schedule...';

  setTimeout(() => {
    try {
      const numTeams = parseInt(document.getElementById('numTeams').value);
      const gamesPerTeam = parseInt(document.getElementById('gamesPerTeam').value);
      const tsvText = document.getElementById('tsvInput').value;

      if (!numTeams || numTeams < 2) throw new Error('Need at least 2 teams');
      if (!gamesPerTeam || gamesPerTeam < 1) throw new Error('Need at least 1 game per team');
      if (!tsvText.trim()) throw new Error('Please enter field availability data');

      const slots = parseTSV(tsvText);
      const result = buildSchedule(numTeams, gamesPerTeam, slots);

      // Phase 2: Simulated annealing refinement
      statusBox.innerHTML = `
        <div>Phase 2: Optimizing schedule...</div>
        <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
        <div class="progress-label" id="progressLabel">0%</div>`;

      anneal(result.schedule, slots, numTeams, (pct, score) => {
        const percent = Math.round(pct * 100);
        document.getElementById('progressFill').style.width = percent + '%';
        document.getElementById('progressLabel').textContent = percent + '% — score: ' + score.toFixed(1);
      }).then(refined => {
        const finalSchedule = refined.schedule;
        const finalDetails = scoreDetails(finalSchedule, numTeams, slots);

        lastCSV = formatCSV(finalSchedule);
        renderResults(finalSchedule, finalDetails, numTeams, slots, result.details);
        statusBox.classList.add('hidden');
        document.getElementById('results').classList.remove('hidden');
      });
    } catch (e) {
      statusBox.classList.add('hidden');
      showError(e.message);
    }
  }, 50);
}

function renderResults(schedule, details, numTeams, slots, greedyDetails) {
  // Compute slot utilization
  const weekendSlots = slots.filter(s => s.dayOfWeek === 0 || s.dayOfWeek === 6).length;
  const weekdaySlots = slots.filter(s => s.dayOfWeek >= 1 && s.dayOfWeek <= 5).length;
  const weekendUsed = schedule.filter(g => { const dow = new Date(g.date + 'T00:00:00').getDay(); return dow === 0 || dow === 6; }).length;
  const weekdayUsed = schedule.filter(g => { const dow = new Date(g.date + 'T00:00:00').getDay(); return dow >= 1 && dow <= 5; }).length;

  const cards = [
    { label: 'Weekend Slots', value: `${weekendUsed} / ${weekendSlots}`, rawClass: 'neutral',
      tip: 'Games scheduled on weekend slots out of total available weekend slots.' },
    { label: 'Weekday Slots', value: `${weekdayUsed} / ${weekdaySlots}`, rawClass: 'neutral',
      tip: 'Games scheduled on weekday slots out of total available weekday slots.' },
    { label: 'Weekend Sit-outs', value: details.weekendSitouts, min: 0,
      tip: 'Number of times a team has zero games on a weekend that has available slots. Lower is better.' },
    { label: 'Weekend Double-Headers', value: details.weekendDoubleHeaders, min: details.minWeekendDH,
      tip: 'Number of times a team plays 2+ games in the same Sat-Sun weekend. Each extra game beyond 1 counts as 1.' },
    { label: 'Weekday Back-to-Back', value: details.weekdayBackToBack, min: 0,
      tip: 'Number of times a team plays on consecutive weekdays (e.g. Mon+Tue). Bad for pitcher rest. Lower is better.' },
    { label: 'Fri/Sat · Sun/Mon BTB', value: details.crossBoundaryBTB, min: 0,
      tip: 'Back-to-back games crossing the weekday/weekend boundary (Fri→Sat or Sun→Mon). Bad for pitcher rest.' },
  ];

  document.getElementById('scoreGrid').innerHTML = cards.map(c => {
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
  }).join('');

  // Per-team summary
  const teamData = [];
  for (let t = 0; t < numTeams; t++) {
    const games = schedule.filter(g => g.home === t || g.away === t);
    const homeGames = schedule.filter(g => g.home === t).length;
    const awayGames = schedule.filter(g => g.away === t).length;
    const dates = games.map(g => g.date).sort();
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
    const minGap = gaps.length ? Math.min(...gaps) : '-';
    const avgGap = gaps.length ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1) : '-';

    const wgCount = new Map();
    for (const g of games) {
      const wg = getWeekendGroup(g.date);
      if (wg) wgCount.set(wg, (wgCount.get(wg) || 0) + 1);
    }
    let dh = 0;
    for (const [, c] of wgCount) if (c > 1) dh += c - 1;

    // Weekly clumps for this team
    const weekCount = new Map();
    for (const g of games) {
      const w = isoWeek(g.date);
      weekCount.set(w, (weekCount.get(w) || 0) + 1);
    }
    let clumps = 0;
    for (const [, c] of weekCount) if (c > 1) clumps += c - 1;

    // Games per field
    const fieldCounts = new Map();
    for (const g of games) {
      fieldCounts.set(g.field, (fieldCounts.get(g.field) || 0) + 1);
    }

    teamData.push({
      team: `Team ${t + 1}`,
      games: games.length,
      home: homeGames,
      away: awayGames,
      haDiff: homeGames - awayGames,
      minGap,
      avgGap,
      weekendDH: dh,
      clumps,
      fieldCounts
    });
  }

  // Collect all field names from the schedule, sorted
  const allFields = [...new Set(schedule.map(g => g.field))].sort();

  let html = '<table><thead><tr><th>Team</th><th>Games</th><th>Home</th><th>Away</th><th>H/A Diff</th><th>Min Gap</th><th>Avg Gap</th><th>Wknd DH</th><th>Wk Clumps</th>';
  for (const f of allFields) html += `<th>${f}</th>`;
  html += '</tr></thead><tbody>';
  for (const r of teamData) {
    html += `<tr><td>${r.team}</td><td>${r.games}</td><td>${r.home}</td><td>${r.away}</td><td>${r.haDiff >= 0 ? '+' : ''}${r.haDiff}</td><td>${r.minGap}</td><td>${r.avgGap}</td><td>${r.weekendDH}</td><td>${r.clumps}</td>`;
    for (const f of allFields) html += `<td>${r.fieldCounts.get(f) || 0}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  document.getElementById('teamSummary').innerHTML = html;

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
    shtml += `<tr><td>${day}</td><td>${dateDisplay}</td><td>${formatTimeDisplay(g.time)}</td><td>${g.field}</td><td>Team ${g.away + 1}</td><td>Team ${g.home + 1}</td></tr>`;
  }
  shtml += '</tbody></table>';
  document.getElementById('scheduleTable').innerHTML = shtml;

  renderHeatmap(schedule, numTeams);
}

function renderHeatmap(schedule, numTeams) {
  // Build contiguous date range from first to last game date
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

  // For each team, collect the set of dates they play on
  const teamDates = [];
  for (let t = 0; t < numTeams; t++) {
    const s = new Set();
    for (const g of schedule) {
      if (g.home === t || g.away === t) s.add(g.date);
    }
    teamDates.push(s);
  }

  // Build header row with rotated date labels
  let html = '<table class="heatmap-table"><thead><tr><th></th>';
  for (const date of dates) {
    const d = new Date(date + 'T00:00:00');
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    html += `<th class="date-header">${label}</th>`;
  }
  html += '</tr></thead><tbody>';

  // One row per team
  for (let t = 0; t < numTeams; t++) {
    html += `<tr><td class="team-name">Team ${t + 1}</td>`;
    for (const date of dates) {
      const cls = teamDates[t].has(date) ? 'active' : 'inactive';
      html += `<td class="heatmap-cell ${cls}"></td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  document.getElementById('heatmap').innerHTML = html;
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

function loadSample() {
  document.getElementById('numTeams').value = 16;
  document.getElementById('gamesPerTeam').value = 18;

  // 5 fields, 10 weeks starting Saturday April 11, 2026
  const fieldNames = ['Field 1', 'Field 2'];
  const start = new Date(2026, 3, 11); // Saturday
  const weekdayTimes = '6:00pm';
  const weekendTimes = '9:00am, 11:00am, 1:00pm, 3:00pm';

  // Build rows: each row = { date, times-per-field (same for all fields) }
  const rows = [];

  for (let w = 0; w < 10; w++) {
    const sat = new Date(start);
    sat.setDate(sat.getDate() + w * 7);

    // Saturday
    rows.push({ d: new Date(sat), times: weekendTimes });

    // Sunday
    const sun = new Date(sat);
    sun.setDate(sun.getDate() + 1);
    rows.push({ d: sun, times: weekendTimes });

    // Mon–Fri of the following week (Mon = sat + 2, Tue = sat + 3, ... Fri = sat + 6)
    for (let wd = 2; wd <= 6; wd++) {
      const day = new Date(sat);
      day.setDate(day.getDate() + wd);
      rows.push({ d: day, times: weekdayTimes });
    }
  }

  // Build TSV header
  let tsv = 'Date\t' + fieldNames.join('\t') + '\n';
  for (const r of rows) {
    const ds = `${r.d.getMonth() + 1}/${r.d.getDate()}/${r.d.getFullYear()}`;
    tsv += ds + '\t' + fieldNames.map(() => r.times).join('\t') + '\n';
  }

  document.getElementById('tsvInput').value = tsv;
}
