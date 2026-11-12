import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeSchedule,
  decodeSchedule,
  saveScheduleSnapshot,
  SCHEDULE_STORAGE_KEY,
  MAX_SNAPSHOT_CHARS,
} from '../js/scheduleStorage.js';
import { parseTSV } from '../js/parser.js';
import { WEIGHTS } from '../js/constants.js';
const slots = parseTSV('Date\tA\n4/11/2026\t9:00am, 11:00am\n4/18/2026\t9:00am');
const session = {
  allSlots: slots,
  baseWeights: { ...WEIGHTS },
  history: ['do not store'],
  results: [
    {
      division: { name: 'Majors', numTeams: 2, gamesPerTeam: 2, fields: ['A'], excludedDays: [] },
      weights: { ...WEIGHTS, fieldBalance: 7 },
      slots,
      details: { expensive: 'do not store' },
      schedule: [
        { ...slots[0], home: 0, away: 1 },
        { ...slots[2], home: 1, away: 0 },
      ],
    },
  ],
};
test('compact snapshot restores settings and game assignments without derived data or history', () => {
  const encoded = encodeSchedule(session),
    restored = decodeSchedule(encoded);
  assert.deepEqual(restored.allSlots, slots);
  assert.deepEqual(restored.results[0].schedule, session.results[0].schedule);
  assert.deepEqual(restored.results[0].division, session.results[0].division);
  assert.equal(restored.results[0].weights.fieldBalance, 7);
  assert.deepEqual(restored.baseWeights, WEIGHTS);
  assert.ok(
    !encoded.includes('history') &&
      !encoded.includes('details') &&
      !encoded.includes('do not store')
  );
  assert.ok(encoded.length < 3000);
});
test('quota or size failures remove stale saves and leave the live session unchanged', () => {
  let removed = false;
  const storage = {
    setItem() {
      throw new Error('quota');
    },
    removeItem(key) {
      assert.equal(key, SCHEDULE_STORAGE_KEY);
      removed = true;
    },
  };
  const before = structuredClone(session);
  assert.equal(saveScheduleSnapshot(session, storage), false);
  assert.equal(removed, true);
  assert.deepEqual(session, before);
  const huge = { ...session, baseWeights: { text: 'x'.repeat(MAX_SNAPSHOT_CHARS) } };
  assert.throws(() => encodeSchedule(huge), /storage limit/);
});
test('corrupt, oversized, invalid-slot and double-booked snapshots are rejected', () => {
  assert.throws(() => decodeSchedule('{'));
  assert.throws(() => decodeSchedule('x'.repeat(MAX_SNAPSHOT_CHARS + 1)), /storage limit/);
  const data = JSON.parse(encodeSchedule(session));
  data.results[0].games[0][0] = 999;
  assert.throws(() => decodeSchedule(JSON.stringify(data)), /Invalid saved game/);
  data.results[0].games[0][0] = data.results[0].games[1][0];
  assert.throws(() => decodeSchedule(JSON.stringify(data)), /Invalid saved game/);
});
