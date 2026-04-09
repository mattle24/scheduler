import { DAYS } from './constants.js';
import { daysBetween, slotBucket, timeSortKey, formatTimeDisplay } from './utils.js';

let lastCSV = '';
function setLastCSV(csv) { lastCSV = csv; }

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

    const bucketNames = ['WKND_EARLY', 'WKND_MID', 'WKND_LATE'];
    const bucketCounts = new Map();
    for (const b of bucketNames) bucketCounts.set(b, 0);
    for (const g of games) {
      if (g.dayOfWeek !== 0 && g.dayOfWeek !== 6) continue;
      const b = slotBucket(g.dayOfWeek, g.time);
      if (bucketCounts.has(b)) bucketCounts.set(b, bucketCounts.get(b) + 1);
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
      fieldCounts,
      bucketCounts
    });
  }

  const bucketNames = ['WKND_EARLY', 'WKND_MID', 'WKND_LATE'];
  const bucketLabels = { WKND_EARLY: 'Early (<10:30a)', WKND_MID: 'Mid (10:30a–3p)', WKND_LATE: 'Late (≥3p)' };
  const activeBuckets = teamData.length > 0
    ? bucketNames.filter(b => teamData.some(r => r.bucketCounts.get(b) > 0))
    : [];
  const bucketStats = new Map();
  for (const b of activeBuckets) {
    const vals = teamData.map(r => r.bucketCounts.get(b));
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
    bucketStats.set(b, { mean, stdDev: Math.sqrt(variance) });
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
  for (const b of activeBuckets) html += `<th>${bucketLabels[b] || b}</th>`;
  html += '</tr></thead><tbody>';
  for (const r of teamData) {
    html += '<tr>';
    if (leagueSplit) html += `<td>${r.league}</td>`;
    html += `<td>${r.team}</td><td>${r.games}</td><td>${r.home}</td><td>${r.away}</td><td>${r.haDiff >= 0 ? '+' : ''}${r.haDiff}</td><td>${r.avgGap}</td><td>${r.btb}</td>`;
    if (leagueSplit) html += `<td>${r.intraLeague}</td><td>${r.interLeague}</td>`;
    for (const f of allFields) html += `<td>${r.fieldCounts.get(f) || 0}</td>`;
    for (const b of activeBuckets) {
      const val = r.bucketCounts.get(b);
      const s = bucketStats.get(b);
      let cls = '';
      if (s && s.stdDev > 0) {
        const zscore = Math.abs(val - s.mean) / s.stdDev;
        if (zscore > 1.5) cls = ' class="bad"';
        else if (zscore > 0.8) cls = ' class="ok"';
        else cls = ' class="good"';
      }
      html += `<td${cls}>${val}</td>`;
    }
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

export {
  setLastCSV, renderMultiDivisionResults, renderFieldSections,
  renderDivisionBlock, renderHeatmapInto, formatMultiDivisionCSV,
  downloadCSV, showError, clearError
};
