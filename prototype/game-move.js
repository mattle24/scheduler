// Standalone concept data and scoring. This file does not load the production scheduler.
const fields = ['North Diamond', 'South Diamond'];
const weeks = ['2027-04-10', '2027-04-17', '2027-04-24'];
const divisions = {
  Majors: { teams: 4, fields, excludedDays: [] },
  Minors: { teams: 4, fields: ['South Diamond'], excludedDays: [2, 4] }
};

const seedGames = [
  ['maj-1', 'Majors', '2027-04-10', 'North Diamond', '9:00am', 1, 2],
  ['maj-2', 'Majors', '2027-04-10', 'North Diamond', '11:00am', 3, 4],
  ['maj-3', 'Majors', '2027-04-13', 'North Diamond', '6:00pm', 1, 3],
  ['maj-4', 'Majors', '2027-04-15', 'North Diamond', '6:00pm', 2, 4],
  ['maj-5', 'Majors', '2027-04-17', 'South Diamond', '9:00am', 1, 4],
  ['maj-6', 'Majors', '2027-04-17', 'South Diamond', '11:00am', 2, 3],
  ['maj-7', 'Majors', '2027-04-24', 'South Diamond', '9:00am', 1, 2],
  ['maj-8', 'Majors', '2027-04-24', 'North Diamond', '9:00am', 3, 4],
  ['min-1', 'Minors', '2027-04-10', 'South Diamond', '9:00am', 1, 2],
  ['min-2', 'Minors', '2027-04-10', 'South Diamond', '11:00am', 3, 4],
  ['min-3', 'Minors', '2027-04-11', 'South Diamond', '9:00am', 1, 3],
  ['min-4', 'Minors', '2027-04-11', 'South Diamond', '11:00am', 2, 4],
  ['min-5', 'Minors', '2027-04-17', 'South Diamond', '1:00pm', 1, 4],
  ['min-6', 'Minors', '2027-04-18', 'South Diamond', '9:00am', 2, 3],
  ['min-7', 'Minors', '2027-04-24', 'South Diamond', '1:00pm', 1, 2],
  ['min-8', 'Minors', '2027-04-25', 'South Diamond', '11:00am', 3, 4]
];

function dayNumber(date) { return Date.parse(`${date}T00:00:00Z`) / 86400000; }
function addDays(date, count) { return new Date((dayNumber(date) + count) * 86400000).toISOString().slice(0, 10); }
function dayOfWeek(date) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }
function weekStart(date) { return addDays(date, -(dayOfWeek(date) + 6) % 7); }
function weekendKey(date) { return [0, 6].includes(dayOfWeek(date)) ? addDays(date, dayOfWeek(date) === 0 ? -1 : 0) : null; }
function formatDate(date, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', options);
}
function timeNumber(time) {
  const [, hours, minutes, period] = time.match(/^(\d+):(\d+)(am|pm)$/);
  return (Number(hours) % 12 + (period === 'pm' ? 12 : 0)) * 60 + Number(minutes);
}
function formatTime(time) { return time.replace(':00', '').replace(/(am|pm)$/, (_, period) => period.toUpperCase()); }
function slotKey(item) { return `${item.date}|${item.field}|${item.time}`; }
function teamKey(division, team) { return `${division}|${team}`; }
function gameLabel(game) { return `${game.division} · ${game.away}B vs ${game.home}B`; }
function signed(value) { return `${value > 0 ? '+' : ''}${value.toFixed(1)}`; }
function deltaLabel(value) {
  if (Math.abs(value) < 0.05) return 'No score change';
  return value < 0 ? `−${Math.abs(value).toFixed(1)} better` : `+${value.toFixed(1)} worse`;
}
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

const slots = [];
for (const saturday of weeks) {
  for (const offset of [0, 1, 3, 5]) {
    const date = addDays(saturday, offset);
    const times = offset < 2 ? ['9:00am', '11:00am', '1:00pm', '3:00pm'] : ['6:00pm'];
    for (const field of fields) for (const time of times) slots.push({ date, field, time });
  }
}

