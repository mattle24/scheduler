// @ts-check
/** @typedef {import('./types.js').Game} Game */
/** @typedef {import('./types.js').Slot} Slot */
/** @typedef {import('./types.js').Weights} Weights */
/** @typedef {{fieldContinuity: number, loneWeekendGame: number, clust: number, otherDiv: number}} FieldTerms */
/** @typedef {{times: {t: number, div: string}[], weekendDivs: Set<string>}} OtherField */
/** @typedef {{indices: number[], teams: Set<number>, fds: Set<string>}} PendingMove */
import { WEIGHTS } from './constants.js';
import { timeSortKey } from './utils.js';
import {
  makeScoreContext, earlyWindow, teamTerms, fieldDateTerms,
  shortGapBalanceOf, btbBalanceOf, TEAM_SUM_KEYS
} from './scoring.js';

const SELF = '\u0000self';
/** @param {number} dow */
const isWeekendDow = dow => dow === 0 || dow === 6;

// Incremental version of scoreCandidate + scoreCrossDivision for the annealer.
//
// Holds cached penalty contributions per team, per field+date, and per weekend
// date+time. A move touches 1–2 games, so only those games' teams and slots are
// recomputed instead of rescoring the whole schedule.
//
// Usage — the caller owns and mutates the `games` array in place:
//   scorer.begin([i, j]);   // before changing games i and j
//   ...mutate games[i], games[j] (date/dayOfWeek/weekendGroup/time/field)...
//   const s = scorer.end(); // new total
// To undo, call begin/mutate-back/end again.
//
// total() is the unrounded weighted score. It equals scoreCandidate +
// scoreCrossDivision up to scoreDetails' 2-decimal rounding of each metric.
// Team membership of a game (home/away) must not change between begin/end.
class IncrementalScorer {
  /** @param {Game[]} games @param {number} numTeams @param {Slot[]} slots @param {Weights} weights @param {Game[]|null} otherGames */
  constructor(games, numTeams, slots, weights, otherGames) {
    /** @type {Game[]} */
    this.games = games;
    this.numTeams = numTeams;
    const W = weights || WEIGHTS;
    this.W = W;
    this.ctx = makeScoreContext(numTeams, slots, games.length * 2 / numTeams);
    this.wClust = (otherGames && otherGames.length) ? (W.fieldDivisionClustering || 0) : 0;
    this.wOther = (otherGames && otherGames.length) ? (W.weekendOtherDivField || 0) : 0;

    // Team → game indices (fixed for the scorer's lifetime)
    /** @type {number[][]} */
    this.teamGameIdx = [];
    for (let t = 0; t < numTeams; t++) this.teamGameIdx.push([]);
    games.forEach((g, i) => { this.teamGameIdx[g.home].push(i); this.teamGameIdx[g.away].push(i); });

    // Other divisions' games per field+date (fixed during annealing)
    /** @type {Map<string, OtherField>} */
    this.otherByFd = new Map(); // fdKey → { times: [{t, div}] sorted, weekendDivs: Set }
    if (this.wClust || this.wOther) {
      for (const g of /** @type {Game[]} */ (otherGames)) {
        const key = g.field + '|' + g.date;
        let o = this.otherByFd.get(key);
        if (!o) { o = { times: [], weekendDivs: new Set() }; this.otherByFd.set(key, o); }
        o.times.push({ t: timeSortKey(g.time), div: g.division || '\u0000other' });
        if (isWeekendDow(g.dayOfWeek)) o.weekendDivs.add(g.division || '\u0000other');
      }
      for (const o of this.otherByFd.values()) o.times.sort((a, b) => a.t - b.t);
    }

    // Date multiset for the season start (earlySeasonDensity window)
    /** @type {Map<string, number>} */
    this.dateCounts = new Map();
    for (const g of games) this.dateCounts.set(g.date, (this.dateCounts.get(g.date) || 0) + 1);
    this.minDate = this._minDate();
    this.early = earlyWindow(this.minDate);

    // Per-team cached terms
    this.teamCache = [];
    for (let t = 0; t < numTeams; t++) this.teamCache.push(this._teamTerms(t));

    // Weekend date+time counts → timeSlotSpread (integer, maintained exactly)
    /** @type {Map<string, number>} */
    this.dtCounts = new Map();
    this.timeSlotSpread = 0;
    for (const g of games) this._dtAdd(g, 1);

    // Field+date → this division's game indices, plus cached integer terms
    /** @type {Map<string, Set<number>>} */
    this.fdGames = new Map();
    for (let i = 0; i < games.length; i++) this._fdIndexAdd(i);
    /** @type {Map<string, FieldTerms>} */
    this.fdCache = new Map();
    this.fdSums = { fieldContinuity: 0, loneWeekendGame: 0, clust: 0, otherDiv: 0 };
    const allFd = new Set([...this.fdGames.keys(), ...this.otherByFd.keys()]);
    for (const key of allFd) this._fdRecompute(key);

    /** @type {PendingMove|null} */
    this.pending = null;
  }

  _minDate() {
    let m;
    for (const [d, c] of this.dateCounts) if (c > 0 && (m === undefined || d < m)) m = d;
    return m;
  }

  /** @param {number} t */
  _teamTerms(t) {
    return teamTerms(this.teamGameIdx[t].map(i => this.games[i]), this.ctx, this.early);
  }

