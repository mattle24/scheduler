import { addDays, daysBetween, formatTimeDisplay, isoWeek, timeSortKey } from './utils.js';

// Each consecutive group of the requested size is a separate stretch.
// Index it by game so stretches can be shown even across visible date ranges.
export function tightStretches(games, gameCount, dayCount) {
  const byGame = new Map();
  for (let i = 0; i <= games.length - gameCount; i++) {
    if (daysBetween(games[i].date, games[i + gameCount - 1].date) >= dayCount) continue;
    const stretch = games.slice(i, i + gameCount);
    for (const game of stretch) {
      if (!byGame.has(game)) byGame.set(game, []);
      byGame.get(game).push(stretch);
    }
  }
  return byGame;
}

function element(tag, label = '', className = '') {
  const node = document.createElement(tag);
  if (label) node.textContent = label;
  if (className) node.className = className;
  return node;
}

function button(label, action, className = 'btn-secondary btn-sm') {
  const control = element('button', label, className);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}

function numberControl(label, value, min, max, onChange) {
  const wrapper = element('label', label);
  const input = element('input');
  input.type = 'number';
  input.min = min;
  input.max = max;
  input.value = value;
  input.addEventListener('change', () => {
    const next = input.valueAsNumber;
    if (!Number.isInteger(next) || next < min || next > max) {
      input.value = value;
      return;
    }
    value = next;
    onChange(next);
  });
  wrapper.append(input);
  return wrapper;
}

const teamLabel = team => `${team + 1}B`;
const opponent = (game, team) => game.home === team ? game.away : game.home;
const shortDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
const formatDate = date => shortDate.format(new Date(date + 'T00:00:00'));

export function renderOpponentTimeline(container, schedule, numTeams, onEditGame, viewState = {}) {
  container.append(element('h2', 'Opponent Timeline'));
  if (!schedule.length) {
    container.append(element('p', 'No games scheduled.'));
    return;
  }

  const sortedGames = [...schedule].sort((a, b) =>
    a.date.localeCompare(b.date) || timeSortKey(a.time) - timeSortKey(b.time));
  const teamGames = Array.from({ length: numTeams }, () => []);
  for (const game of sortedGames) {
    teamGames[game.home].push(game);
    teamGames[game.away].push(game);
  }
  const gamesByTeamAndDate = teamGames.map(games => {
    const byDate = new Map();
    for (const game of games) {
      if (!byDate.has(game.date)) byDate.set(game.date, []);
      byDate.get(game.date).push(game);
    }
    return byDate;
  });

  const firstWeek = isoWeek(sortedGames[0].date);
  const lastWeek = isoWeek(sortedGames.at(-1).date);
  const lastStart = firstWeek === lastWeek ? firstWeek : addDays(lastWeek, -7);
  let week = viewState.week ?? firstWeek;
  week = week < firstWeek ? firstWeek : week > lastStart ? lastStart : week;
  let gameCount = viewState.gameCount ?? 3;
  let dayCount = viewState.dayCount ?? 5;

  const navigation = element('div', '', 'field-week-navigation field-week-navigation-local');
  const dateRange = element('strong');
  dateRange.setAttribute('aria-live', 'polite');
  const previous = button('Previous week', () => changeWeek(-7));
  const next = button('Next week', () => changeWeek(7));
  navigation.append(previous, dateRange, next);

  const settings = element('div', '', 'timeline-window-controls');
  const legend = element('span', '', 'timeline-window-legend');
  settings.append(numberControl('Games in stretch', gameCount, 2, 10, value => {
    viewState.gameCount = gameCount = value;
    render();
  }), numberControl('Calendar days', dayCount, 2, 14, value => {
    viewState.dayCount = dayCount = value;
    render();
  }), legend);

  const grid = element('div', '', 'timeline-grid');
  const details = element('div', '', 'timeline-game-details');
  details.tabIndex = -1;
  details.hidden = true;
  container.append(navigation, settings, grid, details);

  function changeWeek(offset) {
    viewState.week = week = addDays(week, offset);
    render();
  }

  function showGames(game, team, stretches) {
    details.replaceChildren();
    details.hidden = false;
    details.append(element('h3', `${teamLabel(team)} vs ${teamLabel(opponent(game, team))} · ${formatDate(game.date)}`));
    if (stretches.length) {
      details.append(element('p', `Tight stretches of ${gameCount} games within ${dayCount} calendar days`));
    }
    for (const stretch of stretches.length ? stretches : [[game]]) {
      const list = element('ul');
      for (const member of stretch) {
        const label = `${formatDate(member.date)} · ${formatTimeDisplay(member.time)} · ${member.field} · ${teamLabel(member.away)} at ${teamLabel(member.home)}`;
        const item = element('li', label);
        if (onEditGame) {
          const edit = button('Preview move or swap', () => onEditGame(member));
          edit.setAttribute('aria-label', `Preview move or swap for ${label}`);
          item.append(edit);
        }
        list.append(item);
      }
      details.append(list);
    }
    details.focus();
  }

  function render() {
    const dates = Array.from({ length: 14 }, (_, index) => addDays(week, index));
    dateRange.textContent = `${formatDate(week)} – ${formatDate(dates.at(-1))}`;
    legend.textContent = `⚑ ${gameCount} games within ${dayCount} calendar days`;
    previous.disabled = week === firstWeek;
    next.disabled = week === lastStart;
    details.hidden = true;
    grid.replaceChildren();

    const table = element('table', '', 'heatmap-table team-heatmap timeline-table');
    table.setAttribute('aria-label', 'Opponents by team and date');
    const header = table.createTHead().insertRow();
    const teamHeader = element('th', 'Team');
    teamHeader.scope = 'col';
    header.append(teamHeader);
    for (const date of dates) {
      const day = new Date(date + 'T00:00:00').getDay();
      const cell = element('th', formatDate(date), day === 0 || day === 6 ? 'date-header weekend' : 'date-header');
      cell.scope = 'col';
      header.append(cell);
    }

    const body = table.createTBody();
    for (const [team, games] of teamGames.entries()) {
      const row = body.insertRow();
      const teamCell = element('th', teamLabel(team), 'timeline-team');
      teamCell.scope = 'row';
      row.append(teamCell);
      const stretches = tightStretches(games, gameCount, dayCount);
      const byDate = gamesByTeamAndDate[team];
      for (const date of dates) {
        const cell = row.insertCell();
        for (const game of byDate.get(date) ?? []) {
          const flagged = stretches.get(game) ?? [];
          const opponentLabel = teamLabel(opponent(game, team));
          const gameButton = button(
            flagged.length ? `${opponentLabel} ⚑` : opponentLabel,
            () => showGames(game, team, flagged),
            flagged.length ? 'timeline-match timeline-match-tight' : 'timeline-match'
          );
          gameButton.setAttribute('aria-label',
            `${teamLabel(team)} vs ${opponentLabel}, ${formatDate(date)}${flagged.length ? ', tight stretch' : ''}`);
          cell.append(gameButton);
        }
      }
    }
    grid.append(table);
  }

  render();
}