let games = seedGames.map(([id, division, date, field, time, away, home]) =>
  ({ id, division, date, field, time, away, home }));
let selectedGameId = null;
let targetKey = null;
let weekIndex = 2;
let notice = '';
let optionStates = new Map();
let currentScore;
const history = [];

const teamMetricNames = {
  weekendOff: 'Weekend without a game', weekendRepeat: 'Extra game in one weekend',
  shortRest: 'Short rest between games', restRhythm: 'Uneven rest intervals',
  earlyLate: 'Repeated early or late starts', fieldMix: 'Uneven field assignments',
  satSunMix: 'Saturday / Sunday imbalance'
};
const operationNames = {
  fieldGaps: 'Field continuity: open times between division games',
  loneFieldDay: 'Only one division game on a field and day',
  divisionSwitches: 'Division switches on a field',
  umpireOverlap: 'Games starting at the same time'
};

function teamScore(schedule, division, team) {
  const teamGames = schedule.filter(game => game.division === division && (game.home === team || game.away === team))
    .sort((a, b) => a.date.localeCompare(b.date));
  const weekendCounts = new Map();
  for (const game of teamGames) {
    const key = weekendKey(game.date);
    if (key) weekendCounts.set(key, (weekendCounts.get(key) || 0) + 1);
  }
  const missedWeekends = weeks.filter(week => !weekendCounts.has(week)).length;
  const unavoidableMisses = Math.max(0, weeks.length - teamGames.length);
  const weekendOff = Math.max(0, missedWeekends - unavoidableMisses) * 8;
  const weekendRepeat = [...weekendCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1) * 5, 0);
  const gaps = teamGames.slice(1).map((game, index) => dayNumber(game.date) - dayNumber(teamGames[index].date));
  const shortRest = gaps.reduce((sum, gap) => sum + (gap === 1 ? 8 : gap === 2 ? 4 : gap === 3 ? 1 : 0), 0);
  const meanGap = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 0;
  const restRhythm = gaps.length ? Math.sqrt(gaps.reduce((sum, gap) => sum + (gap - meanGap) ** 2, 0) / gaps.length) * 1.2 : 0;
  const weekendGames = teamGames.filter(game => weekendKey(game.date));
  const earlyCount = weekendGames.filter(game => timeNumber(game.time) < 630).length;
  const lateCount = weekendGames.filter(game => timeNumber(game.time) >= 900).length;
  const earlyLate = (Math.max(0, earlyCount - 1) + Math.max(0, lateCount - 1)) * 3;
  const allowedFields = divisions[division].fields;
  const counts = allowedFields.map(field => teamGames.filter(game => game.field === field).length);
  const fieldMix = counts.length > 1 ? (Math.max(...counts) - Math.min(...counts)) * 1.5 : 0;
  const saturdayCount = weekendGames.filter(game => dayOfWeek(game.date) === 6).length;
  const sundayCount = weekendGames.filter(game => dayOfWeek(game.date) === 0).length;
  const satSunMix = Math.abs(saturdayCount - sundayCount);
  const metrics = { weekendOff, weekendRepeat, shortRest, restRhythm, earlyLate, fieldMix, satSunMix };
  const facts = {
    weekendOff: `${missedWeekends} missed weekends`,
    weekendRepeat: `${[...weekendCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)} extra weekend games`,
    shortRest: `${gaps.filter(gap => gap <= 3).length} gaps of 3 days or less`,
    restRhythm: `${gaps.join(', ') || 'none'} days between games`,
    earlyLate: `${earlyCount} early, ${lateCount} late starts`,
    fieldMix: allowedFields.map((field, index) => `${field.split(' ')[0]} ${counts[index]}`).join(', '),
    satSunMix: `${saturdayCount} Saturday, ${sundayCount} Sunday games`
  };
  return { metrics, facts, total: Object.values(metrics).reduce((sum, value) => sum + value, 0) };
}

