// @ts-nocheck -- Results rendering DOM migration is pending.
import { escapeHTML, renderCalendar } from './calendar.js';
import { renderScheduleAudit } from './scheduleAudit.js';
import { renderOpponentTimeline } from './opponentTimeline.js';
import { renderMatchupMatrix } from './matchupMatrix.js';
import { DAYS } from './constants.js';
import { daysBetween, slotBucket, timeSortKey, formatTimeDisplay, isoWeek, addDays, getWeekendGroup } from './utils.js';

let lastCSV = '';
function setLastCSV(csv) { lastCSV = csv; }

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderMultiDivisionResults(divisionResults, allSlots, { reviewState = [], onEditGame } = {}) {
  const container = document.getElementById('results');
  container.innerHTML = '';

  // Results navigation — fields + divisions
  const fieldNames = [...new Set((allSlots || []).map(s => s.field))].sort();
  {
    const toc = document.createElement('nav');
    toc.className = 'results-toc';
    const links = [];
    links.push('<a href="#division-schedules">Division Schedules</a>');
    for (let i = 0; i < divisionResults.length; i++) {
      links.push(`<a href="#division-${i}">${escapeHTML(divisionResults[i].division.name)} Deepdive</a>`);
    }
    if (fieldNames.length > 0) {
      links.push('<a href="#fields">Fields</a>');
    }
    toc.innerHTML = '<span class="toc-label">Jump to:</span>' + links.join('');
    container.appendChild(toc);
  }

  const schedulesSection = document.createElement('section');
  schedulesSection.id = 'division-schedules';
  schedulesSection.className = 'card result-group';
  const schedulesHeading = document.createElement('h2');
  schedulesHeading.textContent = 'Division Schedules';
  const schedulesIntro = document.createElement('div');
  schedulesIntro.className = 'results-section-intro';
  schedulesIntro.appendChild(schedulesHeading);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = '<button class="btn-secondary btn-sm download-csv" onclick="downloadCSV()"><span class="material-symbols-outlined" aria-hidden="true">download</span>Download CSV</button>';
  schedulesIntro.appendChild(actions);
  schedulesSection.appendChild(schedulesIntro);
  for (const dr of divisionResults) {
    renderScheduleTable(schedulesSection, dr.schedule, dr.division.name);
  }
  container.appendChild(schedulesSection);

  for (let i = 0; i < divisionResults.length; i++) {
    const dr = divisionResults[i];
    const section = document.createElement('div');
    section.className = 'division-section card result-group';
    section.id = `division-${i}`;
    const heading = document.createElement('h2');
    heading.textContent = `${dr.division.name} Deepdive`;
    const intro = document.createElement('div');
    intro.className = 'results-section-intro';
    intro.appendChild(heading);
    section.appendChild(intro);

    const { numTeams, leagueSplit } = dr.division;
    const review = reviewState[i] ??= { audit: {}, timeline: {} };
    renderScheduleAudit(section, dr.schedule, numTeams, { viewState: review.audit });
    const timelineCard = document.createElement('section');
    timelineCard.className = 'card';
    renderOpponentTimeline(
      timelineCard, dr.schedule, numTeams,
      onEditGame && (game => onEditGame(i, game)), review.timeline
    );
    section.append(timelineCard);
    renderMatchupMatrix(section, dr.schedule, numTeams, leagueSplit);
    renderDivisionBlock(section, dr.schedule, dr.details, numTeams, leagueSplit, dr.slots);
    const calendarCard=document.createElement('div'); calendarCard.className='card';
    const title=document.createElement('h2'); title.textContent=dr.division.name+' Schedule'; calendarCard.append(title);
    renderCalendar(calendarCard,dr.schedule,allSlots.filter(s=>dr.division.fields.includes(s.field)&&!dr.division.excludedDays.includes(s.dayOfWeek)),{numTeams:dr.division.numTeams,divisionIndex:i});
    section.append(calendarCard);
    container.appendChild(section);
  }

  // Per-field sections with heatmaps
  if (allSlots && allSlots.length > 0) {
    const fields = document.createElement('details');
    fields.id = 'fields';
    fields.className = 'card fields-section';
    fields.open = true;
    const heading = document.createElement('summary');
    heading.className = 'field-schedules-heading';
    heading.textContent = 'Fields';
    fields.appendChild(heading);
    for (const field of fieldNames) {
      const card=document.createElement('section'); card.className='card';
      const title=document.createElement('h2'); title.textContent=field; card.append(title);
      const games=divisionResults.flatMap((r,i)=>r.schedule.filter(g=>g.field===field).map(g=>({...g,divisionName:r.division.name,divisionIndex:i})));
      renderCalendar(card,games,allSlots.filter(s=>s.field===field),{showOpenSlots:true}); fields.append(card);
    }
    container.appendChild(fields);
  }
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
  const fieldControls = document.createElement('div');
  fieldControls.className = 'field-controls';
  fieldControls.appendChild(datePicker);
  const legend = document.createElement('div');
  legend.className = 'field-legend';
  legend.setAttribute('aria-label', 'Field grid legend');
  legend.innerHTML = '<span><i class="field-legend-swatch field-legend-empty" aria-hidden="true"></i>Open field time</span>' +
    '<span><i class="field-legend-swatch field-legend-occupied" aria-hidden="true"></i>Used by another division</span>' +
    '<span><i class="field-legend-swatch field-legend-unavailable" aria-hidden="true">×</i>Field unavailable</span>' +
    '<span><b class="field-legend-weekend">Underlined date</b> Weekend</span>';
  fieldControls.appendChild(legend);
  container.appendChild(fieldControls);
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
      section.className = 'division-section field-section card';
      section.id = `field-${field.replace(/\s+/g, '-')}`;
      const heading = document.createElement('h3');
      heading.textContent = field;
      section.appendChild(heading);

      const available = fieldSlotKeys.get(field) || new Set();
      const gameMap = fieldGameDiv.get(field) || new Map();

      // Utilization stats
      const totalSlots = available.size;
      const usedSlots = [...available].filter(k => gameMap.has(k)).length;

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
        html += `<tr><td class="team-name">${escapeHTML(divName)}</td>`;
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
            const escaped = escapeHTML(details);
            content = `<button type="button" class="field-game-button" aria-label="${escaped}" data-game-details="${escaped}"></button>`;
          }
          html += `<td class="heatmap-cell ${cls}${dateStart ? ' date-start' : ''}"${style}>${content}</td>`;
        }
        html += '</tr>';
      }

      html += '</tbody></table></div>';
      const grid = document.createElement('div');
      grid.innerHTML = html;
      section.appendChild(grid);
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

