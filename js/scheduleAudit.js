import { DAYS } from './constants.js';
import { daysBetween, formatTimeDisplay, timeSortKey } from './utils.js';

const GAP_BANDS = [[1, 1], [2, 2], [1, 2], [3, 3], [4, 4], [3, 4], [1, 4], [5, 7]];
const GAP_METRICS = GAP_BANDS.map(([min, max]) => ({
  id: `gap-${min}-${max}`,
  label: min === max ? String(min) : `${min}–${max}`
}));
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_METRICS = [
  { id: 'weekdays', label: 'Weekday' },
  { id: 'weekends', label: 'Weekend' },
  ...DAY_ORDER.map(day => ({ id: `day-${day}`, label: DAYS[day].slice(0, 3) }))
];
const COMPARABLE_METRICS = [...GAP_METRICS, ...DAY_METRICS];
const DEFAULT_TOLERANCE = 1;

export function getScheduleAudit(schedule, numTeams) {
  const byTeam = Array.from({ length: numTeams }, () => []);
  for (const game of schedule) {
    byTeam[game.home].push(game);
    byTeam[game.away].push(game);
  }
  return byTeam.map(games => {
    games.sort((a, b) => a.date.localeCompare(b.date) || timeSortKey(a.time) - timeSortKey(b.time));
    const stats = Object.fromEntries(COMPARABLE_METRICS.map(({ id }) => [id, []]));
    const gamesByDate = new Map();
    for (const [index, game] of games.entries()) {
      const sameDay = gamesByDate.get(game.date) ?? [];
      sameDay.push(game);
      gamesByDate.set(game.date, sameDay);
      stats[`day-${game.dayOfWeek}`].push([game]);
      stats[game.dayOfWeek === 0 || game.dayOfWeek === 6 ? 'weekends' : 'weekdays'].push([game]);
      if (index === 0) continue;
      const previous = games[index - 1];
      const gap = daysBetween(previous.date, game.date);
      for (const [bandIndex, [min, max]] of GAP_BANDS.entries()) {
        if (gap >= min && gap <= max) stats[GAP_METRICS[bandIndex].id].push([previous, game]);
      }
    }
    const doubleheaders = [...gamesByDate.values()].filter(group => group.length > 1);
    return { ...stats, doubleheaders };
  });
}

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function gameLabel(game, team) {
  const opponent = game.home === team ? game.away : game.home;
  return `${game.date} · ${formatTimeDisplay(game.time)} · ${game.field} · vs ${opponent + 1}B`;
}

function makeTable(metrics, rows, tolerances, showDetails) {
  const wrapper = element('div');
  wrapper.className = 'team-summary-scroll';
  const table = element('table');
  table.className = 'team-summary-table audit-table';
  const header = table.createTHead().insertRow();
  for (const name of ['Team', ...metrics.map(metric => metric.label)]) {
    const th = element('th', name);
    th.scope = 'col';
    header.append(th);
  }

  const averages = metrics.map(({ id }) => {
    if (id === 'doubleheaders' || !rows.length) return null;
    return rows.reduce((sum, row) => sum + row[id].length, 0) / rows.length;
  });
  const summary = table.createTFoot();
  for (const [label, describe] of [
    ['Division avg.', (_, index) => averages[index]?.toFixed(1)],
    ['Tolerance', ({ id }) => id === 'doubleheaders' ? null : `±${tolerances.get(id) ?? DEFAULT_TOLERANCE}`]
  ]) {
    const tr = summary.insertRow();
    const th = element('th', label);
    th.scope = 'row';
    tr.append(th);
    for (const [index, metric] of metrics.entries()) {
      tr.append(element('td', describe(metric, index) ?? '—'));
    }
  }

  const body = table.createTBody();
  for (const [team, stats] of rows.entries()) {
    const tr = body.insertRow();
    const th = element('th', `${team + 1}B`);
    th.scope = 'row';
    tr.append(th);
    for (const [index, { id, label }] of metrics.entries()) {
      const groups = stats[id];
      const count = groups.length;
      const average = averages[index];
      const tolerance = tolerances.get(id) ?? DEFAULT_TOLERANCE;
      let status = '';
      if (id === 'doubleheaders' && count) status = 'Hard violation';
      if (average !== null && count > average + tolerance) status = 'Above range';
      if (average !== null && count < average - tolerance) status = 'Below range';
      const cell = tr.insertCell();
      const metricName = id.startsWith('gap-') ? `${label} days apart` : label;
      if (count) {
        const button = element('button', String(count));
        button.type = 'button';
        button.className = 'audit-count';
        button.setAttribute('aria-label', `${team + 1}B, ${metricName}, ${count}${status ? `, ${status}` : ''}`);
        button.addEventListener('click', () => showDetails(team, metricName, groups));
        cell.append(button);
      } else {
        cell.textContent = '0';
      }
      if (status) {
        const label = element('span', status);
        label.className = 'audit-status';
        cell.classList.add(status === 'Below range' ? 'audit-below' : 'audit-above');
        cell.append(label);
      }
    }
  }
  wrapper.append(table);
  return wrapper;
}