function operationScore(schedule) {
  const metrics = { fieldGaps: 0, loneFieldDay: 0, divisionSwitches: 0, umpireOverlap: 0 };
  const byFieldDay = new Map();
  const byDateTime = new Map();
  for (const game of schedule) {
    const fieldDay = `${game.field}|${game.date}`;
    if (!byFieldDay.has(fieldDay)) byFieldDay.set(fieldDay, []);
    byFieldDay.get(fieldDay).push(game);
    if (weekendKey(game.date)) {
      const dateTime = `${game.date}|${game.time}`;
      byDateTime.set(dateTime, (byDateTime.get(dateTime) || 0) + 1);
    }
  }
  for (const fieldGames of byFieldDay.values()) {
    fieldGames.sort((a, b) => timeNumber(a.time) - timeNumber(b.time));
    for (let i = 1; i < fieldGames.length; i++) {
      if (fieldGames[i].division !== fieldGames[i - 1].division) {
        metrics.divisionSwitches += 4;
        if (i >= 2 && fieldGames[i].division === fieldGames[i - 2].division) metrics.divisionSwitches += 12;
      }
    }
    if (!weekendKey(fieldGames[0].date)) continue;
    const byDivision = new Map();
    for (const game of fieldGames) {
      if (!byDivision.has(game.division)) byDivision.set(game.division, []);
      byDivision.get(game.division).push(timeNumber(game.time));
    }
    for (const times of byDivision.values()) {
      if (times.length === 1) metrics.loneFieldDay += 2;
      if (times.length < 2) continue;
      const allTimes = slots.filter(slot => slot.field === fieldGames[0].field && slot.date === fieldGames[0].date).map(slot => timeNumber(slot.time));
      metrics.fieldGaps += allTimes.filter(time => time > Math.min(...times) && time < Math.max(...times) && !times.includes(time)).length * 10;
    }
  }
  for (const count of byDateTime.values()) metrics.umpireOverlap += Math.max(0, count - 1) * 3;
  return { metrics, total: Object.values(metrics).reduce((sum, value) => sum + value, 0) };
}

function scoreSchedule(schedule) {
  const teams = {};
  for (const [division, config] of Object.entries(divisions)) {
    for (let team = 1; team <= config.teams; team++) teams[teamKey(division, team)] = teamScore(schedule, division, team);
  }
  const operations = operationScore(schedule);
  return { teams, operations, total: operations.total + Object.values(teams).reduce((sum, entry) => sum + entry.total, 0) };
}

function moveSchedule(game, slot) {
  const occupant = games.find(item => item.id !== game.id && slotKey(item) === slotKey(slot));
  return games.map(item => item.id === game.id ? { ...item, date: slot.date, field: slot.field, time: slot.time }
    : occupant && item.id === occupant.id ? { ...item, date: game.date, field: game.field, time: game.time } : item);
}

function moveReason(game, slot) {
  if (slotKey(game) === slotKey(slot)) return 'Current slot';
  const occupant = games.find(other => other.id !== game.id && slotKey(other) === slotKey(slot));
  const proposed = moveSchedule(game, slot);
  for (const moved of [game, occupant].filter(Boolean)) {
    const destination = moved.id === game.id ? slot : game;
    const config = divisions[moved.division];
    if (!config.fields.includes(destination.field)) return `${moved.division} cannot play at ${destination.field}`;
    if (config.excludedDays.includes(dayOfWeek(destination.date))) return `${moved.division}: day unavailable`;
    for (const team of [moved.away, moved.home]) {
    const dates = proposed.filter(item => item.division === moved.division && (item.away === team || item.home === team))
      .map(item => item.date).sort();
    if (new Set(dates).size !== dates.length) return `${moved.division} ${team}B already plays this day`;
    for (let i = 2; i < dates.length; i++) {
      if (dayNumber(dates[i]) - dayNumber(dates[i - 2]) <= 3) return `${moved.division} ${team}B would play 3 games in 4 days`;
    }
    const weekdayWeeks = new Set();
    for (const date of dates) {
      if (![0, 6].includes(dayOfWeek(date))) {
        const week = weekStart(date);
        if (weekdayWeeks.has(week)) return `${moved.division} ${team}B already has a weekday game that week`;
        weekdayWeeks.add(week);
      }
    }
  }
  }
  return '';
}