function renderDivisionBlock(container, schedule, details, numTeams, leagueSplit, slots = []) {
  const teamCounts = Array.from({ length: numTeams }, (_, team) => {
    const games = schedule.filter(g => g.home === team || g.away === team);
    const dates = games.map(g => g.date).sort();
    let btb = 0, shortRest = 0;
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetween(dates[i - 1], dates[i]);
      if (gap === 1) btb++;
      if (gap < 3) shortRest++;
    }
    return { btb, shortRest };
  });
  const range = key => {
    const counts = teamCounts.map(t => t[key]);
    if (!counts.length) return '0';
    const min = Math.min(...counts), max = Math.max(...counts);
    return min === max ? `${min}` : `${min}–${max}`;
  };
  let worstSaturdayShare = null;
  for (let team = 0; team < numTeams; team++) {
    const games = schedule.filter(g => (g.home === team || g.away === team)
      && (g.dayOfWeek === 0 || g.dayOfWeek === 6));
    if (!games.length) continue;
    const share = games.filter(g => g.dayOfWeek === 6).length / games.length;
    if (worstSaturdayShare === null || Math.abs(share - 0.5) > Math.abs(worstSaturdayShare - 0.5)) {
      worstSaturdayShare = share;
    }
  }
  const saturdayPercent = worstSaturdayShare === null ? null : Math.round(100 * worstSaturdayShare);
  // Score cards
  const cards = [
    { label: 'Weekend Sit-outs', value: details.weekendSitouts, min: 0,
      tip: 'Missed weekends beyond unavoidable sit-outs.' },
    { label: 'Weekend Back-to-Back', value: details.weekendDoubleHeaders, min: details.minWeekendDH,
      tip: 'Times a team plays on both Saturday and Sunday.' },
    { label: 'Closely Spaced Opening Games', value: details.earlySeasonDensity, min: 0,
      tip: 'Game pairs 1–2 days apart during the opening week.' },
    { label: 'Back-to-Back Earlier Starts', value: details.weekendBTBTimePenalty, min: 0,
      tip: 'Friday–Saturday or Saturday–Sunday game pairs with an earlier start on the second day.' },
    { label: 'Sat/Sun Balance', value: details.satSunBalance, min: 0,
      good: worstSaturdayShare !== null && worstSaturdayShare >= 0.45 && worstSaturdayShare <= 0.55,
      display: saturdayPercent === null ? 'No weekend games' : `${saturdayPercent}% / ${100 - saturdayPercent}%`,
      note: saturdayPercent === null ? '' : 'Saturday / Sunday · worst-balanced team',
      tip: 'Saturday / Sunday split for the team furthest from 50/50, excluding teams with no weekend games. Green means every team is within 45–55% Saturday.' },
    { label: 'Back-to-Back Balance', value: details.btbBalance, min: 0,
      display: `${range('btb')} back-to-backs`, note: 'per team',
      tip: 'Fewest to most consecutive-day game pairs per team. Green means equal counts.' },
    { label: 'Short-Rest Balance', value: details.shortGapBalance, min: 0,
      display: `${range('shortRest')} short-rest games`, note: 'per team',
      tip: 'Fewest to most game pairs 1–2 days apart per team. Green means equal counts.' },
  ];

  const scoreCard = document.createElement('div');
  scoreCard.className = 'card';
  scoreCard.innerHTML = '<h2>Schedule Quality</h2><div class="score-grid">' + cards.map((c, index) => {
    const isGood = c.good ?? (c.value === 0);
    const cls = isGood ? 'good' : 'ok';
    const minNote = c.min != null && c.min > 0 ? `<div class="min-note">best possible: ${c.min}</div>` : '';
    const tip = c.tip;
    const tipAttr = tip ? ` data-tip="${tip}"` : '';
    const note = c.note ? `<div class="min-note">${c.note}</div>` : '';
    return `<div class="score-card"><div class="score-explanation"${tipAttr} tabindex="0"><div class="label">${c.label}</div><div class="value ${cls}">${c.display ?? c.value}</div>${note}${minNote}</div>${isGood ? '' : `<button type="button" class="score-details-link" data-score-index="${index}">View details</button>`}</div>`;
  }).join('') + '</div>';
  scoreCard.querySelectorAll('.score-details-link').forEach(button => {
    const index = Number(button.dataset.scoreIndex);
    const panel = document.createElement('dialog');
    panel.className = 'score-details-drawer';
    const header = document.createElement('div');
    header.className = 'score-details-header';
    const title = document.createElement('h2');
    title.textContent = cards[index].label;
    const titleId = `score-detail-${Math.random().toString(36).slice(2)}`;
    title.id = titleId;
    panel.setAttribute('aria-labelledby', titleId);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-secondary';
    close.textContent = 'Close ×';
    close.addEventListener('click', () => panel.close());
    header.append(title, close);
    const explanation = document.createElement('p');
    explanation.textContent = cards[index].tip;
    panel.append(header, explanation);
    button.addEventListener('click', () => panel.showModal());
    panel.addEventListener('close', () => button.focus({ preventScroll: true }));
    panel.addEventListener('click', event => {
      const rect = panel.getBoundingClientRect();
      if (event.target === panel && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) panel.close();
    });
    scoreCard.appendChild(panel);
    const table = document.createElement('table');
    const heading = document.createElement('caption');
    heading.textContent = index === 0 ? 'Weekends without games, before unavoidable sit-outs are forgiven' : 'Games by team';
    table.appendChild(heading);
    const detailDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    const detailGame = game => `${detailDate(game.date)} ${game.time.toUpperCase().replace(/:00(?=[AP]M$)/, '')}`;
    const seasonStart = schedule.map(g => g.date).sort()[0];
    const teamOrder = Array.from({ length: numTeams }, (_, team) => team);
    if (index === 4) {
      const deviation = team => {
        const games = schedule.filter(g => (g.home === team || g.away === team)
          && (g.dayOfWeek === 0 || g.dayOfWeek === 6));
        return games.length ? Math.abs(games.filter(g => g.dayOfWeek === 6).length / games.length - 0.5) : -1;
      };
      const deviations = teamOrder.map(deviation);
      teamOrder.sort((a, b) => deviations[b] - deviations[a] || a - b);
      heading.textContent = 'Teams ordered by distance from 50% Saturday, most uneven first';
    }
    for (const team of teamOrder) {
      const games = schedule.filter(g => g.home === team || g.away === team)
        .sort((a, b) => a.date.localeCompare(b.date));
      let entries;
      if (index === 0) {
        const weekends = [...new Set(slots.filter(s => s.dayOfWeek === 0 || s.dayOfWeek === 6).map(s => s.weekendGroup))].sort();
        const played = new Set(games.filter(g => g.dayOfWeek === 0 || g.dayOfWeek === 6).map(g => getWeekendGroup(g.date)));
        entries = weekends.filter(w => !played.has(w)).map(w => `${detailDate(w)} – ${detailDate(addDays(w, 1))}`);
      } else if (index === 4) {
        const saturday = games.filter(g => g.dayOfWeek === 6).length;
        const sunday = games.filter(g => g.dayOfWeek === 0).length;
        const total = saturday + sunday;
        const percent = total ? Math.round(100 * saturday / total) : null;
        entries = [percent === null ? 'No weekend games'
          : `${percent}% Saturday / ${100 - percent}% Sunday`];
      } else if ([3, 5, 6].includes(index)) {
        entries = [];
        for (let i = 1; i < games.length; i++) {
          const prev = games[i - 1], game = games[i];
          const gap = daysBetween(prev.date, game.date);
          const matches = index === 6 ? gap < 3 : gap === 1;
          const earlierWeekendStart = (prev.dayOfWeek === 5 && game.dayOfWeek === 6 || prev.dayOfWeek === 6 && game.dayOfWeek === 0)
            && timeSortKey(game.time) < timeSortKey(prev.time);
          if (matches && (index !== 3 || earlierWeekendStart)) {
            entries.push(`${detailGame(prev)} → ${detailGame(game)}`);
          }
        }
      } else if (index === 2) {
        entries = [];
        for (let i = 1; i < games.length; i++) {
          if (daysBetween(seasonStart, games[i].date) < 7 && daysBetween(games[i - 1].date, games[i].date) <= 2) {
            entries.push(`${detailGame(games[i - 1])} → ${detailGame(games[i])}`);
          }
        }
      } else {
        entries = games.filter(g => g.dayOfWeek === 0 || g.dayOfWeek === 6)
          .map(g => detailGame(g));
      }
      const row = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = `${team + 1}B`;
      const cell = document.createElement('td');
      if (!entries.length) cell.textContent = 'None';
      for (const entry of entries) {
        const line = document.createElement('div');
        line.textContent = entry;
        cell.appendChild(line);
      }
      row.append(name, cell);
      table.appendChild(row);
    }
    panel.appendChild(table);
  });
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
  for (const [i, f] of allFields.entries()) html += `<th class="${i === 0 ? 'group-start' : ''}" scope="col">${escapeHTML(f)}</th>`;
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


}

