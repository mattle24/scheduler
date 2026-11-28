// @ts-nocheck -- Pending migration to checked JSDoc.
import {
  scoreEditorGames,
  teamMetricNames,
  moveGames,
  moveReason as legalReason,
} from './scheduleModel.js';
import { calendarWeeks } from './calendar.js';

export function mountEditor(session, onChange) {
  const root = document.getElementById('editSchedule');
  root.innerHTML = `<h2>Move a game. See the tradeoffs.</h2>    <main class="workspace">
      <div class="main-column">
        <div class="schedule-card">
        <h2 class="workspace-title" id="workspaceTitle">Explore move and swap options</h2>
        <div class="view-selection-card">
        <div class="view-toggle" role="group" aria-label="Schedule view">
          <button type="button" id="scheduleView" aria-pressed="true">View as schedule</button><button type="button" id="tableView" aria-pressed="false">View as table</button>
        </div>
        <div id="selectionBar" class="selection-bar" hidden></div>
        </div>
        <section class="board-panel" aria-labelledby="workspaceTitle">
          <div class="section-heading">

            <div class="week-controls"><button type="button" id="previousWeek" aria-label="Previous week">←</button><label class="week-jump">Jump to week <select id="weekJump" aria-label="Jump to week"></select></label><button type="button" id="nextWeek" aria-label="Next week">→</button></div>
          </div>
          <p class="section-help">Select a game, then select an open time to move it or another game to swap, including one in another division. Both games must be eligible for their new slots. Applying a change updates Results and CSV. Refreshing, generating, or importing a backup starts a fresh undo history. Use Clear selection when you want to choose a different game. Hover over a slot for its action or a blocked reason.</p>
          <div class="legend"><span><i class="legend-game"></i> Scheduled game</span><span><i class="legend-source"></i> Selected game</span><span><i class="legend-open"></i> Legal move</span><span><i class="legend-blocked"></i> Blocked</span></div>
          <div id="fieldBoard" class="field-board"></div>
        </section>

        <section class="options-panel" aria-labelledby="workspaceTitle" hidden>
          <div class="section-heading"><span id="optionCount" class="option-count"></span></div>
          <div class="filter-row"><label>Date <select id="dateFilter"></select></label><label>Field <select id="fieldFilter"></select></label><label>Order <select id="sortFilter"><option value="score">Best score first</option><option value="date">Date and time</option></select></label></div>
          <div id="optionList" class="option-list"></div>
        </section>
        </div>
      </div>

      <div class="preview-column">
      <div class="undo-card"><button type="button" id="undoButton">Undo last change</button><button type="button" id="undoAllButton">Undo all edits</button></div>
      <aside class="inspector" aria-labelledby="inspectorTitle">
        <div class="inspector-top"><p class="eyebrow">Move preview</p><h2 id="inspectorTitle">What changes?</h2></div>
        <div id="inspectorBody"></div>
      </aside>
      </div>
    </main>`;
  const slots = session.allSlots;
  const fields = [...new Set(slots.map((s) => s.field))].sort();
  const weeks = calendarWeeks(slots);
  const divisions = Object.fromEntries(session.results.map((r, i) => [String(i), r.division]));
  let games = session.results.flatMap((r, i) =>
    r.schedule.map((g, j) => ({
      ...g,
      id: `${i}:${j}`,
      division: String(i),
      home: g.home + 1,
      away: g.away + 1,
    }))
  );
  let selectedGameId = null,
    targetKey = null,
    weekIndex = 0,
    notice = '',
    currentScore;
  let optionStates = new Map(),
    operationNames = {};
  const history = [];
  const scoreSchedule = (games) => scoreEditorGames(games, session.results, session.baseWeights);
  const moveSchedule = (game, slot) => moveGames(games, game, slot);
  const moveReason = (game, slot) => legalReason(games, game, slot, divisions);
  function dayNumber(date) {
    return Date.parse(`${date}T00:00:00Z`) / 86400000;
  }
  function addDays(date, count) {
    return new Date((dayNumber(date) + count) * 86400000).toISOString().slice(0, 10);
  }
  function dayOfWeek(date) {
    return new Date(`${date}T00:00:00Z`).getUTCDay();
  }
  function weekStart(date) {
    return addDays(date, -(dayOfWeek(date) + 6) % 7);
  }
  function weekendKey(date) {
    return [0, 6].includes(dayOfWeek(date)) ? addDays(date, dayOfWeek(date) === 0 ? -1 : 0) : null;
  }
  function formatDate(date, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', options);
  }
  function timeNumber(time) {
    const [, hours, minutes, period] = time.match(/^(\d+):(\d+)(am|pm)$/);
    return ((Number(hours) % 12) + (period === 'pm' ? 12 : 0)) * 60 + Number(minutes);
  }
  function formatTime(time) {
    return time.replace(':00', '').replace(/(am|pm)$/, (_, period) => period.toUpperCase());
  }
  function slotKey(item) {
    return `${item.date}|${item.field}|${item.time}`;
  }
  function teamKey(division, team) {
    return `${division}|${team}`;
  }
  function gameLabel(game) {
    return `${divisions[game.division].name} · ${game.away}B vs ${game.home}B`;
  }
  function signed(value) {
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
  }
  function deltaLabel(value) {
    if (Math.abs(value) < 0.05) return 'No score change';
    return value < 0 ? `−${Math.abs(value).toFixed(1)} better` : `+${value.toFixed(1)} worse`;
  }
  function escapeHTML(value) {
    return String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])
    );
  }

  function selectedGame() {
    return games.find((game) => game.id === selectedGameId);
  }
  function assessOptions() {
    optionStates = new Map();
    currentScore = scoreSchedule(games);
    operationNames = currentScore.metricNames;
    const game = selectedGame();
    if (!game) return;
    for (const slot of slots) {
      const reason = moveReason(game, slot);
      if (reason) optionStates.set(slotKey(slot), { reason });
      else {
        const score = scoreEditorGames(
          moveSchedule(game, slot),
          session.results,
          session.baseWeights,
          false
        );
        optionStates.set(slotKey(slot), { delta: score.total - currentScore.total });
      }
    }
  }

  function renderBoard() {
    root.querySelector('#previousWeek').disabled = weekIndex === 0;
    root.querySelector('#nextWeek').disabled = weekIndex === weeks.length - 1;
    root.querySelector('#weekJump').value = String(weekIndex);
    const selected = selectedGame();
    const selectionBar = root.querySelector('#selectionBar');
    selectionBar.hidden = !selected;
    selectionBar.innerHTML = selected
      ? `<div><span>Selected game</span><strong>${escapeHTML(
          gameLabel(selected)
        )}</strong><small>${formatDate(selected.date)} · ${escapeHTML(
          selected.field
        )} · ${formatTime(
          selected.time
        )}</small></div><button type="button" id="clearSelection">Clear selection</button>`
      : '';
    let html = '';
    for (const field of fields) {
      html += `<div class="field-row"><div class="field-row-heading"><span class="field-icon">◇</span><div><strong>${escapeHTML(
        field
      )}</strong><small>${
        games.filter((game) => game.field === field).length
      } scheduled games</small></div></div><div class="day-grid">`;
      for (let offset = 0; offset < 7; offset++) {
        const date = addDays(weeks[weekIndex], offset);
        const daySlots = slots.filter((slot) => slot.field === field && slot.date === date);
        html += `<div class="day-column${
          daySlots.length ? '' : ' no-slots'
        }"><div class="day-header"><strong>${formatDate(date, {
          weekday: 'short',
        })}</strong><span>${formatDate(date, { month: 'short', day: 'numeric' })}</span></div>`;
        if (!daySlots.length) html += '<span class="empty-day">No field times</span>';
        for (const slot of daySlots) {
          const key = slotKey(slot);
          const occupant = games.find((game) => slotKey(game) === key);
          const option = optionStates.get(key);
          if (occupant) {
            const isSource = occupant.id === selectedGameId;
            const action = isSource
              ? 'Click to unselect this game'
              : selected
              ? option?.reason
                ? `Cannot swap: ${option.reason}`
                : 'Click to preview a swap with this game'
              : 'Click to select this game';
            html += `<button type="button" style="--division-hue:${
              (Number(occupant.division) * 79 + 200) % 360
            }" class="slot game division-${occupant.division}${isSource ? ' source' : ''}${
              selected && !isSource && option?.reason ? ' blocked-game' : ''
            }${selected && !isSource && !option?.reason ? ' swap-target' : ''}${
              key === targetKey ? ' chosen' : ''
            }" data-game-id="${occupant.id}" title="${escapeHTML(action)}" aria-label="${escapeHTML(
              action
            )}: ${escapeHTML(gameLabel(occupant))} at ${formatTime(
              slot.time
            )}"><span class="slot-time">${formatTime(slot.time)}</span><strong>${escapeHTML(
              divisions[occupant.division].name
            )}</strong><small>${occupant.away}B vs ${occupant.home}B</small>${
              selected && !isSource
                ? `<small>${
                    option?.reason
                      ? escapeHTML(option.reason)
                      : 'Swap · ' + deltaLabel(option.delta)
                  }</small>`
                : ''
            }</button>`;
          } else if (selected && option && !option.reason) {
            html += `<button type="button" class="slot target ${
              option.delta < -0.05 ? 'better' : option.delta > 0.05 ? 'worse' : 'even'
            }${key === targetKey ? ' chosen' : ''}" data-slot-key="${escapeHTML(
              key
            )}" title="Click to preview a move to this open time" aria-label="Preview ${escapeHTML(
              field
            )}, ${formatDate(date)}, ${formatTime(slot.time)}: ${deltaLabel(
              option.delta
            )}"><span class="slot-time">${formatTime(slot.time)}</span><strong>${deltaLabel(
              option.delta
            )}</strong></button>`;
          } else {
            const reason = option?.reason || 'Open';
            html += `<div class="slot ${selected ? 'blocked' : 'vacant'}" title="${escapeHTML(
              reason
            )}"><span class="slot-time">${formatTime(slot.time)}</span><small>${escapeHTML(
              reason
            )}</small></div>`;
          }
        }
        html += '</div>';
      }
      html += '</div></div>';
    }
    root.querySelector('#fieldBoard').innerHTML = html;
  }

  function renderOptions() {
    const date = root.querySelector('#dateFilter').value;
    const field = root.querySelector('#fieldFilter').value;
    const order = root.querySelector('#sortFilter').value;
    if (!selectedGame()) {
      const available = games
        .filter((game) => (!date || game.date === date) && (!field || game.field === field))
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            timeNumber(a.time) - timeNumber(b.time) ||
            a.field.localeCompare(b.field)
        );
      root.querySelector('#optionCount').textContent = `${available.length} scheduled games`;
      root.querySelector('#optionList').innerHTML = available.length
        ? available
            .map(
              (game) =>
                `<button type="button" class="option-row" data-game-id="${
                  game.id
                }" title="Click to select this game"><span class="option-date">${formatDate(
                  game.date,
                  { weekday: 'short', month: 'short', day: 'numeric' }
                )}</span><span>${escapeHTML(game.field)} · ${formatTime(
                  game.time
                )}</span><strong>${escapeHTML(gameLabel(game))}</strong></button>`
            )
            .join('')
        : '<p class="no-options">No games match these filters.</p>';
      return;
    }
    const legal = slots
      .filter((slot) => optionStates.has(slotKey(slot)) && !optionStates.get(slotKey(slot)).reason)
      .filter((slot) => (!date || slot.date === date) && (!field || slot.field === field));
    legal.sort((a, b) =>
      order === 'score'
        ? optionStates.get(slotKey(a)).delta - optionStates.get(slotKey(b)).delta ||
          a.date.localeCompare(b.date) ||
          timeNumber(a.time) - timeNumber(b.time)
        : a.date.localeCompare(b.date) ||
          timeNumber(a.time) - timeNumber(b.time) ||
          a.field.localeCompare(b.field)
    );
    root.querySelector('#optionCount').textContent = `${legal.length} legal ${
      legal.length === 1 ? 'option' : 'options'
    }`;
    const list = root.querySelector('#optionList');
    list.innerHTML = legal.length
      ? legal
          .map((slot) => {
            const option = optionStates.get(slotKey(slot));
            const delta = option.delta;
            return `<button type="button" class="option-row${
              slotKey(slot) === targetKey ? ' active' : ''
            }" data-slot-key="${escapeHTML(slotKey(slot))}"><span class="option-date">${formatDate(
              slot.date,
              { weekday: 'short', month: 'short', day: 'numeric' }
            )}</span><span>${escapeHTML(slot.field)} · ${formatTime(slot.time)}${
              games.some((game) => slotKey(game) === slotKey(slot)) ? ' · Swap' : ' · Move'
            }</span><strong class="${
              delta < -0.05 ? 'favorable' : delta > 0.05 ? 'costly' : 'neutral'
            }">${deltaLabel(delta)}</strong></button>`;
          })
          .join('')
      : '<p class="no-options">No legal options match these filters.</p>';
  }

  function metricChanges(before, after, labels, beforeFacts = {}, afterFacts = {}) {
    return Object.keys(labels)
      .map((key) => ({
        key,
        label: labels[key],
        before: before[key],
        after: after[key],
        beforeFact: beforeFacts[key],
        afterFact: afterFacts[key],
        delta: after[key] - before[key],
      }))
      .filter((change) => Math.abs(change.delta) >= 0.05)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }
  function changeRows(changes, emptyMessage) {
    if (!changes.length) return `<p class="no-change">${emptyMessage}</p>`;
    return `<ul class="change-list">${changes
      .map(
        (change) =>
          `<li><span>${escapeHTML(change.label)}</span><strong class="${
            change.delta < 0 ? 'favorable' : 'costly'
          }">${signed(change.delta)}</strong>${
            change.beforeFact
              ? `<small>${escapeHTML(change.beforeFact)} → ${escapeHTML(change.afterFact)}</small>`
              : ''
          }<small>${change.before.toFixed(1)} → ${change.after.toFixed(
            1
          )} penalty points</small></li>`
      )
      .join('')}</ul>`;
  }

  function renderInspector() {
    const body = root.querySelector('#inspectorBody');
    const game = selectedGame();
    root.querySelector('#undoButton').disabled = history.length === 0;
    root.querySelector('#undoAllButton').disabled = history.length === 0;
    if (!game) {
      body.innerHTML =
        '<p class="empty-inspector">Select a game in the field schedule to begin.</p>';
      return;
    }
    const slot = slots.find((item) => slotKey(item) === targetKey);
    const option = slot && optionStates.get(targetKey);
    const swapGame =
      slot && games.find((item) => item.id !== game.id && slotKey(item) === slotKey(slot));
    let html = notice ? `<div class="notice" role="status">${escapeHTML(notice)}</div>` : '';
    html += `<div class="move-route"><div><span>Current game</span><strong>${escapeHTML(
      gameLabel(game)
    )}</strong><small>${formatDate(game.date, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })} · ${escapeHTML(game.field)} · ${formatTime(
      game.time
    )}</small></div><span class="route-arrow">↓</span><div><span>${
      swapGame ? 'Swap with' : 'Proposed time'
    }</span><strong>${
      slot && option && !option.reason
        ? `${formatDate(slot.date, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })} · ${escapeHTML(slot.field)}`
        : 'Choose an open time'
    }</strong><small>${
      slot && option && !option.reason
        ? `${formatTime(slot.time)}${swapGame ? ' · ' + escapeHTML(gameLabel(swapGame)) : ''}`
        : 'Use the field grid or the full options list.'
    }</small></div></div>`;
    if (!slot || !option || option.reason) {
      html +=
        '<p class="empty-inspector">Select a highlighted open time to see how both teams and field operations change.</p>';
      body.innerHTML = html;
      return;
    }
    const after = scoreSchedule(moveSchedule(game, slot));
    html += `<div class="total-impact"><span>Whole schedule</span><strong class="${
      option.delta < -0.05 ? 'favorable' : option.delta > 0.05 ? 'costly' : 'neutral'
    }">${deltaLabel(option.delta)}</strong><small>${currentScore.total.toFixed(
      1
    )} → ${after.total.toFixed(1)} penalty points</small></div>`;
    html += `<button type="button" id="applyMove" class="apply-button">${
      swapGame ? 'Apply this swap' : 'Apply this move'
    }</button>`;
    html += '<h3 class="impact-heading">Teams affected</h3>';
    const affected = new Map();
    for (const moved of [game, swapGame].filter(Boolean))
      for (const team of [moved.away, moved.home])
        affected.set(teamKey(moved.division, team), { division: moved.division, team });
    // Moving the season's first game can change early-season terms for teams
    // beyond the two matchups. Include every team whose contribution changes.
    for (const key of Object.keys(currentScore.teams)) {
      if (Math.abs(currentScore.teams[key].total - after.teams[key].total) > 0.00001) {
        const [division, team] = key.split('|');
        affected.set(key, { division, team: Number(team) });
      }
    }
    for (const [key, { division, team }] of affected) {
      const beforeTeam = currentScore.teams[key];
      const afterTeam = after.teams[key];
      const delta = afterTeam.total - beforeTeam.total;
      const changes = metricChanges(
        beforeTeam.metrics,
        afterTeam.metrics,
        teamMetricNames,
        beforeTeam.facts,
        afterTeam.facts
      );
      const verdict =
        delta < -0.05
          ? `Advantaged ${signed(delta)}`
          : delta > 0.05
          ? `Disadvantaged ${signed(delta)}`
          : 'No score change';
      html += `<div class="impact-card"><div class="impact-card-heading"><strong>${escapeHTML(
        divisions[division].name
      )} ${team}B</strong><span class="${
        delta < -0.05 ? 'favorable' : delta > 0.05 ? 'costly' : 'neutral'
      }">${verdict}</span></div>${changeRows(
        changes,
        'No team penalty changes for this move.'
      )}</div>`;
    }
    const operations = metricChanges(
      currentScore.operations.metrics,
      after.operations.metrics,
      operationNames
    );
    const operationDelta = after.operations.total - currentScore.operations.total;
    html += `<h3 class="impact-heading">Field operations and collective penalties <span class="${
      operationDelta < -0.05 ? 'favorable' : operationDelta > 0.05 ? 'costly' : 'neutral'
    }">${deltaLabel(operationDelta)}</span></h3><div class="impact-card">${changeRows(
      operations,
      'No non-team penalty changes for this move.'
    )}</div>`;
    body.innerHTML = html;
  }

  function render(changed = false) {
    if (changed || !currentScore) assessOptions();
    renderBoard();
    renderOptions();
    renderInspector();
  }
  function selectTarget(key) {
    const option = optionStates.get(key);
    if (!option || option.reason) return;
    targetKey = key;
    weekIndex = Math.max(
      0,
      Math.min(
        weeks.length - 1,
        Math.floor((dayNumber(key.slice(0, 10)) - dayNumber(weeks[0])) / 7)
      )
    );
    notice = '';
    render();
  }

  for (const [id, showSchedule] of [
    ['scheduleView', true],
    ['tableView', false],
  ]) {
    root.querySelector('#' + id).addEventListener('click', () => {
      root.querySelector('.board-panel').hidden = !showSchedule;
      root.querySelector('.options-panel').hidden = showSchedule;
      root.querySelector('#scheduleView').setAttribute('aria-pressed', String(showSchedule));
      root.querySelector('#tableView').setAttribute('aria-pressed', String(!showSchedule));
    });
  }

  const weekJump = root.querySelector('#weekJump');
  weekJump.innerHTML = weeks
    .map(
      (week, index) =>
        `<option value="${index}">${formatDate(week, {
          month: 'short',
          day: 'numeric',
        })} – ${formatDate(addDays(week, 6), {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}</option>`
    )
    .join('');
  weekJump.addEventListener('change', () => {
    weekIndex = Number(weekJump.value);
    renderBoard();
  });

  const dateFilter = root.querySelector('#dateFilter');
  dateFilter.innerHTML =
    '<option value="">All dates</option>' +
    [...new Set(slots.map((slot) => slot.date))]
      .map(
        (date) =>
          `<option value="${date}">${formatDate(date, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })}</option>`
      )
      .join('');
  root.querySelector('#fieldFilter').innerHTML =
    '<option value="">All fields</option>' +
    fields.map((field) => `<option>${escapeHTML(field)}</option>`).join('');
  for (const id of ['dateFilter', 'fieldFilter', 'sortFilter'])
    root.querySelector('#' + id).addEventListener('change', renderOptions);
  root.querySelector('#previousWeek').addEventListener('click', () => {
    weekIndex--;
    renderBoard();
  });
  root.querySelector('#nextWeek').addEventListener('click', () => {
    weekIndex++;
    renderBoard();
  });
  root.querySelector('#selectionBar').addEventListener('click', (event) => {
    if (event.target.id !== 'clearSelection') return;
    selectedGameId = null;
    targetKey = null;
    notice = '';
    render(true);
  });
  root.querySelector('#fieldBoard').addEventListener('click', (event) => {
    const gameButton = event.target.closest('[data-game-id]');
    if (gameButton) {
      const clickedId = gameButton.dataset.gameId;
      if (selectedGameId && clickedId !== selectedGameId) {
        const clicked = games.find((game) => game.id === clickedId);
        selectTarget(slotKey(clicked));
        return;
      }
      selectedGameId = clickedId === selectedGameId ? null : clickedId;
      targetKey = null;
      notice = '';
      render(true);
      return;
    }
    const slotButton = event.target.closest('[data-slot-key]');
    if (slotButton) selectTarget(slotButton.dataset.slotKey);
  });
  root.querySelector('#optionList').addEventListener('click', (event) => {
    const gameButton = event.target.closest('[data-game-id]');
    if (gameButton) {
      selectedGameId = gameButton.dataset.gameId;
      targetKey = null;
      notice = '';
      render(true);
      return;
    }
    const button = event.target.closest('[data-slot-key]');
    if (button) selectTarget(button.dataset.slotKey);
  });
  root.querySelector('#inspectorBody').addEventListener('click', (event) => {
    if (event.target.id !== 'applyMove' || !targetKey || optionStates.get(targetKey)?.reason)
      return;
    const game = selectedGame();
    const slot = slots.find((item) => slotKey(item) === targetKey);
    if (!game || !slot || moveReason(game, slot)) return;
    const occupant = games.find((item) => item.id !== game.id && slotKey(item) === slotKey(slot));
    history.push([game, occupant].filter(Boolean).map((item) => ({ ...item })));
    games = moveSchedule(game, slot);
    onChange(games);
    selectedGameId = null;
    targetKey = null;
    notice = `${gameLabel(game)} ${
      occupant ? 'swapped with ' + gameLabel(occupant) + ' at' : 'moved to'
    } ${slot.field} on ${formatDate(slot.date)} at ${formatTime(slot.time)}.`;
    render(true);
  });
  root.querySelector('#undoButton').addEventListener('click', () => {
    const previous = history.pop();
    if (!previous) return;
    games = games.map((game) => previous.find((item) => item.id === game.id) || game);
    onChange(games);
    selectedGameId = previous[0].id;
    targetKey = null;
    weekIndex = Math.floor((dayNumber(previous[0].date) - dayNumber(weeks[0])) / 7);
    notice = 'Last move undone.';
    render(true);
  });

  root.querySelector('#undoAllButton').addEventListener('click', () => {
    while (history.length) {
      const previous = history.pop();
      games = games.map((g) => previous.find((p) => p.id === g.id) || g);
    }
    targetKey = null;
    selectedGameId = null;
    notice = 'All session edits undone.';
    onChange(games);
    render(true);
  });
  render(true);
  return function selectGameForReview(divisionIndex, game) {
    const match = games.find((item) =>
      item.division === String(divisionIndex) &&
      slotKey(item) === slotKey(game) &&
      item.home === game.home + 1 && item.away === game.away + 1
    );
    if (!match) return false;
    selectedGameId = match.id;
    targetKey = null;
    notice = '';
    weekIndex = Math.floor((dayNumber(match.date) - dayNumber(weeks[0])) / 7);
    render(true);
    return true;
  };
}
