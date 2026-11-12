import test from 'node:test';
import assert from 'node:assert/strict';
import { moveGames, moveReason, scoreEditorGames } from '../js/scheduleModel.js';
import { WEIGHTS } from '../js/constants.js';
import {
  scoreDetails,
  scoreCrossfieldDivisionClustering,
  scoreWeekendOtherDivField,
} from '../js/scoring.js';
import { slotKey, isoWeek, getWeekendGroup } from '../js/utils.js';
import { calendarWeeks } from '../js/calendar.js';
const slot = (date, field = 'A', time = '9:00am') => ({
  date,
  field,
  time,
  dayOfWeek: new Date(date + 'T12:00:00').getDay(),
  week: isoWeek(date),
  weekendGroup: getWeekendGroup(date),
  sortKey: slotKey({ date, field, time }),
});
const game = (id, division, date, home = 1, away = 2, field = 'A', time = '9:00am') => ({
  ...slot(date, field, time),
  id,
  division,
  home,
  away,
});
const divisions = {
  0: { name: 'Majors', numTeams: 4, fields: ['A', 'B'], excludedDays: [] },
  1: { name: 'Minors', numTeams: 4, fields: ['B'], excludedDays: [2] },
};
test('moves and cross-division swaps preserve matchups and every slot-derived attribute', () => {
  const games = [game('a', '0', '2026-04-11'), game('b', '1', '2026-04-18', 1, 2, 'B')];
  assert.match(moveReason(games, games[0], games[1], divisions), /cannot play at A/);
  const configs = { ...divisions, 1: { ...divisions['1'], fields: ['A', 'B'] } };
  assert.equal(moveReason(games, games[0], games[1], configs), '');
  const moved = moveGames(games, games[0], games[1]);
  assert.equal(moved[0].sortKey, games[1].sortKey);
  assert.equal(moved[1].sortKey, games[0].sortKey);
  assert.equal(moved[0].week, games[1].week);
  assert.equal(moved[0].weekendGroup, games[1].weekendGroup);
  assert.equal(moved[0].division, '0');
  assert.equal(moved[1].division, '1');
  assert.equal(moved[0].home, 1);
  assert.deepEqual(moveGames(moved, moved[0], moved[1]), games);
});
test('all date-based hard constraints are enforced, while back-to-back days remain legal', () => {
  const source = game('a', '0', '2026-04-11');
  assert.match(
    moveReason([source, game('b', '0', '2026-04-18')], source, slot('2026-04-18', 'B'), divisions),
    /already plays this day/
  );
  assert.match(
    moveReason(
      [source, game('b', '0', '2026-04-18'), game('c', '0', '2026-04-19')],
      source,
      slot('2026-04-21'),
      divisions
    ),
    /3 games in 4 days/
  );
  assert.match(
    moveReason([source, game('b', '0', '2026-04-13')], source, slot('2026-04-17'), divisions),
    /weekday game/
  );
  assert.equal(
    moveReason([source, game('b', '0', '2026-04-18')], source, slot('2026-04-19'), divisions),
    ''
  );
  const minor = game('m', '1', '2026-04-11', 1, 2, 'B');
  assert.match(moveReason([minor], minor, slot('2026-04-14', 'B'), divisions), /day unavailable/);
});
test('editor scores and breakdowns match production, including overrides and cross-division terms', () => {
  const slots = ['2026-04-11', '2026-04-12', '2026-04-18', '2026-04-19'].flatMap((date) =>
    ['A', 'B'].flatMap((field) => ['9:00am', '11:00am'].map((time) => slot(date, field, time)))
  );
  const games = [
    game('a', '0', '2026-04-11'),
    game('b', '0', '2026-04-12', 3, 4),
    game('c', '1', '2026-04-11', 1, 2, 'A', '11:00am'),
    game('d', '1', '2026-04-19', 3, 4, 'B'),
  ];
  const results = Object.values(divisions).map((division) => ({
    division,
    slots,
    weights: { fieldBalance: 17 },
  }));
  for (const proposed of [games, moveGames(games, games[0], slot('2026-04-18', 'B'))]) {
    const scored = results.map((r, i) => ({
      ...r,
      schedule: proposed
        .filter((g) => g.division === String(i))
        .map((g) => ({ ...g, home: g.home - 1, away: g.away - 1 })),
    }));
    const expected =
      scored.reduce((sum, r) => {
        const details = scoreDetails(r.schedule, 4, slots);
        return (
          sum +
          Object.keys(WEIGHTS).reduce(
            (s, k) => s + (details[k] || 0) * { ...WEIGHTS, ...r.weights }[k],
            0
          )
        );
      }, 0) +
      scoreCrossfieldDivisionClustering(scored) * WEIGHTS.fieldDivisionClustering +
      scoreWeekendOtherDivField(scored) * WEIGHTS.weekendOtherDivField;
    const actual = scoreEditorGames(proposed, results, WEIGHTS);
    assert.ok(Math.abs(actual.total - expected) < 1e-8);
    assert.ok(
      Math.abs(
        actual.total -
          Object.values(actual.teams).reduce((s, t) => s + t.total, 0) -
          actual.operations.total
      ) < 1e-8
    );
    assert.equal(scoreEditorGames(proposed, results, WEIGHTS, false).total, actual.total);
  }
});
test('week navigation includes empty weeks between available dates', () => {
  assert.deepEqual(calendarWeeks([slot('2026-04-11'), slot('2026-04-25')]), [
    '2026-04-06',
    '2026-04-13',
    '2026-04-20',
  ]);
});

test('CSV uses edited assignments and keeps the public team numbering', async () => {
  const { formatMultiDivisionCSV } = await import('../js/render.js');
  const games = [game('a', '0', '2026-04-11'), game('b', '1', '2026-04-18', 1, 2, 'B')];
  const moved = moveGames(games, games[0], games[1]);
  const results = Object.values(divisions).map((division, i) => ({
    division,
    schedule: moved
      .filter((g) => g.division === String(i))
      .map((g) => ({ ...g, home: g.home - 1, away: g.away - 1 })),
  }));
  const csv = formatMultiDivisionCSV(results);
  assert.match(csv, /Majors,Saturday,4\/18\/2026,09:00 AM,B,2B,1B/);
  assert.match(csv, /Minors,Saturday,4\/11\/2026,09:00 AM,A,2B,1B/);
  assert.ok(!csv.includes('0B'));
});
