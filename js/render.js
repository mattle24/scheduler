import { DAYS } from './constants.js';
import { daysBetween, slotBucket, timeSortKey, formatTimeDisplay, isoWeek, addDays } from './utils.js';

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
  const fieldHeading = document.createElement('h2');
  fieldHeading.className = 'field-schedules-heading';
  fieldHeading.textContent = 'Field Schedules';
  container.appendChild(fieldHeading);

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
      fieldGameDiv.get(g.field).set(g.date + '|' + g.time, { division: dr.division.name, game: g });
    }
  }

  // Division names
  const divNames = divisionResults.map(dr => dr.division.name);

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
  const firstWeek = isoWeek(allDates[0]);
  const lastWeek = isoWeek(allDates[allDates.length - 1]);
  let selectedWeek = firstWeek;
  const datePicker = document.createElement('div');
  datePicker.className = 'field-date-picker';
  const dateLabel = document.createElement('label');
  dateLabel.htmlFor = 'field-jump-date';
  dateLabel.textContent = 'Jump to date';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.id = 'field-jump-date';
  dateInput.min = firstWeek;
  dateInput.max = addDays(lastWeek, 6);
  datePicker.append(dateLabel, dateInput);
  container.appendChild(datePicker);
  const legend = document.createElement('div');
  legend.className = 'field-legend';
  legend.setAttribute('aria-label', 'Field grid legend');
  legend.innerHTML = '<span><i class="field-legend-swatch field-legend-empty" aria-hidden="true"></i>Open field time</span>' +
    '<span><i class="field-legend-swatch field-legend-occupied" aria-hidden="true"></i>Used by another division</span>' +
    '<span><i class="field-legend-swatch field-legend-unavailable" aria-hidden="true">×</i>Field unavailable</span>' +
    '<span><b class="field-legend-weekend">Underlined date</b> Weekend</span>';
  container.appendChild(legend);
  const fieldSections = document.createElement('div');
  container.appendChild(fieldSections);
  const tooltip = document.createElement('div');
  tooltip.className = 'field-game-tooltip';
  tooltip.id = 'field-game-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  container.appendChild(tooltip);
  let activeButton = null;
  function hideTooltip() {
    tooltip.hidden = true;
    if (activeButton) activeButton.removeAttribute('aria-describedby');
    activeButton = null;
  }
  function showTooltip(button) {
    if (activeButton && activeButton !== button) activeButton.removeAttribute('aria-describedby');
    activeButton = button;
    button.setAttribute('aria-describedby', tooltip.id);
    tooltip.textContent = button.dataset.gameDetails;
    tooltip.hidden = false;
    const rect = button.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8))}px`;
    tooltip.style.top = `${rect.top >= box.height + 8 ? rect.top - box.height - 4 : rect.bottom + 4}px`;
  }
  fieldSections.addEventListener('pointerover', e => {
    const button = e.target.closest('.field-game-button');
    if (button && e.pointerType !== 'touch') showTooltip(button);
  });
  fieldSections.addEventListener('pointerout', e => {
    if (e.target.closest('.field-game-button') && !e.target.closest('.field-game-button').contains(e.relatedTarget) && document.activeElement !== activeButton) hideTooltip();
  });
  fieldSections.addEventListener('focusin', e => {
    if (e.target.matches('.field-game-button')) showTooltip(e.target);
  });
  fieldSections.addEventListener('focusout', e => {
    if (e.target.matches('.field-game-button')) hideTooltip();
  });
  fieldSections.addEventListener('click', e => {
    const button = e.target.closest('.field-game-button');
    if (button) showTooltip(button);
  });
  fieldSections.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideTooltip();
  });
  container.addEventListener('pointerdown', e => {
    if (!e.target.closest('.field-game-button')) hideTooltip();
  });

  function renderWeek() {
    hideTooltip();
    const end = addDays(selectedWeek, 6);
    const formatDate = date => new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric'
    });
    const weekLabel = `${formatDate(selectedWeek)} – ${formatDate(end)}`;
    dateInput.value = selectedWeek;
    fieldSections.innerHTML = '';
    const weekColumns = columns.filter(col => col.date >= selectedWeek && col.date <= end);
    const colSpanByDate = new Map();
    for (const col of weekColumns) colSpanByDate.set(col.date, (colSpanByDate.get(col.date) || 0) + 1);

    for (const field of fieldNames) {
      const section = document.createElement('div');
      section.className = 'division-section field-section';
      section.id = `field-${field.replace(/\s+/g, '-')}`;
      const heading = document.createElement('h3');
      heading.textContent = field;
      section.appendChild(heading);

      const available = fieldSlotKeys.get(field) || new Set();
      const gameMap = fieldGameDiv.get(field) || new Map();

      // Utilization stats
      const totalSlots = available.size;
      const usedSlots = [...available].filter(k => gameMap.has(k)).length;

      const card = document.createElement('div');
      card.className = 'card';
      const localNavigation = document.createElement('div');
      localNavigation.className = 'field-week-navigation field-week-navigation-local';
      localNavigation.setAttribute('aria-label', `${field} schedule week`);
      const localPrevious = document.createElement('button');
      localPrevious.type = 'button';
      localPrevious.className = 'btn-secondary btn-sm';
      localPrevious.textContent = 'Previous week';
      localPrevious.disabled = selectedWeek === firstWeek;
      const localLabel = document.createElement('strong');
      localLabel.textContent = weekLabel;
      const localNext = document.createElement('button');
      localNext.type = 'button';
      localNext.className = 'btn-secondary btn-sm';
      localNext.textContent = 'Next week';
      localNext.disabled = selectedWeek === lastWeek;
      localPrevious.addEventListener('click', () => changeWeek(-7, field, 'previous'));
      localNext.addEventListener('click', () => changeWeek(7, field, 'next'));
      localNavigation.append(localPrevious, localLabel, localNext);
      section.appendChild(localNavigation);

      let html = `<div class="field-stats">Season total: ${usedSlots} / ${totalSlots} available field times used</div>`;
      if (weekColumns.length === 0) html += '<p class="field-week-empty">No available field times this week.</p>';
      html += '<div style="overflow-x:auto;">';
      html += '<table class="heatmap-table field-heatmap"><thead>';

      // Date header row
      html += '<tr><th></th>';
      let prevDate = '';
      for (const col of weekColumns) {
        if (col.date !== prevDate) {
          const span = colSpanByDate.get(col.date);
          const d = new Date(col.date + 'T00:00:00');
          const dow = d.getDay();
          const isWeekend = dow === 0 || dow === 6;
          const label = `${d.getMonth() + 1}/${d.getDate()}`;
          html += `<th colspan="${span}" class="date-header field-date-header date-start${isWeekend ? ' weekend' : ''}">${label}</th>`;
          prevDate = col.date;
        }
      }
      html += '</tr>';

      // Time header row
      html += '<tr><th></th>';
      for (let i = 0; i < weekColumns.length; i++) {
        const col = weekColumns[i];
        const dateStart = i === 0 || col.date !== weekColumns[i - 1].date;
        html += `<th class="time-header${dateStart ? ' date-start' : ''}">${formatTimeDisplay(col.time).replace(/^0/, '').replace(':00 ', ' ')}</th>`;
      }
      html += '</tr></thead><tbody>';

      // One row per division
      for (let di = 0; di < divNames.length; di++) {
        const divName = divNames[di];
        html += `<tr><td class="team-name">${divName}</td>`;
        for (let i = 0; i < weekColumns.length; i++) {
          const col = weekColumns[i];
          const dateStart = i === 0 || col.date !== weekColumns[i - 1].date;
          const key = col.dateTime;
          const isAvailable = available.has(key);
          const gameEntry = gameMap.get(key);
          let cls, style;
          if (!isAvailable) {
            cls = 'field-unavail';
            style = '';
          } else if (gameEntry && gameEntry.division === divName) {
            cls = 'field-used';
            style = '';
          } else {
            cls = gameEntry ? 'field-occupied' : 'field-free';
            style = '';
          }
          let content = cls === 'field-unavail' ? '<span aria-label="Field unavailable">×</span>' : '';
          if (cls === 'field-used') {
            const game = gameEntry.game;
            const date = new Date(col.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
            const details = `${divName}: ${game.away + 1}B vs ${game.home + 1}B · ${date} · ${formatTimeDisplay(col.time).replace(/^0/, '').replace(':00 ', ' ')}`;
            const escaped = details.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            content = `<button type="button" class="field-game-button" aria-label="${escaped}" data-game-details="${escaped}"></button>`;
          }
          html += `<td class="heatmap-cell ${cls}${dateStart ? ' date-start' : ''}"${style}>${content}</td>`;
        }
        html += '</tr>';
      }

      html += '</tbody></table></div>';
      card.innerHTML = html;
      section.appendChild(card);
      fieldSections.appendChild(section);
    }
  }
  function changeWeek(days, field, direction) {
    selectedWeek = addDays(selectedWeek, days);
    renderWeek();
    if (field) {
      const section = [...fieldSections.children].find(el => el.id === `field-${field.replace(/\s+/g, '-')}`);
      const buttons = section.querySelectorAll('.field-week-navigation-local button');
      const target = buttons[direction === 'previous' ? 0 : 1];
      (target.disabled ? buttons[direction === 'previous' ? 1 : 0] : target).focus({ preventScroll: true });
    }
  }
  dateInput.addEventListener('change', () => {
    if (!dateInput.value || !dateInput.validity.valid) return;
    selectedWeek = isoWeek(dateInput.value);
    renderWeek();
  });
  renderWeek();
}

function renderDivisionBlock(container, schedule, details, numTeams, leagueSplit) {
  // Score cards
  const cards = [
    { label: 'Weekend Sit-outs', value: details.weekendSitouts, min: 0,
      tip: 'Number of times a team has zero games on a weekend that has available field times. Lower is better.' },
    { label: 'Weekend Back-to-Back', value: details.weekendDoubleHeaders, min: details.minWeekendDH,
      tip: 'Number of times a team plays 2+ games in the same Sat-Sun weekend. Each extra game beyond 1 counts as 1.' },
    { label: 'Early Season Density', value: details.earlySeasonDensity, min: 0,
      tip: 'Pairs of games within 2 days of each other in the first 7 days of the season.' },
    { label: 'Weekend B2B Field Time', value: details.weekendBTBTimePenalty, min: 0,
      tip: 'Cases where 2nd day of a Fri/Sat or Sat/Sun back-to-back has an earlier field time than the 1st day.' },
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
  // Sort by league (AL first) then team number
  if (leagueSplit) {
    teamData.sort((a, b) => {
      if (a.league !== b.league) return a.league === 'AL' ? -1 : 1;
      return parseInt(a.team) - parseInt(b.team);
    });
  }

  const allFields = [...new Set(schedule.map(g => g.field))].sort();

  let html = '<div class="team-summary-scroll"><table class="team-summary-table"><thead><tr>';
  if (leagueSplit) html += '<th rowspan="2" scope="col">League</th>';
  html += '<th rowspan="2" scope="col">Team</th>';
  html += `<th colspan="${leagueSplit ? 5 : 3}" scope="colgroup">Games</th>`;
  html += '<th colspan="2" scope="colgroup">Rest</th>';
  if (allFields.length) html += `<th colspan="${allFields.length}" scope="colgroup">Fields</th>`;
  if (activeBuckets.length) html += `<th colspan="${activeBuckets.length}" scope="colgroup">Weekend start times</th>`;
  html += '</tr><tr><th scope="col">Total</th><th scope="col">Home</th><th scope="col">Away</th>';
  if (leagueSplit) html += '<th scope="col">Intra</th><th scope="col">Inter</th>';
  html += '<th class="group-start" scope="col">Days between<br>games (avg)</th><th scope="col">Consecutive-day<br>games</th>';
  for (const [i, f] of allFields.entries()) html += `<th class="${i === 0 ? 'group-start' : ''}" scope="col">${f}</th>`;
  for (const [i, b] of activeBuckets.entries()) html += `<th class="${i === 0 ? 'group-start' : ''}" scope="col">${bucketLabels[b] || b}</th>`;
  html += '</tr></thead><tbody>';
  for (const r of teamData) {
    html += '<tr>';
    if (leagueSplit) html += `<td>${r.league}</td>`;
    html += `<td>${r.team}</td><td>${r.games}</td><td>${r.home}</td><td>${r.away}</td>`;
    if (leagueSplit) html += `<td>${r.intraLeague}</td><td>${r.interLeague}</td>`;
    html += `<td class="group-start">${r.avgGap}</td><td>${r.btb}</td>`;
    for (const [i, f] of allFields.entries()) html += `<td class="${i === 0 ? 'group-start' : ''}">${r.fieldCounts.get(f) || 0}</td>`;
    for (const [i, b] of activeBuckets.entries()) html += `<td class="${i === 0 ? 'group-start' : ''}">${r.bucketCounts.get(b)}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table></div>';

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
  heatmapCard.innerHTML = '<h2>Team Schedule</h2><div style="overflow-x:auto;"></div>';
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