function selectedGame() { return games.find(game => game.id === selectedGameId); }
function assessOptions() {
  optionStates = new Map();
  currentScore = scoreSchedule(games);
  const game = selectedGame();
  if (!game) return;
  for (const slot of slots) {
    const reason = moveReason(game, slot);
    if (reason) optionStates.set(slotKey(slot), { reason });
    else {
      const score = scoreSchedule(moveSchedule(game, slot));
      optionStates.set(slotKey(slot), { score, delta: score.total - currentScore.total });
    }
  }
}

function renderBoard() {
  document.getElementById('previousWeek').disabled = weekIndex === 0;
  document.getElementById('nextWeek').disabled = weekIndex === weeks.length - 1;
  document.getElementById('weekJump').value = String(weekIndex);
  const selected = selectedGame();
  const selectionBar = document.getElementById('selectionBar');
  selectionBar.hidden = !selected;
  selectionBar.innerHTML = selected ? `<div><span>Selected game</span><strong>${escapeHTML(gameLabel(selected))}</strong><small>${formatDate(selected.date)} · ${escapeHTML(selected.field)} · ${formatTime(selected.time)}</small></div><button type="button" id="clearSelection">Clear selection</button>` : '';
  let html = '';
  for (const field of fields) {
    html += `<div class="field-row"><div class="field-row-heading"><span class="field-icon">◇</span><div><strong>${field}</strong><small>${games.filter(game => game.field === field).length} scheduled games</small></div></div><div class="day-grid">`;
    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(weeks[weekIndex], offset);
      const daySlots = slots.filter(slot => slot.field === field && slot.date === date);
      html += `<div class="day-column${daySlots.length ? '' : ' no-slots'}"><div class="day-header"><strong>${formatDate(date, { weekday: 'short' })}</strong><span>${formatDate(date, { month: 'short', day: 'numeric' })}</span></div>`;
      if (!daySlots.length) html += '<span class="empty-day">No field times</span>';
      for (const slot of daySlots) {
        const key = slotKey(slot);
        const occupant = games.find(game => slotKey(game) === key);
        const option = optionStates.get(key);
        if (occupant) {
          const isSource = occupant.id === selectedGameId;
          const action = isSource ? 'Click to unselect this game' : selected ? (option?.reason ? `Cannot swap: ${option.reason}` : 'Click to preview a swap with this game') : 'Click to select this game';
          html += `<button type="button" class="slot game ${occupant.division.toLowerCase()}${isSource ? ' source' : ''}${selected && !isSource && option?.reason ? ' blocked-game' : ''}${selected && !isSource && !option?.reason ? ' swap-target' : ''}${key === targetKey ? ' chosen' : ''}" data-game-id="${occupant.id}" title="${escapeHTML(action)}" aria-label="${escapeHTML(action)}: ${escapeHTML(gameLabel(occupant))} at ${formatTime(slot.time)}"><span class="slot-time">${formatTime(slot.time)}</span><strong>${occupant.division}</strong><small>${occupant.away}B vs ${occupant.home}B</small>${selected && !isSource ? `<small>${option?.reason ? escapeHTML(option.reason) : 'Swap · ' + deltaLabel(option.delta)}</small>` : ''}</button>`;
        } else if (selected && option && !option.reason) {
          html += `<button type="button" class="slot target ${option.delta < -0.05 ? 'better' : option.delta > 0.05 ? 'worse' : 'even'}${key === targetKey ? ' chosen' : ''}" data-slot-key="${key}" title="Click to preview a move to this open time" aria-label="Preview ${field}, ${formatDate(date)}, ${formatTime(slot.time)}: ${deltaLabel(option.delta)}"><span class="slot-time">${formatTime(slot.time)}</span><strong>${deltaLabel(option.delta)}</strong></button>`;
        } else {
          const reason = option?.reason || 'Open';
          html += `<div class="slot ${selected ? 'blocked' : 'vacant'}" title="${escapeHTML(reason)}"><span class="slot-time">${formatTime(slot.time)}</span><small>${escapeHTML(reason)}</small></div>`;
        }
      }
      html += '</div>';
    }
    html += '</div></div>';
  }
  document.getElementById('fieldBoard').innerHTML = html;
}

