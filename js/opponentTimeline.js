// @ts-nocheck -- Pending migration to checked JSDoc.
import { addDays, daysBetween, formatTimeDisplay, timeSortKey } from './utils.js';

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
    selectedTeam = selectedStretch = null;
    details.replaceChildren(element('p', 'Select a team’s tally to see its matching stretches.'));
    render();
  }), numberControl('Calendar days', dayCount, 2, 14, value => {
    viewState.dayCount = dayCount = value;
    selectedTeam = selectedStretch = null;
    details.replaceChildren(element('p', 'Select a team’s tally to see its matching stretches.'));
    render();
  }));

  const legend = element('p', 'Highlighted games belong to a matching stretch. Cells show opponents; # is the number of games on that date. Overlapping stretches count separately.', 'timeline-legend');
  const grid = element('div', '', 'timeline-grid');
  grid.tabIndex = 0;
  grid.setAttribute('aria-label', 'Scrollable season schedule');
  const details = element('div', '', 'timeline-game-details');
  details.setAttribute('aria-live', 'polite');
  details.append(element('p', 'Select a team’s tally to see its matching stretches.'));
  container.append(legend, grid, details);
  let selectedTeam = null;
  let selectedStretch = null;

  function showGame(game) {
    details.replaceChildren();
    details.append(element('h3', `${teamLabel(game.away)} at ${teamLabel(game.home)} · ${formatDate(game.date)}`));
    details.append(element('p', `${formatTimeDisplay(game.time)} · ${game.field}`));
    if (onEditGame) details.append(button('Preview move or swap', () => onEditGame(game)));
  }

  function showStretches(team, stretches) {
    details.replaceChildren();
    details.append(element('h3', `${teamLabel(team)} · ${stretches.length} ${stretches.length === 1 ? 'stretch' : 'stretches'}`));
    details.append(element('p', 'Select a stretch to highlight its games in the table.'));
    const list = element('ol');
    for (const stretch of stretches) {
      const item = element('li');
      const link = button(`${formatDate(stretch[0].date)} – ${formatDate(stretch.at(-1).date)}`, () => {
        selectedStretch = stretch;
        render();
        grid.querySelector(`[data-date="${stretch[0].date}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 'timeline-link');
      item.append(link, document.createTextNode(' · ' + stretch.map(game => `${formatDate(game.date)} vs ${teamLabel(opponent(game, team))}`).join(' / ')));
      if (onEditGame) {
        for (const game of stretch) {
          const edit = button(`Edit ${formatDate(game.date)}`, () => onEditGame(game));
          edit.setAttribute('aria-label', `Preview move or swap for ${teamLabel(team)} vs ${teamLabel(opponent(game, team))} on ${formatDate(game.date)}`);
          item.append(edit);
        }
      }
      list.append(item);
    }
    details.append(list);
  }

  function render() {
    const stretches = teamGames.map(games => [...new Set([...tightStretches(games, gameCount, dayCount).values()].flat())]);
    const flagged = stretches.map(list => new Set(list.flat()));
    const byDate = new Map();
    for (const game of sortedGames) {
      if (!byDate.has(game.date)) byDate.set(game.date, []);
      byDate.get(game.date).push(game);
    }
    grid.replaceChildren();
    const table = element('table', '', 'timeline-table');
    table.setAttribute('aria-label', 'Season game density by date and team');
    const head = table.createTHead();
    const header = head.insertRow();
    for (const label of ['Date', '#', ...teamGames.map((_, team) => teamLabel(team))]) {
      const cell = element('th', label);
      cell.scope = 'col';
      header.append(cell);
    }
    const tallyRow = head.insertRow();
    tallyRow.append(element('th', `${gameCount} in ${dayCount} days`), element('th', 'Tally'));
    for (const [team, list] of stretches.entries()) {
      const cell = element('th');
      if (list.length) {
        const tally = button(String(list.length), () => {
          selectedTeam = team;
          selectedStretch = null;
          render();
          showStretches(team, list);
        }, 'timeline-tally' + (selectedTeam === team ? ' selected' : ''));
        tally.setAttribute('aria-label', `${teamLabel(team)}: ${list.length} matching stretches; show games`);
        cell.append(tally);
      } else cell.textContent = '0';
      tallyRow.append(cell);
    }
    const body = table.createTBody();
    for (let date = sortedGames[0].date; date <= sortedGames.at(-1).date; date = addDays(date, 1)) {
      const row = body.insertRow();
      row.dataset.date = date;
      const dow = new Date(date + 'T00:00:00').getDay();
      if (dow === 0 || dow === 6) row.classList.add('timeline-weekend');
      if (dow === 1) row.classList.add('timeline-week-start');
      const dateCell = element('th', formatDate(date));
      dateCell.scope = 'row';
      row.append(dateCell);
      const games = byDate.get(date) ?? [];
      row.insertCell().textContent = games.length || '·';
      for (let team = 0; team < numTeams; team++) {
        const cell = row.insertCell();
        for (const game of games.filter(g => g.home === team || g.away === team)) {
          const gameButton = button(teamLabel(opponent(game, team)), () => showGame(game),
            'timeline-match' + (flagged[team].has(game) ? ' timeline-match-tight' : '') +
            (selectedTeam === team && selectedStretch?.includes(game) ? ' selected' : ''));
          gameButton.setAttribute('aria-label', `${teamLabel(team)} vs ${teamLabel(opponent(game, team))}, ${formatDate(date)}${flagged[team].has(game) ? ', matching stretch' : ''}`);
          cell.append(gameButton);
        }
      }
    }
    grid.append(table);
  }

  render();
}
