// @ts-check
/** @typedef {import('./types.js').Slot} Slot */
/** @typedef {import('./types.js').Game & {divisionIndex?: number, divisionName?: string}} CalendarGame */
import { isoWeek, addDays, timeSortKey, formatTimeDisplay } from './utils.js';
/** @param {unknown} value */
export const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => (/** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }))[c]
  );
/** @param {string} date */
export const formatDate = (date) =>
  new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
/** @param {{date: string}[]} slots */
export function calendarWeeks(slots) {
  const dates = slots.map((s) => s.date).sort();
  if (!dates.length) return [];
  const weeks = [];
  for (let week = isoWeek(dates[0]); week <= isoWeek(dates[dates.length - 1]); week = addDays(week, 7))
    weeks.push(week);
  return weeks;
}
/** @param {HTMLElement} container @param {CalendarGame[]} games @param {Slot[]} slots @param {{numTeams?: number, divisionIndex?: number, showOpenSlots?: boolean}} [options] */
export function renderCalendar(
  container,
  games,
  slots,
  { numTeams, divisionIndex = 0, showOpenSlots = false } = {}
) {
  const root = document.createElement('div');
  root.className = 'schedule-ui';
  container.append(root);
  const weeks = calendarWeeks(slots.length ? slots : games);
  if (!weeks.length) {
    root.textContent = 'No available field times.';
    return;
  }
  let index = 0,
    team = '';
  const controls = document.createElement('div');
  controls.className = 'calendar-controls';
  const prev = document.createElement('button');
  prev.textContent = '←';
  prev.setAttribute('aria-label', 'Previous week');
  const next = document.createElement('button');
  next.textContent = '→';
  next.setAttribute('aria-label', 'Next week');
  const jump = document.createElement('select');
  jump.setAttribute('aria-label', 'Jump to week');
  weeks.forEach((w, i) =>
    jump.add(new Option(`${formatDate(w)} – ${formatDate(addDays(w, 6))}`, String(i)))
  );
  const nav = document.createElement('div');
  nav.className = 'week-controls';
  nav.append(prev, jump, next);
  controls.append(nav);
  if (numTeams) {
    const label = document.createElement('label');
    label.textContent = 'Highlight team ';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Highlight team');
    select.add(new Option('All teams', ''));
    for (let t = 0; t < numTeams; t++) select.add(new Option(`${t + 1}B`, String(t)));
    select.onchange = () => {
      team = select.value;
      draw();
    };
    label.append(select);
    controls.append(label);
  }
  const board = document.createElement('div');
  board.className = 'field-row';
  root.append(controls, board);
  function draw() {
    prev.disabled = index === 0;
    next.disabled = index === weeks.length - 1;
    jump.value = String(index);
    board.innerHTML =
      '<div class="day-grid">' +
      Array.from({ length: 7 }, (_, offset) => {
        const date = addDays(weeks[index], offset);
        const dayGames = games
          .filter((g) => g.date === date)
          .sort(
            (a, b) => timeSortKey(a.time) - timeSortKey(b.time) || a.field.localeCompare(b.field)
          );
        const occupied = new Set(dayGames.map((g) => g.field + '|' + g.time));
        const openSlots = showOpenSlots
          ? slots.filter((s) => s.date === date && !occupied.has(s.field + '|' + s.time))
          : [];
        const entries = [...dayGames, ...openSlots].sort(
          (a, b) => timeSortKey(a.time) - timeSortKey(b.time) || a.field.localeCompare(b.field)
        );
        return (
          `<div class="day-column"><div class="day-header"><strong>${formatDate(
            date
          )}</strong></div>` +
          entries
            .map((g) =>
              !('home' in g)
                ? `<div class="slot vacant"><span class="slot-time">${formatTimeDisplay(
                    g.time
                  )}</span><small>Open</small></div>`
                : `<div class="slot game${
                    team !== '' && g.home !== Number(team) && g.away !== Number(team)
                      ? ' dimmed'
                      : ''
                  }" style="--division-hue:${
                    ((g.divisionIndex ?? divisionIndex) * 79 + 200) % 360
                  }"><span class="slot-time">${formatTimeDisplay(g.time)}</span>${
                    g.divisionName ? `<strong>${escapeHTML(g.divisionName)}</strong>` : ''
                  }<strong>${g.away + 1}B vs ${g.home + 1}B</strong><small>${escapeHTML(
                    g.field
                  )}</small></div>`
            )
            .join('') +
          (!dayGames.length && !openSlots.length
            ? `<span class="empty-day">${
                slots.some((s) => s.date === date) ? 'No games' : 'No field times'
              }</span>`
            : '') +
          '</div>'
        );
      }).join('') +
      '</div>';
  }
  prev.onclick = () => {
    index--;
    draw();
  };
  next.onclick = () => {
    index++;
    draw();
  };
  jump.onchange = () => {
    index = Number(jump.value);
    draw();
  };
  draw();
}