function renderOptions() {
  const date = document.getElementById('dateFilter').value;
  const field = document.getElementById('fieldFilter').value;
  const order = document.getElementById('sortFilter').value;
  if (!selectedGame()) {
    const available = games.filter(game => (!date || game.date === date) && (!field || game.field === field))
      .sort((a, b) => a.date.localeCompare(b.date) || timeNumber(a.time) - timeNumber(b.time) || a.field.localeCompare(b.field));
    document.getElementById('optionCount').textContent = `${available.length} scheduled games`;
    document.getElementById('optionList').innerHTML = available.length ? available.map(game =>
      `<button type="button" class="option-row" data-game-id="${game.id}" title="Click to select this game"><span class="option-date">${formatDate(game.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span><span>${escapeHTML(game.field)} · ${formatTime(game.time)}</span><strong>${escapeHTML(gameLabel(game))}</strong></button>`).join('') : '<p class="no-options">No games match these filters.</p>';
    return;
  }
  const legal = slots.filter(slot => optionStates.has(slotKey(slot)) && !optionStates.get(slotKey(slot)).reason)
    .filter(slot => (!date || slot.date === date) && (!field || slot.field === field));
  legal.sort((a, b) => order === 'score'
    ? optionStates.get(slotKey(a)).delta - optionStates.get(slotKey(b)).delta || a.date.localeCompare(b.date) || timeNumber(a.time) - timeNumber(b.time)
    : a.date.localeCompare(b.date) || timeNumber(a.time) - timeNumber(b.time) || a.field.localeCompare(b.field));
  document.getElementById('optionCount').textContent = `${legal.length} legal ${legal.length === 1 ? 'option' : 'options'}`;
  const list = document.getElementById('optionList');
  list.innerHTML = legal.length ? legal.map(slot => {
    const option = optionStates.get(slotKey(slot));
    const delta = option.delta;
    return `<button type="button" class="option-row${slotKey(slot) === targetKey ? ' active' : ''}" data-slot-key="${slotKey(slot)}"><span class="option-date">${formatDate(slot.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span><span>${slot.field} · ${formatTime(slot.time)}${games.some(game => slotKey(game) === slotKey(slot)) ? ' · Swap' : ' · Move'}</span><strong class="${delta < -0.05 ? 'favorable' : delta > 0.05 ? 'costly' : 'neutral'}">${deltaLabel(delta)}</strong></button>`;
  }).join('') : '<p class="no-options">No legal options match these filters.</p>';
}

