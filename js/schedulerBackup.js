// @ts-check
/** @typedef {import('./types.js').Setup} Setup */
/** @typedef {import('./types.js').PackedSchedule} PackedSchedule */
/** @typedef {import('./scheduleStorage.js').StorageSession} StorageSession */
import { WEIGHTS } from './constants.js';
import { packSchedule, unpackSchedule } from './scheduleStorage.js';

const FORMAT = 'little-league-scheduler';
const VERSION = 1;
const NUMBER_INPUT = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const TIME = /^(?:0?[1-9]|1[0-2]):[0-5]\d(?:am|pm)$/;

/** @param {any} value */
const isString = value => typeof value === 'string';
/** @param {any} value */
const isBoolean = value => typeof value === 'boolean';
/** @param {any} value */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {any} value */
const isNumberInput = value => isString(value) &&
  (value === '' || (NUMBER_INPUT.test(value) && Number.isFinite(Number(value))));
/** @param {any} value */
const isDay = value => Number.isInteger(value) && value >= 0 && value <= 6;

/** @param {any} value */
function isDate(value) {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** @param {any} value */
function isScheduleDate(value) {
  // The calendar uses four-digit dates and steps a week past its final Monday.
  return isDate(value) && value >= '0000-01-03' && value <= '9999-12-26';
}

/** @param {any} value @param {(value: any) => boolean} check @param {string} label @returns {any} */
function expect(value, check, label) {
  if (!check(value)) throw new Error(`Invalid ${label} in scheduler backup.`);
  return value;
}

/** @param {(value: any) => boolean} check */
function arrayOf(check) {
  return (/** @type {any} */ value) => Array.isArray(value) && value.every(check);
}

/** @param {any} value @param {(value: any) => boolean} check @param {string} label @returns {any} */
function projectWeights(value, check, label) {
  expect(value, isRecord, label);
  /** @type {Record<string, any>} */
  const weights = {};
  for (const [key, weight] of Object.entries(value)) {
    expect(key, name => Object.hasOwn(WEIGHTS, name), `${label} key`);
    weights[key] = expect(weight, check, `${label} value for ${key}`);
  }
  return weights;
}

/** @param {any} value @returns {Setup} */
function projectSetup(value) {
  expect(value, isRecord, 'setup');
  const divisions = expect(value.divisions, Array.isArray, 'setup divisions').map((/** @type {any} */ division, /** @type {number} */ index) => {
    const label = `setup division ${index + 1}`;
    expect(division, isRecord, label);
    return {
      name: expect(division.name, isString, `${label} name`),
      numTeams: expect(division.numTeams, isNumberInput, `${label} team count`),
      gamesPerTeam: expect(division.gamesPerTeam, isNumberInput, `${label} games per team`),
      leagueSplit: expect(division.leagueSplit, isBoolean, `${label} league split`),
      uncheckedFields: expect(division.uncheckedFields, arrayOf(isString), `${label} field choices`),
      excludedDays: expect(division.excludedDays, arrayOf(isDay), `${label} excluded days`),
      weightOverrides: projectWeights(division.weightOverrides, isNumberInput, `${label} weights`),
    };
  });
  return {
    divisions,
    tsv: expect(value.tsv, isString, 'field availability'),
    weights: projectWeights(value.weights, isNumberInput, 'setup weights'),
    fileName: expect(value.fileName, isString, 'availability file name'),
  };
}

/** @param {any} value @returns {PackedSchedule} */
function projectSchedule(value) {
  expect(value, isRecord, 'schedule');
  expect(value.version, version => version === 1, 'schedule version');
  const slots = expect(value.slots, Array.isArray, 'schedule slots').map((/** @type {any} */ slot, /** @type {number} */ index) => {
    expect(slot, row => Array.isArray(row) && row.length === 6, `schedule slot ${index + 1}`);
    const [date, field, time, dayOfWeek, weekendGroup, week] = slot;
    return [
      expect(date, isScheduleDate, `date for schedule slot ${index + 1}`),
      expect(field, isString, `field for schedule slot ${index + 1}`),
      expect(time, text => isString(text) && TIME.test(text), `time for schedule slot ${index + 1}`),
      expect(dayOfWeek, isDay, `weekday for schedule slot ${index + 1}`),
      expect(weekendGroup, group => group === null || isDate(group), `weekend for schedule slot ${index + 1}`),
      expect(week, isDate, `week for schedule slot ${index + 1}`),
    ];
  });
  const results = expect(value.results, Array.isArray, 'scheduled divisions').map((/** @type {any} */ result, /** @type {number} */ index) => {
    const label = `scheduled division ${index + 1}`;
    expect(result, isRecord, label);
    const division = expect(result.division, isRecord, label);
    const { leagueSplit = false } = division;
    return {
      division: {
        name: expect(division.name, isString, `${label} name`),
        numTeams: expect(division.numTeams, Number.isSafeInteger, `${label} team count`),
        gamesPerTeam: expect(division.gamesPerTeam, count => Number.isSafeInteger(count) && count > 0, `${label} games per team`),
        leagueSplit: expect(leagueSplit, isBoolean, `${label} league split`),
        fields: expect(division.fields, arrayOf(isString), `${label} fields`),
        excludedDays: expect(division.excludedDays, arrayOf(isDay), `${label} excluded days`),
      },
      weights: projectWeights(result.weights, Number.isFinite, `${label} weights`),
      games: expect(result.games, arrayOf(game => Array.isArray(game) && game.length === 3), `${label} games`),
    };
  });
  return {
    version: value.version,
    baseWeights: projectWeights(value.baseWeights, Number.isFinite, 'schedule weights'),
    slots,
    results,
  };
}

/** @param {Setup} setup @param {StorageSession|null} schedule */
export function encodeBackup(setup, schedule) {
  const data = {
    format: FORMAT,
    version: VERSION,
    setup: projectSetup(setup),
    schedule: schedule === null ? null : projectSchedule(packSchedule(schedule)),
  };
  // Validate references too so each exported file can be re-imported.
  if (data.schedule) unpackSchedule(data.schedule);
  return JSON.stringify(data, null, 2) + '\n';
}

/** @param {string} text */
export function decodeBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file does not contain valid JSON.');
  }
  if (!isRecord(data) || data.format !== FORMAT)
    throw new Error('The file is not a Little League Scheduler backup.');
  if (data.version !== VERSION)
    throw new Error('This scheduler backup version is not supported.');
  return {
    setup: projectSetup(data.setup),
    schedule: data.schedule === null ? null : unpackSchedule(projectSchedule(data.schedule)),
  };
}
