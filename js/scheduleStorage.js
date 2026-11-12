import { slotKey } from './utils.js';

export const SCHEDULE_STORAGE_KEY = 'scheduler_schedule_v1';
// localStorage stores UTF-16 strings; bound the snapshot to about 1 MB.
export const MAX_SNAPSHOT_CHARS = 500000;
export function encodeSchedule(session) {
  const indices = new Map(session.allSlots.map((slot, i) => [slotKey(slot), i]));
  const data = {
    version: 1,
    baseWeights: session.baseWeights,
    slots: session.allSlots.map((s) => [
      s.date,
      s.field,
      s.time,
      s.dayOfWeek,
      s.weekendGroup,
      s.week,
    ]),
    results: session.results.map((r) => ({
      division: r.division,
      weights: r.weights,
      games: r.schedule.map((g) => {
        const index = indices.get(slotKey(g));
        if (index === undefined) throw new Error('Game has no available slot');
        return [index, g.home, g.away];
      }),
    })),
  };
  const text = JSON.stringify(data);
  if (text.length > MAX_SNAPSHOT_CHARS) throw new Error('Schedule exceeds storage limit');
  return text;
}
export function decodeSchedule(text) {
  if (text.length > MAX_SNAPSHOT_CHARS) throw new Error('Saved schedule exceeds storage limit');
  const data = JSON.parse(text);
  if (
    data.version !== 1 ||
    !Array.isArray(data.slots) ||
    !data.slots.length ||
    !Array.isArray(data.results) ||
    !data.results.length ||
    !data.baseWeights
  )
    throw new Error('Invalid saved schedule');
  const allSlots = data.slots.map(([date, field, time, dayOfWeek, weekendGroup, week]) => {
    if (
      !/^\d{4}-\d\d-\d\d$/.test(date) ||
      typeof field !== 'string' ||
      !/^\d{1,2}:\d\d(am|pm)$/.test(time) ||
      !Number.isInteger(dayOfWeek) ||
      dayOfWeek < 0 ||
      dayOfWeek > 6
    )
      throw new Error('Invalid saved slot');
    return {
      date,
      field,
      time,
      dayOfWeek,
      weekendGroup,
      week,
      sortKey: slotKey({ date, field, time }),
    };
  });
  const occupied = new Set();
  const results = data.results.map((r) => {
    const d = r.division;
    if (
      !d ||
      typeof d.name !== 'string' ||
      !Number.isInteger(d.numTeams) ||
      d.numTeams < 2 ||
      !Array.isArray(r.games) ||
      d.numTeams > r.games.length * 2 ||
      !Array.isArray(d.fields) ||
      !Array.isArray(d.excludedDays)
    )
      throw new Error('Invalid saved division');
    const schedule = r.games.map(([index, home, away]) => {
      const slot = allSlots[index];
      if (
        !Number.isInteger(index) ||
        !slot ||
        occupied.has(index) ||
        !Number.isInteger(home) ||
        !Number.isInteger(away) ||
        home < 0 ||
        away < 0 ||
        home >= d.numTeams ||
        away >= d.numTeams ||
        home === away ||
        !d.fields.includes(slot.field) ||
        d.excludedDays.includes(slot.dayOfWeek)
      )
        throw new Error('Invalid saved game');
      occupied.add(index);
      return { ...slot, home, away };
    });
    return { division: d, weights: r.weights, schedule };
  });
  return { results, allSlots, baseWeights: data.baseWeights };
}
export function saveScheduleSnapshot(session, storage) {
  try {
    storage.setItem(SCHEDULE_STORAGE_KEY, encodeSchedule(session));
    return true;
  } catch {
    // A stale save must not masquerade as the latest edited schedule.
    try {
      storage.removeItem(SCHEDULE_STORAGE_KEY);
    } catch {}
    return false;
  }
}
