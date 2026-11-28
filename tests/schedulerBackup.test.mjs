import test from 'node:test';
import assert from 'node:assert/strict';
import { WEIGHTS } from '../js/constants.js';
import { parseTSV } from '../js/parser.js';
import { encodeSchedule } from '../js/scheduleStorage.js';
import { encodeBackup, decodeBackup } from '../js/schedulerBackup.js';

const setup = {
  tsv: 'Date\tFuture field\nDraft row\t9:00am',
  fileName: 'next season.tsv',
  weights: { ...Object.fromEntries(Object.entries(WEIGHTS).map(([key, value]) => [key, String(value)])), fieldBalance: '' },
  divisions: [{
    name: 'Next season & younger',
    numTeams: '',
    gamesPerTeam: '2e1',
    leagueSplit: true,
    uncheckedFields: ['Future field'],
    excludedDays: [0, 3],
    weightOverrides: { gapVariance: '', btbBalance: '6' },
  }],
};
const allSlots = parseTSV('Date\tMain & West\tPractice\n4/11/2026\t9:00am, 09:00am, 11:00am\t1:00pm\n4/18/2026\t9:00am');
const schedule = {
  allSlots,
  baseWeights: { ...WEIGHTS },
  results: [{
    division: {
      name: 'Majors <East>',
      numTeams: 2,
      gamesPerTeam: 2,
      leagueSplit: false,
      fields: ['Main & West'],
      excludedDays: [0],
    },
    schedule: [
      { ...allSlots[0], home: 0, away: 1 },
      { ...allSlots.at(-1), home: 1, away: 0 },
    ],
    weights: { ...WEIGHTS, btbBalance: 7 },
  }],
};

test('round-trips a draft setup and an independently generated schedule', () => {
  assert.deepEqual(decodeBackup(encodeBackup(setup, schedule)), { setup, schedule });
  assert.deepEqual(decodeBackup(encodeBackup(setup, null)), { setup, schedule: null });
});

test('exports current games while omitting history, review state, and derived scores', () => {
  const live = structuredClone(schedule);
  live.history = ['private-history'];
  live.reviewState = [{ audit: { auditTolerance: 3 } }];
  live.results[0].division.history = ['private-division-history'];
  live.results[0].details = { fieldBalance: 1 };
  const moved = { ...live.allSlots[2], home: 0, away: 1 };
  live.results[0].schedule[0] = { ...moved, id: 'editor-only-id' };
  const encoded = encodeBackup({ ...setup, history: ['private-setup-history'] }, live);
  assert.doesNotMatch(encoded, /history|reviewState|details|editor-only-id/);
  assert.deepEqual(decodeBackup(encoded).schedule.results[0].schedule[0], moved);
});

test('rejects malformed data, unknown versions, nonstandard dates and invalid game references', () => {
  assert.throws(() => decodeBackup('{'), /valid JSON/);
  assert.throws(() => decodeBackup('null'), /not a Little League Scheduler backup/);
  const invalid = (change, expected) => {
    const data = JSON.parse(encodeBackup(setup, schedule));
    change(data);
    assert.throws(() => decodeBackup(JSON.stringify(data)), expected);
  };
  invalid(data => { data.version = 2; }, /version is not supported/);
  invalid(data => { data.setup.divisions[0].weightOverrides.btbBalance = {}; }, /setup division 1 weights value/);
  invalid(data => { data.schedule.slots[0][0] = '2026-02-30'; }, /date for schedule slot 1/);
  invalid(data => { data.schedule.slots[0][0] = '9999-12-31'; }, /date for schedule slot 1/);
  invalid(data => { data.schedule.slots[0][2] = '13:00pm'; }, /time for schedule slot 1/);
  invalid(data => { data.schedule.results[0].games[0][0] = 100; }, /Invalid saved game/);
  invalid(data => { data.schedule.results[0].games[0][1] = 2; }, /Invalid saved game/);
  invalid(data => { data.schedule.results[0].games[0][0] = 3; }, /Invalid saved game/);
  invalid(data => { data.schedule.results[0].games[1][0] = 1; }, /Invalid saved game/);
});

test('exports schedules that exceed the browser-storage snapshot limit', () => {
  const large = structuredClone(schedule);
  const field = 'A'.repeat(510000);
  large.allSlots.push({ ...large.allSlots[0], field, sortKey: `${large.allSlots[0].sortKey}-${field}` });
  assert.throws(() => encodeSchedule(large), /storage limit/);
  assert.equal(decodeBackup(encodeBackup(setup, large)).schedule.allSlots.at(-1).field, field);
});