export function renderScheduleAudit(container, schedule, numTeams, { viewState = {} } = {}) {
  const tolerances = viewState.auditTolerances ??= new Map();
  const rows = getScheduleAudit(schedule, numTeams);
  const card = element('section');
  card.className = 'card schedule-audit';
  const affected = rows.filter(row => row.doubleheaders.length);
  const affectedDates = new Set(affected.flatMap(row => row.doubleheaders.map(group => group[0].date)));
  const hardStatus = affected.length
    ? `Same-day doubleheaders affect ${affected.length} of ${numTeams} teams across ${affectedDates.size} date(s).`
    : `Same-day doubleheaders affect 0 of ${numTeams} teams.`;
  card.append(element('h2', 'Rest and Balance Audit'), element('p', hardStatus));

  const controls = element('div');
  controls.className = 'audit-controls';
  const metricLabel = element('label', 'Metric');
  const select = element('select');
  for (const { id, label } of COMPARABLE_METRICS) {
    const option = element('option', id.startsWith('gap-') ? `${label} days apart` : label);
    option.value = id;
    select.append(option);
  }
  metricLabel.append(select);
  const toleranceLabel = element('label', 'Tolerance (± games)');
  const input = element('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.required = true;
  input.value = DEFAULT_TOLERANCE;
  toleranceLabel.append(input);
  controls.append(metricLabel, toleranceLabel);
  const tables = element('div');
  const details = element('dialog');
  details.className = 'score-details-drawer audit-details';
  const detailHeader = element('header');
  detailHeader.className = 'score-details-header';
  const detailHeading = element('h2');
  const close = element('button', 'Close');
  close.type = 'button';
  close.className = 'btn-secondary btn-sm';
  close.addEventListener('click', () => details.close());
  detailHeader.append(detailHeading, close);
  const list = element('ul');
  details.append(detailHeader, list);

  function showDetails(team, label, groups) {
    detailHeading.textContent = `${team + 1}B · ${label}`;
    details.setAttribute('aria-label', detailHeading.textContent);
    list.replaceChildren(...groups.map(games =>
      element('li', games.map(game => gameLabel(game, team)).join(' → '))
    ));
    details.showModal();
  }

  function renderTables() {
    tables.replaceChildren(
      element('h3', 'Days Between Games'),
      element('p', 'Counts use consecutive games per team. Gap bands overlap. Doubleheaders count dates with two or more games.'),
      makeTable([{ id: 'doubleheaders', label: 'Doubleheaders' }, ...GAP_METRICS], rows, tolerances, showDetails),
      element('h3', 'Games by Day of Week'),
      makeTable(DAY_METRICS, rows, tolerances, showDetails)
    );
  }

  select.addEventListener('change', () => {
    viewState.auditMetric = select.value;
    input.value = tolerances.get(select.value) ?? DEFAULT_TOLERANCE;
  });
  input.addEventListener('change', () => {
    if (!input.checkValidity()) {
      input.value = tolerances.get(select.value) ?? DEFAULT_TOLERANCE;
      return;
    }
    tolerances.set(select.value, input.valueAsNumber);
    renderTables();
  });
  select.value = viewState.auditMetric ?? COMPARABLE_METRICS[0].id;
  input.value = tolerances.get(select.value) ?? DEFAULT_TOLERANCE;
  renderTables();
  card.append(controls, tables, details);
  container.append(card);
}
