// @ts-nocheck -- Pending migration to checked JSDoc.
import { formatTimeDisplay, timeSortKey } from './utils.js';

const teamLabel = team => `${team + 1}B`;
const pairKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
const groupName = (a, b, leagueSplit) => {
  if (!leagueSplit) return 'All pairings';
  return a % 2 === b % 2 ? 'Within-league pairings' : 'Cross-league pairings';
};

export function summarizeMatchups(schedule, numTeams, leagueSplit) {
  const pairs = new Map();
  const groups = new Map();
  for (let a = 0; a < numTeams; a++) {
    for (let b = a + 1; b < numTeams; b++) {
      const name = groupName(a, b, leagueSplit);
      if (!groups.has(name)) groups.set(name, { size: 0, games: 0 });
      const group = groups.get(name);
      group.size++;
      pairs.set(pairKey(a, b), { group, games: [] });
    }
  }
  for (const game of schedule) {
    const pair = pairs.get(pairKey(game.home, game.away));
    if (pair) {
      pair.games.push(game);
      pair.group.games++;
    }
  }
  for (const group of groups.values()) {
    const average = group.games / group.size;
    group.low = Math.floor(average);
    group.high = Math.ceil(average);
  }
  return { pairs, groups };
}

export function renderMatchupMatrix(container, schedule, numTeams, leagueSplit) {
  const { pairs, groups } = summarizeMatchups(schedule, numTeams, leagueSplit);
  const card = document.createElement('section');
  card.className = 'card matchup-matrix';
  const heading = document.createElement('h2');
  heading.textContent = 'Head-to-head matchups';
  const note = document.createElement('p');
  note.textContent = 'Expected ranges round the average games per pair down and up within each group. ↓ Below range · ↑ Above range. Select a count to see the games.';
  card.append(heading, note);

  const ranges = document.createElement('ul');
  for (const [name, { low, high }] of groups) {
    const item = document.createElement('li');
    item.textContent = `${name} · ${low === high ? low : `${low}–${high}`} games per pair`;
    ranges.append(item);
  }
  card.append(ranges);

  const scroll = document.createElement('div');
  scroll.className = 'team-summary-scroll';
  const table = document.createElement('table');
  table.className = 'team-summary-table';
  table.setAttribute('aria-label', heading.textContent);
  const header = table.createTHead().insertRow();
  const corner = document.createElement('th');
  corner.scope = 'col';
  header.append(corner);
  corner.textContent = 'Team';
  const teamHeader = (row, team, scope) => {
    const cell = document.createElement('th');
    cell.scope = scope;
    cell.textContent = teamLabel(team);
    row.append(cell);
  };
  for (let team = 0; team < numTeams; team++) teamHeader(header, team, 'col');

  const details = document.createElement('div');
  details.className = 'matchup-matrix-details';
  details.hidden = true;
  details.setAttribute('aria-live', 'polite');
  const body = table.createTBody();
  let selected;
  for (let a = 0; a < numTeams; a++) {
    const row = body.insertRow();
    teamHeader(row, a, 'row');
    for (let b = 0; b < numTeams; b++) {
      const cell = row.insertCell();
      if (a === b) {
        cell.textContent = '—';
        continue;
      }
      const { group, games } = pairs.get(pairKey(a, b));
      const count = games.length;
      const status = count < group.low ? 'Below range' : count > group.high ? 'Above range' : '';
      const label = `${teamLabel(Math.min(a, b))} vs ${teamLabel(Math.max(a, b))}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-link matchup-count';
      button.textContent = status ? `${count} ${count < group.low ? '↓' : '↑'}` : String(count);
      if (status) button.dataset.status = count < group.low ? 'below' : 'above';
      button.setAttribute('aria-label', `${label}, ${count} games${status ? `, ${status.toLowerCase()}` : ''}`);
      button.setAttribute('aria-pressed', 'false');
      button.title = status || 'View meetings';
      button.addEventListener('click', () => {
        selected?.setAttribute('aria-pressed', 'false');
        selected = button;
        button.setAttribute('aria-pressed', 'true');
        const title = document.createElement('h3');
        title.textContent = `${label} · ${count} ${count === 1 ? 'game' : 'games'}`;
        details.replaceChildren(title);
        if (!count) {
          const empty = document.createElement('p');
          empty.textContent = 'No meetings scheduled.';
          details.append(empty);
        } else {
          const list = document.createElement('ul');
          const sorted = [...games].sort((x, y) =>
            x.date.localeCompare(y.date) || timeSortKey(x.time) - timeSortKey(y.time)
          );
          for (const game of sorted) {
            const item = document.createElement('li');
            item.textContent = `${game.date} · ${formatTimeDisplay(game.time)} · ${game.field} · ${teamLabel(game.away)} at ${teamLabel(game.home)}`;
            list.append(item);
          }
          details.append(list);
        }
        details.hidden = false;
      });
      cell.append(button);
    }
  }
  scroll.append(table);
  card.append(scroll, details);
  container.append(card);
}
