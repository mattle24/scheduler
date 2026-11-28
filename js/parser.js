// @ts-check
/** @typedef {import("./types.js").Slot} Slot */
import { parseDate, dateStr, getWeekendGroup, isoWeek, normalizeTime, timeSortKey } from './utils.js';

/** @param {string} text @returns {Slot[]} */
function parseTSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('Add a header row with field names and at least one row with a date.');

  const header = lines[0].split('\t').map(h => h.trim().replace(/^["']|["']$/g, ''));

  // Auto-detect a leading row-number column: if col[0] of the first data row is not a
  // valid date but col[1] is, assume col[0] is a row number and shift everything right.
  let dateColOffset = 0;
  if (lines.length >= 2) {
    const firstDataCols = lines[1].split('\t');
    const col0 = (firstDataCols[0] || '').trim().replace(/^["']|["']$/g, '');
    const col1 = (firstDataCols[1] || '').trim().replace(/^["']|["']$/g, '');
    const d0 = parseDate(col0);
    const d1 = parseDate(col1);
    if (isNaN(d0.getTime()) && !isNaN(d1.getTime())) {
      dateColOffset = 1;
    }
  }
  const fields = header.slice(1 + dateColOffset);
  if (fields.length === 0) throw new Error('Add at least one field name after the date column in the first row.');

  const slots = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const rawDate = cols[dateColOffset]?.trim().replace(/^["']|["']$/g, '');
    if (!rawDate) continue;
    const d = parseDate(rawDate);
    const parts = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (isNaN(d.getTime()) || (parts && (d.getFullYear() !== +parts[3] || d.getMonth() + 1 !== +parts[1] || d.getDate() !== +parts[2]))) throw new Error(`Invalid date: "${rawDate}" on row ${i + 1}`);
    const ds = dateStr(d);
    const dow = d.getDay();
    const wg = getWeekendGroup(ds);
    const week = isoWeek(ds);

    for (let f = 0; f < fields.length; f++) {
      const cell = (cols[f + 1 + dateColOffset] || '').trim().replace(/^["']|["']$/g, '');
      if (!cell) continue;
      const times = cell.split(',').map(normalizeTime).filter(t => t);
      for (const t of times) {
        const match = t.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
        if (!match || +match[1] < 1 || +match[1] > 12 || +match[2] > 59) {
          throw new Error(`Invalid time "${t}" on row ${i + 1}, field ${fields[f]}. Use a time like 9:00am.`);
        }
        slots.push({
          date: ds,
          dayOfWeek: dow,
          weekendGroup: wg,
          week,
          field: fields[f],
          time: t,
          sortKey: ds + '-' + String(timeSortKey(t)).padStart(5, '0') + '-' + fields[f]
        });
      }
    }
  }

  slots.sort((a, b) => a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);
  return slots;
}

export { parseTSV };