  /** @param {Game} g @param {number} sign */
  _dtAdd(g, sign) {
    if (!isWeekendDow(g.dayOfWeek)) return;
    const key = g.date + '|' + g.time;
    const before = this.dtCounts.get(key) || 0;
    const after = before + sign;
    this.timeSlotSpread += Math.max(0, after - 1) - Math.max(0, before - 1);
    if (after === 0) this.dtCounts.delete(key); else this.dtCounts.set(key, after);
  }

  /** @param {number} i @returns {string} */
  _fdIndexAdd(i) {
    const g = this.games[i];
    const key = g.field + '|' + g.date;
    let s = this.fdGames.get(key);
    if (!s) { s = new Set(); this.fdGames.set(key, s); }
    s.add(i);
    return key;
  }

  /** @param {number} i @returns {string} */
  _fdIndexRemove(i) {
    const g = this.games[i];
    const key = g.field + '|' + g.date;
    const s = /** @type {Set<number>} */ (this.fdGames.get(key));
    s.delete(i);
    if (s.size === 0) this.fdGames.delete(key);
    return key;
  }

  /** @param {string} key */
  _fdRecompute(key) {
    const old = this.fdCache.get(key);
    if (old) for (const k of /** @type {(keyof FieldTerms)[]} */ (Object.keys(old))) this.fdSums[k] -= old[k];

    const idxs = this.fdGames.get(key);
    const other = this.otherByFd.get(key);
    const term = { fieldContinuity: 0, loneWeekendGame: 0, clust: 0, otherDiv: 0 };
    let weekend = false;
    /** @type {number[]} */
    let selfTimes = [];
    if (idxs && idxs.size) {
      weekend = isWeekendDow(this.games[/** @type {number} */ (idxs.values().next().value)].dayOfWeek);
      selfTimes = [...idxs].map(i => timeSortKey(this.games[i].time)).sort((a, b) => a - b);
      if (weekend) {
        const fd = fieldDateTerms(selfTimes, this.ctx.fieldDateTimes.get(key));
        term.fieldContinuity = fd.fieldContinuity;
        term.loneWeekendGame = fd.loneWeekendGame;
      }
    }
    if (other) {
      if (this.wClust) {
        // Merge self + other games by time and count division switches (A-B-A = 4)
        const merged = selfTimes.map(t => ({ t, div: SELF })).concat(other.times).sort((a, b) => a.t - b.t);
        for (let i = 1; i < merged.length; i++) {
          if (merged[i].div !== merged[i - 1].div) {
            term.clust += 1;
            if (i >= 2 && merged[i].div === merged[i - 2].div) term.clust += 3;
          }
        }
      }
      if (this.wOther) {
        // Each division on a shared weekend field+date counts once
        const n = other.weekendDivs.size + (selfTimes.length && weekend ? 1 : 0);
        if (n > 1) term.otherDiv = n;
      }
    }

    for (const k of /** @type {(keyof FieldTerms)[]} */ (Object.keys(term))) this.fdSums[k] += term[k];
    this.fdCache.set(key, term);
  }

  /** @param {number[]} indices */
  begin(indices) {
    /** @type {Set<number>} */
    const teams = new Set();
    /** @type {Set<string>} */
    const fds = new Set();
    for (const i of indices) {
      const g = this.games[i];
      teams.add(g.home); teams.add(g.away);
      this._dtAdd(g, -1);
      fds.add(this._fdIndexRemove(i));
      this.dateCounts.set(g.date, /** @type {number} */ (this.dateCounts.get(g.date)) - 1);
    }
    this.pending = { indices, teams, fds };
  }

  end() {
    const { indices, teams, fds } = /** @type {PendingMove} */ (this.pending);
    this.pending = null;
    for (const i of indices) {
      const g = this.games[i];
      this._dtAdd(g, 1);
      fds.add(this._fdIndexAdd(i));
      this.dateCounts.set(g.date, (this.dateCounts.get(g.date) || 0) + 1);
    }
    const minDate = this._minDate();
    if (minDate !== this.minDate) {
      // Season start moved: every team's early-season window changes
      this.minDate = minDate;
      this.early = earlyWindow(minDate);
      for (let t = 0; t < this.numTeams; t++) this.teamCache[t] = this._teamTerms(t);
    } else {
      for (const t of teams) this.teamCache[t] = this._teamTerms(t);
    }
    for (const key of fds) this._fdRecompute(key);
    return this.total();
  }

  total() {
    const W = this.W;
    let score = 0;
    const sgCounts = [], btbCounts = [];
    for (const k of TEAM_SUM_KEYS) {
      const w = W[k];
      if (!w) continue;
      let sum = 0;
      for (const tt of this.teamCache) sum += tt[k];
      score += w * sum;
    }
    for (const tt of this.teamCache) { sgCounts.push(tt.shortGapCount); btbCounts.push(tt.btbCount); }
    if (W.shortGapBalance) score += W.shortGapBalance * shortGapBalanceOf(sgCounts);
    if (W.btbBalance) score += W.btbBalance * btbBalanceOf(btbCounts);
    if (W.timeSlotSpread) score += W.timeSlotSpread * this.timeSlotSpread;
    if (W.fieldContinuity) score += W.fieldContinuity * this.fdSums.fieldContinuity;
    if (W.loneWeekendGame) score += W.loneWeekendGame * this.fdSums.loneWeekendGame;
    score += this.wClust * this.fdSums.clust + this.wOther * this.fdSums.otherDiv;
    return score;
  }
}

export { IncrementalScorer };
