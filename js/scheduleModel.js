// @ts-nocheck -- Pending migration to checked JSDoc.
import { WEIGHT_LABELS } from './constants.js';
import {
  scoreDetails,
  makeScoreContext,
  earlyWindow,
  teamTerms,
  TEAM_SUM_KEYS,
  scoreCrossfieldDivisionClustering,
  scoreWeekendOtherDivField,
} from './scoring.js';
import { slotKey, dayNum, isoWeek, slotBucket } from './utils.js';

// Production games stay zero-indexed; only the prototype presentation uses 1B…nB.
export function moveGames(games, game, slot) {
  const occupant = games.find((g) => g.id !== game.id && slotKey(g) === slotKey(slot));
  const relocate = (g, destination) => ({
    ...g,
    ...destination,
    id: g.id,
    division: g.division,
    home: g.home,
    away: g.away,
    sortKey: slotKey(destination),
  });
  return games.map((g) =>
    g.id === game.id ? relocate(g, slot) : g.id === occupant?.id ? relocate(g, game) : g
  );
}
export function moveReason(games, game, slot, divisions) {
  if (slotKey(game) === slotKey(slot)) return 'Current slot';
  const occupant = games.find((g) => g.id !== game.id && slotKey(g) === slotKey(slot));
  const proposed = moveGames(games, game, slot);
  for (const moved of [game, occupant].filter(Boolean)) {
    const destination = moved.id === game.id ? slot : game;
    const config = divisions[moved.division];
    if (!config.fields.includes(destination.field))
      return `${config.name} cannot play at ${destination.field}`;
    if (config.excludedDays.includes(destination.dayOfWeek))
      return `${config.name}: day unavailable`;
    for (const team of [moved.home, moved.away]) {
      const dates = proposed
        .filter((g) => g.division === moved.division && (g.home === team || g.away === team))
        .map((g) => g.date)
        .sort();
      const label = `${config.name} ${team}B`;
      if (new Set(dates).size !== dates.length) return `${label} already plays this day`;
      for (let i = 2; i < dates.length; i++)
        if (dayNum(dates[i]) - dayNum(dates[i - 2]) <= 3)
          return `${label} would play 3 games in 4 days`;
      const weekdayWeeks = new Set();
      for (const date of dates) {
        const dow = (((dayNum(date) + 4) % 7) + 7) % 7;
        if (dow === 0 || dow === 6) continue;
        const week = isoWeek(date);
        if (weekdayWeeks.has(week)) return `${label} already has a weekday game that week`;
        weekdayWeeks.add(week);
      }
    }
  }
  return '';
}

function gapFacts(games) {
  const days = games.map((g) => dayNum(g.date)).sort((a, b) => a - b);
  return days.length < 2
    ? 'No gaps yet'
    : days
        .slice(1)
        .map((d, i) => d - days[i])
        .join(', ') + ' days between games';
}

export function scoreEditorGames(games, results, baseWeights, breakdown = true) {
  const teams = {},
    operations = { metrics: {}, total: 0 },
    metricNames = {};
  let total = 0;
  const scored = results.map((dr, i) => {
    const schedule = games
      .filter((g) => g.division === String(i))
      .map((g) => ({ ...g, home: g.home - 1, away: g.away - 1 }));
    const weights = { ...baseWeights, ...dr.weights };
    const details = scoreDetails(schedule, dr.division.numTeams, dr.slots);
    const teamSums = {};
    if (breakdown) {
      const ctx = makeScoreContext(
        dr.division.numTeams,
        dr.slots,
        (schedule.length * 2) / dr.division.numTeams
      );
      const early = earlyWindow(schedule.map((g) => g.date).sort()[0]);
      for (let t = 0; t < dr.division.numTeams; t++) {
        const tg = schedule.filter((g) => g.home === t || g.away === t);
        const terms = teamTerms(tg, ctx, early),
          metrics = {};
        for (const key of TEAM_SUM_KEYS) {
          metrics[key] = terms[key] * (weights[key] || 0);
          teamSums[key] = (teamSums[key] || 0) + metrics[key];
        }
        teams[`${i}|${t + 1}`] = {
          metrics,
          total: Object.values(metrics).reduce((a, b) => a + b, 0),
          facts: {
            gapVariance: gapFacts(tg),
            shortGapPenalty: gapFacts(tg),
            timeDistribution: ['WKND_EARLY', 'WKND_MID', 'WKND_LATE']
              .map(
                (bucket) =>
                  `${tg.filter((g) => slotBucket(g.dayOfWeek, g.time) === bucket).length} ${bucket
                    .slice(5)
                    .toLowerCase()}`
              )
              .join(', '),
            fieldBalance: dr.division.fields
              .map((f) => `${f}: ${tg.filter((g) => g.field === f).length}`)
              .join(', '),
            satSunBalance: `${tg.filter((g) => g.dayOfWeek === 6).length} Saturday, ${
              tg.filter((g) => g.dayOfWeek === 0).length
            } Sunday games`,
          },
        };
      }
    }
    for (const key in baseWeights) {
      const value = (details[key] || 0) * (weights[key] || 0);
      total += value;
      // Team terms are unrounded; carry scoreDetails rounding and collective
      // balance terms in this residual so the displayed breakdown sums exactly.
      const residual = value - (teamSums[key] || 0);
      const opKey = `${i}:${key}`;
      operations.metrics[opKey] = residual;
      metricNames[opKey] = `${dr.division.name} · ${WEIGHT_LABELS[key] || key}${
        TEAM_SUM_KEYS.includes(key) ? ' (rounding)' : ''
      }`;
    }
    return { ...dr, schedule, details };
  });
  for (const [key, fn] of [
    ['fieldDivisionClustering', scoreCrossfieldDivisionClustering],
    ['weekendOtherDivField', scoreWeekendOtherDivField],
  ]) {
    const value = fn(scored) * (baseWeights[key] || 0);
    total += value;
    operations.metrics[key] = value;
    metricNames[key] = WEIGHT_LABELS[key] || key;
  }
  operations.total = Object.values(operations.metrics).reduce((a, b) => a + b, 0);
  return { teams, operations, total, metricNames };
}
export const teamMetricNames = Object.fromEntries(
  TEAM_SUM_KEYS.map((k) => [k, WEIGHT_LABELS[k] || k])
);