function renderScheduleTable(container, schedule, divisionName) {
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
    shtml += `<tr><td>${day}</td><td>${dateDisplay}</td><td>${formatTimeDisplay(g.time)}</td><td>${escapeHTML(g.field)}</td><td>${g.away + 1}B</td><td>${g.home + 1}B</td></tr>`;
  }
  shtml += '</tbody></table>';

  const schedCard = document.createElement('details');
  schedCard.className = 'card schedule-details';
  const summary = document.createElement('summary');
  summary.textContent = divisionName;
  schedCard.appendChild(summary);
  const tableContainer = document.createElement('div');
  tableContainer.className = 'schedule-table-scroll';
  tableContainer.innerHTML = shtml;
  schedCard.appendChild(tableContainer);
  container.appendChild(schedCard);

}

function renderHeatmapInto(container, schedule, numTeams) {
  const gameDates = schedule.map(g => g.date).sort();
  if (!gameDates.length) {
    container.textContent = 'No games scheduled.';
    return;
  }
  const firstWeek = isoWeek(gameDates[0]);
  const lastWeek = isoWeek(gameDates[gameDates.length - 1]);
  let selectedWeek = firstWeek;
  const navigation = document.createElement('div');
  navigation.className = 'field-week-navigation field-week-navigation-local';
  navigation.setAttribute('aria-label', 'Team schedule week');
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'btn-secondary btn-sm';
  previous.textContent = 'Previous week';
  const label = document.createElement('strong');
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn-secondary btn-sm';
  next.textContent = 'Next week';
  navigation.append(previous, label, next);
  const grid = document.createElement('div');
  grid.style.overflowX = 'auto';
  container.append(navigation, grid);

  const teamDates = [];
  for (let t = 0; t < numTeams; t++) {
    const s = new Set();
    for (const g of schedule) {
      if (g.home === t || g.away === t) s.add(g.date);
    }
    teamDates.push(s);
  }

  function renderWeek() {
    const end = addDays(selectedWeek, 6);
    const formatDate = date => new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric'
    });
    label.textContent = `${formatDate(selectedWeek)} – ${formatDate(end)}`;
    previous.disabled = selectedWeek === firstWeek;
    next.disabled = selectedWeek === lastWeek;
    const dates = Array.from({ length: 7 }, (_, i) => addDays(selectedWeek, i));
    let html = '<table class="heatmap-table team-heatmap"><thead><tr><th></th>';
    for (const date of dates) {
      const d = new Date(date + 'T00:00:00');
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const label = `${DAYS[dow].slice(0, 3)} ${d.getMonth() + 1}/${d.getDate()}`;
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
    grid.innerHTML = html;
  }
  previous.addEventListener('click', () => { selectedWeek = addDays(selectedWeek, -7); renderWeek(); });
  next.addEventListener('click', () => { selectedWeek = addDays(selectedWeek, 7); renderWeek(); });
  renderWeek();
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