function metricChanges(before, after, labels, beforeFacts = {}, afterFacts = {}) {
  return Object.keys(labels).map(key => ({ key, label: labels[key], before: before[key], after: after[key],
    beforeFact: beforeFacts[key], afterFact: afterFacts[key], delta: after[key] - before[key] }))
    .filter(change => Math.abs(change.delta) >= 0.05).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
function changeRows(changes, emptyMessage) {
  if (!changes.length) return `<p class="no-change">${emptyMessage}</p>`;
  return `<ul class="change-list">${changes.map(change => `<li><span>${escapeHTML(change.label)}</span><strong class="${change.delta < 0 ? 'favorable' : 'costly'}">${signed(change.delta)}</strong>${change.beforeFact ? `<small>${escapeHTML(change.beforeFact)} → ${escapeHTML(change.afterFact)}</small>` : ''}<small>${change.before.toFixed(1)} → ${change.after.toFixed(1)} penalty points</small></li>`).join('')}</ul>`;
}

function renderInspector() {
  const body = document.getElementById('inspectorBody');
  const game = selectedGame();
  document.getElementById('undoButton').disabled = history.length === 0;
  if (!game) {
    body.innerHTML = '<p class="empty-inspector">Select a game in the field schedule to begin.</p>';
    return;
  }
  const slot = slots.find(item => slotKey(item) === targetKey);
  const option = slot && optionStates.get(targetKey);
  const swapGame = slot && games.find(item => item.id !== game.id && slotKey(item) === slotKey(slot));
  let html = notice ? `<div class="notice" role="status">${escapeHTML(notice)}</div>` : '';
  html += `<div class="move-route"><div><span>Current game</span><strong>${escapeHTML(gameLabel(game))}</strong><small>${formatDate(game.date, { weekday: 'long', month: 'long', day: 'numeric' })} · ${game.field} · ${formatTime(game.time)}</small></div><span class="route-arrow">↓</span><div><span>${swapGame ? 'Swap with' : 'Proposed time'}</span><strong>${slot && option && !option.reason ? `${formatDate(slot.date, { weekday: 'long', month: 'long', day: 'numeric' })} · ${slot.field}` : 'Choose an open time'}</strong><small>${slot && option && !option.reason ? `${formatTime(slot.time)}${swapGame ? ' · ' + escapeHTML(gameLabel(swapGame)) : ''}` : 'Use the field grid or the full options list.'}</small></div></div>`;
  if (!slot || !option || option.reason) {
    html += '<p class="empty-inspector">Select a highlighted open time to see how both teams and field operations change.</p>';
    body.innerHTML = html;
    return;
  }
  const after = option.score;
  html += `<div class="total-impact"><span>Whole schedule</span><strong class="${option.delta < -0.05 ? 'favorable' : option.delta > 0.05 ? 'costly' : 'neutral'}">${deltaLabel(option.delta)}</strong><small>${currentScore.total.toFixed(1)} → ${after.total.toFixed(1)} penalty points</small></div>`;
  html += `<button type="button" id="applyMove" class="apply-button">${swapGame ? 'Apply this swap' : 'Apply this move'}</button>`;
  html += '<h3 class="impact-heading">Teams affected</h3>';
  const affected = new Map();
  for (const moved of [game, swapGame].filter(Boolean)) for (const team of [moved.away, moved.home]) affected.set(teamKey(moved.division, team), { division: moved.division, team });
  for (const [key, { division, team }] of affected) {
    const beforeTeam = currentScore.teams[key];
    const afterTeam = after.teams[key];
    const delta = afterTeam.total - beforeTeam.total;
    const changes = metricChanges(beforeTeam.metrics, afterTeam.metrics, teamMetricNames, beforeTeam.facts, afterTeam.facts);
    const verdict = delta < -0.05 ? `Advantaged ${signed(delta)}` : delta > 0.05 ? `Disadvantaged ${signed(delta)}` : 'No score change';
    html += `<div class="impact-card"><div class="impact-card-heading"><strong>${division} ${team}B</strong><span class="${delta < -0.05 ? 'favorable' : delta > 0.05 ? 'costly' : 'neutral'}">${verdict}</span></div>${changeRows(changes, 'No team penalty changes for this move.')}</div>`;
  }
  const operations = metricChanges(currentScore.operations.metrics, after.operations.metrics, operationNames);
  const operationDelta = after.operations.total - currentScore.operations.total;
  html += `<h3 class="impact-heading">Non-team penalties <span class="${operationDelta < -0.05 ? 'favorable' : operationDelta > 0.05 ? 'costly' : 'neutral'}">${deltaLabel(operationDelta)}</span></h3><div class="impact-card">${changeRows(operations, 'No non-team penalty changes for this move.')}</div>`;
  html += `<p class="score-note">The total combines penalties for affected teams and field operations. Lower is better; you can still choose a move with a higher score.</p>`;
  body.innerHTML = html;
}

function render() { assessOptions(); renderBoard(); renderOptions(); renderInspector(); }
function selectTarget(key) {
  const option = optionStates.get(key);
  if (!option || option.reason) return;
  targetKey = key;
  weekIndex = Math.max(0, Math.min(weeks.length - 1, Math.floor((dayNumber(key.slice(0, 10)) - dayNumber(weeks[0])) / 7)));
  notice = '';
  render();
}

for (const [id, showSchedule] of [['scheduleView', true], ['tableView', false]]) {
  document.getElementById(id).addEventListener('click', () => {
    document.querySelector('.board-panel').hidden = !showSchedule;
    document.querySelector('.options-panel').hidden = showSchedule;
    document.getElementById('scheduleView').setAttribute('aria-pressed', String(showSchedule));
    document.getElementById('tableView').setAttribute('aria-pressed', String(!showSchedule));
  });
}

const weekJump = document.getElementById('weekJump');
weekJump.innerHTML = weeks.map((week, index) => `<option value="${index}">${formatDate(week, { month: 'short', day: 'numeric' })} – ${formatDate(addDays(week, 6), { month: 'short', day: 'numeric', year: 'numeric' })}</option>`).join('');
weekJump.addEventListener('change', () => { weekIndex = Number(weekJump.value); renderBoard(); });

const dateFilter = document.getElementById('dateFilter');
dateFilter.innerHTML = '<option value="">All dates</option>' + [...new Set(slots.map(slot => slot.date))].map(date => `<option value="${date}">${formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}</option>`).join('');
document.getElementById('fieldFilter').innerHTML = '<option value="">All fields</option>' + fields.map(field => `<option>${field}</option>`).join('');
for (const id of ['dateFilter', 'fieldFilter', 'sortFilter']) document.getElementById(id).addEventListener('change', renderOptions);
document.getElementById('previousWeek').addEventListener('click', () => { weekIndex--; renderBoard(); });
document.getElementById('nextWeek').addEventListener('click', () => { weekIndex++; renderBoard(); });
document.getElementById('selectionBar').addEventListener('click', event => {
  if (event.target.id !== 'clearSelection') return;
  selectedGameId = null;
  targetKey = null;
  notice = '';
  render();
});
document.getElementById('fieldBoard').addEventListener('click', event => {
  const gameButton = event.target.closest('[data-game-id]');
  if (gameButton) {
    const clickedId = gameButton.dataset.gameId;
    if (selectedGameId && clickedId !== selectedGameId) {
      const clicked = games.find(game => game.id === clickedId);
      selectTarget(slotKey(clicked));
      return;
    }
    selectedGameId = clickedId === selectedGameId ? null : clickedId;
    targetKey = null;
    notice = '';
    render();
    return;
  }
  const slotButton = event.target.closest('[data-slot-key]');
  if (slotButton) selectTarget(slotButton.dataset.slotKey);
});
document.getElementById('optionList').addEventListener('click', event => {
  const gameButton = event.target.closest('[data-game-id]');
  if (gameButton) { selectedGameId = gameButton.dataset.gameId; targetKey = null; notice = ''; render(); return; }
  const button = event.target.closest('[data-slot-key]');
  if (button) selectTarget(button.dataset.slotKey);
});
document.getElementById('inspectorBody').addEventListener('click', event => {
  if (event.target.id !== 'applyMove' || !targetKey || optionStates.get(targetKey)?.reason) return;
  const game = selectedGame();
  const slot = slots.find(item => slotKey(item) === targetKey);
  if (!game || !slot || moveReason(game, slot)) return;
  const occupant = games.find(item => item.id !== game.id && slotKey(item) === slotKey(slot));
  history.push([game, occupant].filter(Boolean).map(item => ({ ...item })));
  games = moveSchedule(game, slot);
  targetKey = null;
  notice = `${gameLabel(game)} ${occupant ? 'swapped with ' + gameLabel(occupant) + ' at' : 'moved to'} ${slot.field} on ${formatDate(slot.date)} at ${formatTime(slot.time)}.`;
  render();
});
document.getElementById('undoButton').addEventListener('click', () => {
  const previous = history.pop();
  if (!previous) return;
  games = games.map(game => previous.find(item => item.id === game.id) || game);
  selectedGameId = previous[0].id;
  targetKey = null;
  weekIndex = Math.floor((dayNumber(previous[0].date) - dayNumber(weeks[0])) / 7);
  notice = 'Last move undone.';
  render();
});

render();
