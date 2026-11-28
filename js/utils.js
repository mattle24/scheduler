// @ts-check
import { WKND_BUCKET_THRESHOLDS } from './constants.js';

// ─── Utilities ───────────────────────────────────────────────────────────────
/** @template T @param {T[]} arr @returns {T[]} */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** @param {string} str */
function parseDate(str) {
  str = str.trim().replace(/^["']|["']$/g, '');
  let d;
  if (str.includes('/')) {
    const parts = str.split('/');
    d = new Date(+parts[2], +parts[0] - 1, +parts[1]);
  } else {
    d = new Date(str + 'T00:00:00');
  }
  return d;
}

/** @param {Date} d */
function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

// Memoized ISO date string ("2026-04-11") → integer days since epoch (UTC).
// Date strings repeat constantly in scoring hot loops; parsing once avoids
// millions of Date allocations.
/** @type {Map<string, number>} */
const dayNumCache = new Map();
/** @param {string} dateString */
function dayNum(dateString) {
  let n = dayNumCache.get(dateString);
  if (n === undefined) {
    n = Math.round(Date.parse(dateString.slice(0, 10) + 'T00:00:00Z') / 86400000);
    dayNumCache.set(dateString, n);
  }
  return n;
}

/** @param {string} a @param {string} b */
function daysBetween(a, b) {
  return dayNum(b) - dayNum(a);
}

/** @param {string} date */
function getWeekendGroup(date) {
  const d = new Date(date + 'T00:00:00');
  const dow = d.getDay();
  if (dow === 6) return date;
  if (dow === 0) {
    const sat = new Date(d);
    sat.setDate(sat.getDate() - 1);
    return dateStr(sat);
  }
  return null;
}

/** @param {string} dateString */
function isoWeek(dateString) {
  // Group by Mon–Sun: return the Monday's date as the week key
  const d = new Date(dateString + 'T00:00:00');
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(monday.getDate() + mondayOffset);
  return dateStr(monday);
}

/** @param {string} t */
function normalizeTime(t) {
  t = t.trim().toLowerCase().replace(/\s+/g, '');
  return t;
}

/** @param {number} dayOfWeek @param {string} time */
function slotBucket(dayOfWeek, time) {
  const minutes = timeSortKey(time);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    if (minutes < WKND_BUCKET_THRESHOLDS[0]) return 'WKND_EARLY';
    if (minutes < WKND_BUCKET_THRESHOLDS[1]) return 'WKND_MID';
    return 'WKND_LATE';
  }
  return ['SUN','MON','TUE','WED','THU','FRI','SAT'][dayOfWeek];
}

// Memoized: called on every game in every scoring pass.
/** @type {Map<string, number>} */
const timeSortKeyCache = new Map();
/** @param {string} t */
function timeSortKey(t) {
  let v = timeSortKeyCache.get(t);
  if (v !== undefined) return v;
  const m = t.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!m) v = 0;
  else {
    let h = +m[1];
    const min = +m[2], ampm = m[3].toLowerCase();
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    v = h * 60 + min;
  }
  timeSortKeyCache.set(t, v);
  return v;
}

/** @param {string} t */
function formatTimeDisplay(t) {
  return t.replace(/^(\d):/, '0$1:').toUpperCase().replace(/(AM|PM)/, ' $1');
}

/** @param {{date: string, time: string, field: string}} g */
function slotKey(g) {
  return g.date + '-' + String(timeSortKey(g.time)).padStart(5, '0') + '-' + g.field;
}

/** @type {Map<number, string>} */
const dayStrCache = new Map();
/** @param {string} dateString @param {number} n */
function addDays(dateString, n) {
  const target = dayNum(dateString) + n;
  let s = dayStrCache.get(target);
  if (s === undefined) {
    s = new Date(target * 86400000).toISOString().slice(0, 10);
    dayStrCache.set(target, s);
  }
  return s;
}

// Returns true if adding newDate would give the team 3+ games in any 4-day window
// Uses sorted day-number array for O(log n) binary search instead of Date allocations
/** @param {number[]} sortedDayNums @param {number} newDayNum */
function hasThreeInFourDays(sortedDayNums, newDayNum) {
  // Find where newDayNum would sit in the sorted array
  let lo = 0, hi = sortedDayNums.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDayNums[mid] < newDayNum) lo = mid + 1;
    else hi = mid;
  }
  // Count games in window [newDayNum-3, newDayNum+3] (nearby entries)
  // Check each 4-day window containing newDayNum: [d-3,d], [d-2,d+1], [d-1,d+2], [d,d+3]
  for (let start = newDayNum - 3; start <= newDayNum; start++) {
    const end = start + 3;
    let count = 1; // newDayNum itself
    // Scan left from insertion point
    for (let i = lo - 1; i >= 0; i--) {
      if (sortedDayNums[i] < start) break;
      count++;
    }
    // Scan right from insertion point
    for (let i = lo; i < sortedDayNums.length; i++) {
      if (sortedDayNums[i] > end) break;
      count++;
    }
    if (count >= 3) return true;
  }
  return false;
}

// Returns true if a sorted array of dates contains 3+ games in any 4-day window
/** @param {string[]} datesArray */
function teamHasThreeInFourDays(datesArray) {
  const sorted = datesArray.map(dayNum).sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    let count = 1;
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j] - sorted[i] <= 3) count++;
      else break;
    }
    if (count >= 3) return true;
  }
  return false;
}

export { shuffle, parseDate, dateStr, dayNum, daysBetween, getWeekendGroup, isoWeek, normalizeTime, slotBucket, timeSortKey, formatTimeDisplay, slotKey, addDays, hasThreeInFourDays, teamHasThreeInFourDays };
