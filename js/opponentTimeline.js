import { daysBetween, formatTimeDisplay, timeSortKey } from './utils.js';

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
  container.append(element('h2', 'Game Density'));
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
  let gameCount = viewState.gameCount ?? 3;
  let dayCount = viewState.dayCount ?? 5;

  const settings = element('div', '', 'timeline-window-controls');
  settings.append(numberControl('Games in stretch', gameCount, 2, 10, value => {
    viewState.gameCount = gameCount = value;
    render();
  }), numberControl('Calendar days', dayCount, 2, 14, value => {
    viewState.dayCount = dayCount = value;
    render();
  }));

  const grid = element('div', '', 'timeline-grid');
  const details = element('div', '', 'timeline-game-details');
  details.tabIndex = -1;
  details.hidden = true;
  container.append(settings, grid, details);

  function showStretches(team, stretches) {
    details.replaceChildren();
    details.hidden = false;
    details.append(element('h3', `${teamLabel(team)} · ${stretches.length} ${stretches.length === 1 ? 'stretch' : 'stretches'}`));
    for (const [index, stretch] of stretches.entries()) {
      details.append(element('h4', `Stretch ${index + 1} · ${formatDate(stretch[0].date)} – ${formatDate(stretch.at(-1).date)}`));
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
    details.hidden = true;
    grid.replaceChildren();
    grid.append(element('p', `Consecutive groups of ${gameCount} games within ${dayCount} calendar days. Overlapping stretches are counted separately.`));
    const table = element('table', '', 'heatmap-table timeline-table');
    table.setAttribute('aria-label', 'Game density by team');
    const header = table.createTHead().insertRow();
    for (const label of ['Team', 'Matching stretches']) {
      const cell = element('th', label);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = table.createTBody();
    for (const [team, games] of teamGames.entries()) {
      const row = body.insertRow();
      const teamCell = element('th', teamLabel(team));
      teamCell.scope = 'row';
      row.append(teamCell);
      const byGame = tightStretches(games, gameCount, dayCount);
      const stretches = [...new Set([...byGame.values()].flat())];
      const cell = row.insertCell();
      if (stretches.length) {
        const tally = button(String(stretches.length), () => showStretches(team, stretches));
        tally.setAttribute('aria-label', `${teamLabel(team)}: ${stretches.length} matching stretches; show games`);
        cell.append(tally);
      } else {
        cell.textContent = '0';
      }
    }
    grid.append(table);
  }

  render();
}
