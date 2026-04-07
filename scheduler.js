// ─── Constants ───────────────────────────────────────────────────────────────
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const NUM_ATTEMPTS = 200;

const WEIGHTS = {
  earlySeasonDensity: 8,
  endOfSeasonDensity: 8,
  fieldBalance: 4,
  gapVariance: 6,
  satSunBalance: 4,
  shortGapPenalty: 3,
  timeDistribution: 3,
  weekendBTBTimePenalty: 3,
  weekendDoubleHeaders: 5,
  weekendSitouts: 12,
};

const WEIGHT_LABELS = {
  earlySeasonDensity: 'Early Season Density (games within 2 days in first 7 days)',
  endOfSeasonDensity: 'End of Season Density (>1 game in last 5 days)',
  fieldBalance: 'Field Balance (teams play even games at each field)',
  gapVariance: 'Gap Variance (difference time between games across teams)',
  satSunBalance: 'Sat/Sun Balance (equal Saturday & Sunday games per team)',
  shortGapPenalty: 'Short Gap Penalty',
  timeDistribution: 'Time Distribution',
  weekendBTBTimePenalty: 'Weekend B2B Timeslot (2nd day should be later time)',
  weekendDoubleHeaders: 'Weekend Back-to-Back',
  weekendSitouts: 'Weekend Sit-outs (no games in a weekend)',
};

const WEIGHT_DESCRIPTIONS = {
  earlySeasonDensity: 'Penalizes games scheduled within 2 days of each other during the first 7 days of the season.',
  endOfSeasonDensity: 'Penalizes more than 1 game per team in the last 5 days of the season.',
  fieldBalance: 'Penalizes uneven distribution of field assignments per team. Higher = teams play at each field more equally.',
  gapVariance: 'Penalizes uneven spacing between games across a team\'s schedule. Higher = more consistent rest for all teams.',
  satSunBalance: 'Penalizes uneven split of Saturday vs Sunday games per team. Higher = equal Sat & Sun games.',
  shortGapPenalty: 'Adds 1/gap-days for each pair of consecutive games. Strongly penalizes 1–2 day gaps, fades for longer gaps.',
  timeDistribution: 'Penalizes uneven distribution of game time slots per team (e.g. always 9am, never 1pm).',
  weekendBTBTimePenalty: 'When a team plays back-to-back weekend days, prefers a later timeslot on the second day.',
  weekendDoubleHeaders: 'Penalizes 2+ games in the same Sat–Sun weekend. Higher = at most 1 game per weekend per team.',
  weekendSitouts: 'Penalizes when a team has zero games on a weekend. Higher = fewer idle weekends per team.',
};

// ─── Utilities ───────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

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

function isoWeek(dateString) {
  // Group by Mon–Sun: return the Monday's date as the week key
  const d = new Date(dateString + 'T00:00:00');
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(monday.getDate() + mondayOffset);
  return dateStr(monday);
}

function normalizeTime(t) {
  t = t.trim().toLowerCase().replace(/\s+/g, '');
  return t;
}

function slotBucket(dayOfWeek, time) {
  const minutes = timeSortKey(time);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return minutes < 720 ? 'WE_MORN' : 'WE_AFT'; // before/after noon
  }
  return ['SUN','MON','TUE','WED','THU','FRI','SAT'][dayOfWeek];
}

function timeSortKey(t) {
  const m = t.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!m) return 0;
  let h = +m[1], min = +m[2], ampm = m[3].toLowerCase();
  if (ampm === 'pm' && h !== 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

function formatTimeDisplay(t) {
  return t.replace(/^(\d):/, '0$1:').toUpperCase().replace(/(AM|PM)/, ' $1');
}

function addDays(dateString, n) {
  const d = new Date(dateString + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

// Returns true if adding newDate would give the team 3+ games in any 4-day window
// Uses sorted day-number array for O(log n) binary search instead of Date allocations
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
function teamHasThreeInFourDays(datesArray) {
  const sorted = [...datesArray].sort();
  for (let i = 0; i < sorted.length; i++) {
    let count = 1;
    for (let j = i + 1; j < sorted.length; j++) {
      if (daysBetween(sorted[i], sorted[j]) <= 3) count++;
      else break;
    }
    if (count >= 3) return true;
  }
  return false;
}

// Returns true if newDate is a weekday and the team already has a game on another weekday in the same M-F span
function hasWeekdayGameThisWeek(teamDaySet, newDate) {
  const d = new Date(newDate + 'T00:00:00');
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false; // weekend, no constraint
  // Check Mon-Fri of this week using addDays from newDate
  const mondayOffset = -(dow - 1);
  for (let i = 0; i < 5; i++) {
    const checkStr = addDays(newDate, mondayOffset + i);
    if (checkStr !== newDate && teamDaySet.has(checkStr)) return true;
  }
  return false;
}

// ─── Module 1: Parse TSV ────────────────────────────────────────────────────
function parseTSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('TSV must have a header row and at least one data row');

  const header = lines[0].split('\t').map(h => h.trim().replace(/^["']|["']$/g, ''));
  const fields = header.slice(1);
  if (fields.length === 0) throw new Error('No fields found in TSV header');

  const slots = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const rawDate = cols[0]?.trim().replace(/^["']|["']$/g, '');
    if (!rawDate) continue;
    const d = parseDate(rawDate);
    if (isNaN(d.getTime())) throw new Error(`Invalid date: "${rawDate}" on row ${i + 1}`);
    const ds = dateStr(d);
    const dow = d.getDay();
    const wg = getWeekendGroup(ds);
    const week = isoWeek(ds);

    for (let f = 0; f < fields.length; f++) {
      const cell = (cols[f + 1] || '').trim().replace(/^["']|["']$/g, '');
      if (!cell) continue;
      const times = cell.split(',').map(normalizeTime).filter(t => t);
      for (const t of times) {
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

// ─── Module 2: Generate Tournament Rounds (Circle/Polygon Algorithm) ────────
function generateTournamentRounds(numTeams) {
  // If odd, add a dummy team (index = numTeams) to make it even, then strip byes
  const dummy = numTeams % 2 === 1 ? numTeams : -1;
  const n = numTeams % 2 === 1 ? numTeams + 1 : numTeams;

  // Teams array: indices 0..n-1. Fix team 0, rotate 1..n-1.
  const teams = [];
  for (let i = 0; i < n; i++) teams.push(i);

  const rounds = [];
  // n-1 rounds for n teams
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    // Pair first with last, second with second-to-last, etc.
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i];
      const b = teams[n - 1 - i];
      // Skip games involving the dummy team
      if (a === dummy || b === dummy) continue;
      round.push([Math.min(a, b), Math.max(a, b)]);
    }
    rounds.push(round);

    // Rotate: fix teams[0], rotate teams[1..n-1] by one position
    // Last element goes to position 1, everything else shifts right
    const last = teams[n - 1];
    for (let i = n - 1; i > 1; i--) {
      teams[i] = teams[i - 1];
    }
    teams[1] = last;
  }

  return rounds;
}

// ─── Module 2a: League-Aware Matchup Selection ─────────────────────────────
// When AL-NL split is enabled, generates matchups using a layered fill:
//   Layer 1: every intra-league pair once
//   Layer 2: every inter-league pair once
//   Layer 3: every intra-league pair again
//   ... until gamesPerTeam is reached.
function selectMatchupsWithLeagues(numTeams, gamesPerTeam, numWeekends) {
  const totalGames = numTeams * gamesPerTeam / 2;
  if (totalGames !== Math.floor(totalGames)) {
    throw new Error(`${numTeams} teams × ${gamesPerTeam} games = ${numTeams * gamesPerTeam} team-games, which is odd and can't form whole matchups. Adjust so the product is even.`);
  }

  // Odd-numbered teams (1B,3B,5B…) → AL, even-numbered (2B,4B,6B…) → NL
  const alTeams = [];
  const nlTeams = [];
  for (let i = 0; i < numTeams; i++) {
    if ((i + 1) % 2 === 1) alTeams.push(i); // display-odd → AL
    else nlTeams.push(i);                     // display-even → NL
  }
  const alSize = alTeams.length;
  const nlSize = nlTeams.length;

  // Generate intra-league rounds using circle algorithm, mapped to real team IDs
  function subLeagueRounds(teams) {
    if (teams.length < 2) return [];
    const rounds = generateTournamentRounds(teams.length);
    return rounds.map(round => round.map(([a, b]) => [teams[a], teams[b]]));
  }

  const alRounds = subLeagueRounds(alTeams);
  const nlRounds = subLeagueRounds(nlTeams);

  // Merge AL and NL intra rounds (they don't conflict — disjoint team sets)
  const intraRounds = [];
  const maxIntraRounds = Math.max(alRounds.length, nlRounds.length);
  for (let i = 0; i < maxIntraRounds; i++) {
    const round = [];
    if (i < alRounds.length) round.push(...alRounds[i]);
    if (i < nlRounds.length) round.push(...nlRounds[i]);
    intraRounds.push(round);
  }

  // Generate inter-league rounds (complete bipartite matching)
  // Round r: alTeams[i] vs nlTeams[(i + r) % nlSize]
  const interRounds = [];
  const numInterRounds = nlSize; // covers all alSize × nlSize pairs
  for (let r = 0; r < numInterRounds; r++) {
    const round = [];
    for (let i = 0; i < alSize; i++) {
      round.push([alTeams[i], nlTeams[(i + r) % nlSize]]);
    }
    interRounds.push(round);
  }

  // Layered fill: intra layer, inter layer, intra layer, inter layer...
  const collectedRounds = [];
  let intraIdx = 0, interIdx = 0;
  let gameCount = 0;
  let phase = 'intra';

  while (gameCount < totalGames) {
    if (phase === 'intra') {
      for (let i = 0; i < intraRounds.length && gameCount < totalGames; i++) {
        const round = intraRounds[(intraIdx + i) % intraRounds.length];
        collectedRounds.push([...round]);
        gameCount += round.length;
      }
      intraIdx += intraRounds.length;
      phase = 'inter';
    } else {
      for (let i = 0; i < interRounds.length && gameCount < totalGames; i++) {
        const round = interRounds[(interIdx + i) % interRounds.length];
        collectedRounds.push([...round]);
        gameCount += round.length;
      }
      interIdx += interRounds.length;
      phase = 'intra';
    }
  }

  // Flatten all collected games, then trim to exactly totalGames while keeping
  // per-team counts balanced. Drop games from the end where the involved teams
  // have the highest game counts.
  let allPairs = [];
  for (const round of collectedRounds) {
    for (const pair of round) allPairs.push(pair);
  }

  if (allPairs.length > totalGames) {
    // Count games per team
    const counts = new Array(numTeams).fill(0);
    for (const [a, b] of allPairs) { counts[a]++; counts[b]++; }

    // Greedily remove games where both teams are most over-represented
    while (allPairs.length > totalGames) {
      let worstIdx = -1, worstScore = -Infinity;
      for (let i = allPairs.length - 1; i >= 0; i--) {
        const [a, b] = allPairs[i];
        const score = counts[a] + counts[b];
        if (score > worstScore) { worstScore = score; worstIdx = i; }
      }
      const [a, b] = allPairs[worstIdx];
      counts[a]--; counts[b]--;
      allPairs.splice(worstIdx, 1);
    }
  }

  // Re-group into rounds for weekend scheduling: take chunks that form valid matchings
  // (no team appears twice in a round). Simple greedy grouping.
  collectedRounds.length = 0;
  const used = new Array(allPairs.length).fill(false);
  let remaining = allPairs.length;
  while (remaining > 0) {
    const round = [];
    const inRound = new Set();
    for (let i = 0; i < allPairs.length; i++) {
      if (used[i]) continue;
      const [a, b] = allPairs[i];
      if (inRound.has(a) || inRound.has(b)) continue;
      round.push(allPairs[i]);
      inRound.add(a);
      inRound.add(b);
      used[i] = true;
      remaining--;
    }
    collectedRounds.push(round);
  }

  // Split into weekend rounds and weekday games (same logic as selectMatchups)
  const weekendRounds = collectedRounds.slice(0, Math.min(numWeekends, collectedRounds.length));
  const weekdayGames = [];
  const weekdayRoundsArr = collectedRounds.slice(weekendRounds.length);
  const weekendGameCount = weekendRounds.reduce((sum, r) => sum + r.length, 0);
  let weekdayNeeded = totalGames - weekendGameCount;
  for (const round of weekdayRoundsArr) {
    for (const game of round) {
      if (weekdayNeeded <= 0) break;
      weekdayGames.push(game);
      weekdayNeeded--;
    }
  }

  fillWeekendByes(weekendRounds, weekdayGames, numTeams);

  return { weekendRounds, weekdayGames };
}

// Validate that the intra-league hard constraint is satisfiable
function validateLeagueSplit(numTeams, gamesPerTeam) {
  const alSize = Math.ceil(numTeams / 2);  // odd-numbered teams
  const nlSize = numTeams - alSize;         // even-numbered teams
  const maxLeagueSize = Math.max(alSize, nlSize);
  // Each team must play every intra-league opponent at least once
  const minGamesNeeded = maxLeagueSize - 1;
  if (gamesPerTeam < minGamesNeeded) {
    return `AL-NL split requires at least ${minGamesNeeded} games per team (to play every league opponent once), but only ${gamesPerTeam} configured.`;
  }
  return null;
}

// For odd team counts, each round has a bye team. Pull a game involving the
// bye team from the weekday pool into the weekend round so every team plays
// at least once per weekend. The opponent gets a Sat+Sun doubleheader, but
// the builder spreads games across days to minimize that.
function fillWeekendByes(weekendRounds, weekdayGames, numTeams) {
  if (numTeams % 2 === 0) return;
  for (const round of weekendRounds) {
    const inRound = new Set();
    for (const [a, b] of round) { inRound.add(a); inRound.add(b); }
    for (let t = 0; t < numTeams; t++) {
      if (inRound.has(t)) continue;
      // t has a bye — find a weekday game involving t
      const idx = weekdayGames.findIndex(([a, b]) => a === t || b === t);
      if (idx !== -1) {
        const [ga, gb] = weekdayGames.splice(idx, 1)[0];
        round.push([ga, gb]);
        inRound.add(ga);
        inRound.add(gb);
      }
    }
  }
}

// ─── Module 2b: Select Matchups from Tournament Rounds ──────────────────────
function selectMatchups(rounds, numTeams, gamesPerTeam, numWeekends) {
  const totalGames = numTeams * gamesPerTeam / 2;
  if (totalGames !== Math.floor(totalGames)) {
    throw new Error(`${numTeams} teams × ${gamesPerTeam} games = ${numTeams * gamesPerTeam} team-games, which is odd and can't form whole matchups. Adjust so the product is even.`);
  }

  // Collect full rounds by cycling, keeping rounds intact
  const collectedRounds = [];
  let roundIdx = 0;
  let gameCount = 0;
  while (gameCount < totalGames) {
    const round = rounds[roundIdx % rounds.length];
    collectedRounds.push([...round]);
    gameCount += round.length;
    roundIdx++;
  }

  // First numWeekends rounds → weekend (guaranteed perfect matchings)
  const weekendRounds = collectedRounds.slice(0, Math.min(numWeekends, collectedRounds.length));

  // Remaining rounds → weekday, flattened. Trim excess games from the last round if we overshot.
  const weekdayGames = [];
  const weekdayRounds = collectedRounds.slice(weekendRounds.length);
  const weekendGameCount = weekendRounds.reduce((sum, r) => sum + r.length, 0);
  let weekdayNeeded = totalGames - weekendGameCount;
  for (const round of weekdayRounds) {
    for (const game of round) {
      if (weekdayNeeded <= 0) break;
      weekdayGames.push(game);
      weekdayNeeded--;
    }
  }

  fillWeekendByes(weekendRounds, weekdayGames, numTeams);

  return { weekendRounds, weekdayGames };
}

// Wrapper that matches the old generateMatchups signature for ui.js compatibility
function generateMatchups(numTeams, gamesPerTeam) {
  const totalGames = numTeams * gamesPerTeam / 2;
  if (totalGames !== Math.floor(totalGames)) {
    throw new Error(`${numTeams} teams × ${gamesPerTeam} games = ${numTeams * gamesPerTeam} team-games, which is odd and can't form whole matchups. Adjust so the product is even.`);
  }

  const rounds = generateTournamentRounds(numTeams);

  // Collect games by cycling through rounds until we have enough
  const games = [];
  let roundIdx = 0;
  while (games.length < totalGames) {
    const round = rounds[roundIdx % rounds.length];
    for (const game of round) {
      if (games.length >= totalGames) break;
      games.push({ teamA: game[0], teamB: game[1] });
    }
    roundIdx++;
  }

  // Verify counts
  const counts = new Array(numTeams).fill(0);
  for (const g of games) { counts[g.teamA]++; counts[g.teamB]++; }
  for (let i = 0; i < numTeams; i++) {
    if (counts[i] !== gamesPerTeam) {
      throw new Error(`Matchup generation error: team ${i + 1} has ${counts[i]} games instead of ${gamesPerTeam}`);
    }
  }

  return games;
}

// ─── Module 3: Assign Home/Away ──────────────────────────────────────────────
function assignHomeAway(games, numTeams) {
  const homeCount = new Array(numTeams).fill(0);
  const awayCount = new Array(numTeams).fill(0);
  // Per-matchup tracking: key "min,max" → { home: count where min is home, away: count where min is away }
  const matchupHA = new Map();
  function matchupKey(a, b) { return Math.min(a, b) + ',' + Math.max(a, b); }

  const result = games.map(g => {
    let home, away;
    const key = matchupKey(g.teamA, g.teamB);
    const mh = matchupHA.get(key) || { home: 0, away: 0 };

    // Priority 1: per-matchup balance (min team as home vs away)
    const lo = Math.min(g.teamA, g.teamB);
    const hi = Math.max(g.teamA, g.teamB);
    const loAsHomeCount = mh.home;  // times lo was home
    const loAsAwayCount = mh.away;  // times lo was away

    if (loAsHomeCount < loAsAwayCount) {
      home = lo; away = hi;
    } else if (loAsAwayCount < loAsHomeCount) {
      home = hi; away = lo;
    } else {
      // Matchup is balanced — use overall balance as tiebreaker
      const aNet = homeCount[g.teamA] - awayCount[g.teamA];
      const bNet = homeCount[g.teamB] - awayCount[g.teamB];
      if (aNet < bNet) {
        home = g.teamA; away = g.teamB;
      } else if (bNet < aNet) {
        home = g.teamB; away = g.teamA;
      } else {
        if (Math.random() < 0.5) {
          home = g.teamA; away = g.teamB;
        } else {
          home = g.teamB; away = g.teamA;
        }
      }
    }

    homeCount[home]++;
    awayCount[away]++;
    if (home === lo) mh.home++;
    else mh.away++;
    matchupHA.set(key, mh);
    return { home, away };
  });

  // Build per-team game index for efficient lookups in repair passes
  const teamGamesIdx = new Map();
  for (let t = 0; t < numTeams; t++) teamGamesIdx.set(t, []);
  for (const r of result) {
    teamGamesIdx.get(r.home).push(r);
    teamGamesIdx.get(r.away).push(r);
  }

  // Repair pass 1: fix per-matchup imbalances (±1 max)
  for (let pass = 0; pass < 100; pass++) {
    let anyFixed = false;
    for (const [key, mh] of matchupHA) {
      const diff = mh.home - mh.away;
      if (Math.abs(diff) <= 1) continue;
      const [loStr, hiStr] = key.split(',');
      const lo = +loStr, hi = +hiStr;
      // Need to flip a game where the over-represented side is home
      const flipFrom = diff > 0 ? lo : hi;  // this team is home too often in this matchup
      const flipTo = diff > 0 ? hi : lo;
      for (const r of teamGamesIdx.get(flipFrom)) {
        if (r.home === flipFrom && r.away === flipTo) {
          r.home = flipTo; r.away = flipFrom;
          homeCount[flipFrom]--; awayCount[flipFrom]++;
          homeCount[flipTo]++; awayCount[flipTo]--;
          if (diff > 0) { mh.home--; mh.away++; }
          else { mh.away--; mh.home++; }
          anyFixed = true;
          break;
        }
      }
    }
    if (!anyFixed) break;
  }

  // Repair pass 2: fix overall team H/A balance (±1 max)
  for (let pass = 0; pass < 100; pass++) {
    let anyFixed = false;
    for (let i = 0; i < numTeams; i++) {
      if (homeCount[i] - awayCount[i] > 1) {
        for (const r of teamGamesIdx.get(i)) {
          if (r.home === i) {
            const other = r.away;
            // Only flip if it doesn't break per-matchup balance
            const key = matchupKey(i, other);
            const mh = matchupHA.get(key);
            const lo = Math.min(i, other);
            const curDiff = mh.home - mh.away; // lo-as-home minus lo-as-away
            const wouldFlip = i === lo ? -1 : 1; // change to curDiff if we flip
            if (Math.abs(curDiff + wouldFlip * 2) > 2) continue;
            if (homeCount[other] - awayCount[other] < 1) {
              r.home = other; r.away = i;
              homeCount[i]--; awayCount[i]++;
              homeCount[other]++; awayCount[other]--;
              if (i === lo) { mh.home--; mh.away++; }
              else { mh.away--; mh.home++; }
              anyFixed = true;
              break;
            }
          }
        }
      } else if (awayCount[i] - homeCount[i] > 1) {
        for (const r of teamGamesIdx.get(i)) {
          if (r.away === i) {
            const other = r.home;
            const key = matchupKey(i, other);
            const mh = matchupHA.get(key);
            const lo = Math.min(i, other);
            const curDiff = mh.home - mh.away;
            const wouldFlip = i === lo ? 1 : -1;
            if (Math.abs(curDiff + wouldFlip * 2) > 2) continue;
            if (awayCount[other] - homeCount[other] < 1) {
              r.away = other; r.home = i;
              awayCount[i]--; homeCount[i]++;
              awayCount[other]++; homeCount[other]--;
              if (i === lo) { mh.home++; mh.away--; }
              else { mh.away++; mh.home--; }
              anyFixed = true;
              break;
            }
          }
        }
      }
    }
    if (!anyFixed) break;
  }


  return result;
}

// ─── Module 3b: Post-Hoc Home/Away Rebalancing ─────────────────────────────
function rebalanceHomeAway(schedule, numTeams, gamesPerTeam) {
  const target = gamesPerTeam / 2;

  // Build per-team game index (game objects are shared references, so flips are visible)
  const teamGamesIdx = new Map();
  for (let t = 0; t < numTeams; t++) teamGamesIdx.set(t, []);
  for (const g of schedule) {
    teamGamesIdx.get(g.home).push(g);
    teamGamesIdx.get(g.away).push(g);
  }

  // excess[t] = homeCount[t] - target; positive = too many homes
  const excess = new Array(numTeams).fill(0);
  for (const g of schedule) excess[g.home]++;
  for (let t = 0; t < numTeams; t++) excess[t] -= target;

  // Greedy pass: flip games where home team has excess > 0 and away team has excess < 0
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of schedule) {
      if (excess[g.home] > 0 && excess[g.away] < 0) {
        const oldHome = g.home, oldAway = g.away;
        g.home = oldAway;
        g.away = oldHome;
        excess[oldHome]--;
        excess[oldAway]++;
        changed = true;
      }
    }
  }

  // Chain pass: find 2-hop paths through intermediate teams at excess 0
  for (let t = 0; t < numTeams; t++) {
    while (excess[t] > 0) {
      let flipped = false;
      for (const g1 of teamGamesIdx.get(t)) {
        if (g1.home !== t) continue;
        const mid = g1.away;
        if (excess[mid] < 0) continue;
        for (const g2 of teamGamesIdx.get(mid)) {
          if (g2.home !== mid) continue;
          const dest = g2.away;
          if (excess[dest] >= 0) continue;
          // Flip both: t->mid becomes mid->t, mid->dest becomes dest->mid
          // t loses a home, dest gains a home, mid nets to 0
          g1.home = mid; g1.away = t;
          g2.home = dest; g2.away = mid;
          excess[t]--;
          excess[dest]++;
          flipped = true;
          break;
        }
        if (flipped) break;
      }
      if (!flipped) break;
    }
  }
}

// ─── Module 4: Build Schedule (Round-Robin Tournament Approach) ─────────────
function tryBuildSchedule(games, slots, numTeams, onProgress, precomputedMatchups) {
  const totalGames = games.length;
  if (slots.length < totalGames) {
    throw new Error(`Not enough slots: need ${totalGames} games but only ${slots.length} slots available.`);
  }

  // Scarcity map: sortKey → number of other divisions that also need this slot
  // Higher values mean we should avoid claiming this slot if alternatives exist
  const slotScarcity = (precomputedMatchups && precomputedMatchups.slotScarcity) || null;

  // Precompute date-to-day-number map to avoid Date allocations in hot loops
  const dateToDay = new Map();
  const dateToDow = new Map(); // date → day-of-week (0=Sun..6=Sat)
  const dateToWeekdayWeek = new Map(); // date → isoWeek key (only for weekdays, null for weekends)
  for (const s of slots) {
    if (!dateToDay.has(s.date)) {
      dateToDay.set(s.date, Math.round(new Date(s.date + 'T00:00:00') / 86400000));
      const dow = new Date(s.date + 'T00:00:00').getDay();
      dateToDow.set(s.date, dow);
      dateToWeekdayWeek.set(s.date, (dow >= 1 && dow <= 5) ? isoWeek(s.date) : null);
    }
  }
  // Binary search for nearest day distance in a sorted array of day-numbers
  function nearestDayDistance(sortedDays, targetDay) {
    const arr = sortedDays;
    if (arr.length === 0) return 14;
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < targetDay) lo = mid + 1;
      else hi = mid;
    }
    let best = Math.abs(arr[lo] - targetDay);
    if (lo > 0) best = Math.min(best, Math.abs(arr[lo - 1] - targetDay));
    return Math.min(best, 14);
  }

  // Insert a value into a sorted array in order (binary search insertion)
  function insertSorted(arr, val) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < val) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, val);
  }

  // End-of-season tracking (soft penalty, but still tracked for recordAssignment)
  const allDates = [...new Set(slots.map(s => s.date))].sort();
  const seasonEndDate = allDates[allDates.length - 1];
  const endOfSeasonCutoff = addDays(seasonEndDate, -4); // 5-day window inclusive

  // Identify weekend groups from slots
  const weekendGroupSet = new Set();
  for (const s of slots) {
    if (s.weekendGroup) weekendGroupSet.add(s.weekendGroup);
  }
  const weekendGroups = [...weekendGroupSet].sort();
  const numWeekends = weekendGroups.length;

  // Group weekend slots by weekendGroup
  const weekendSlotsByGroup = new Map();
  for (const wg of weekendGroups) {
    weekendSlotsByGroup.set(wg, []);
  }
  for (const s of slots) {
    if (s.weekendGroup && weekendSlotsByGroup.has(s.weekendGroup)) {
      weekendSlotsByGroup.get(s.weekendGroup).push(s);
    }
  }

  // Weekday slots
  const weekdaySlots = slots.filter(s => !s.weekendGroup);

  // Determine how many games per team from the data
  const gamesPerTeam = totalGames * 2 / numTeams;

  // Use precomputed matchups if provided, otherwise generate from tournament rounds
  let weekendRounds, weekdayGames;
  if (precomputedMatchups) {
    ({ weekendRounds, weekdayGames } = precomputedMatchups);
  } else {
    const rounds = generateTournamentRounds(numTeams);
    ({ weekendRounds, weekdayGames } = selectMatchups(rounds, numTeams, gamesPerTeam, numWeekends));
  }

  // Convert tournament [a,b] pairs to {home, away} using the provided games' H/A assignments
  // Build a lookup from the input games
  const haLookup = new Map();
  const gameCounts = new Map(); // track how many times each pair appears
  for (const g of games) {
    const key = Math.min(g.home, g.away) + ',' + Math.max(g.home, g.away);
    if (!haLookup.has(key)) {
      haLookup.set(key, []);
      gameCounts.set(key, 0);
    }
    haLookup.get(key).push({ home: g.home, away: g.away });
  }

  function getHomeAway(a, b) {
    const key = Math.min(a, b) + ',' + Math.max(a, b);
    const options = haLookup.get(key);
    if (!options || options.length === 0) {
      // Fallback: random assignment
      return Math.random() < 0.5 ? { home: a, away: b } : { home: b, away: a };
    }
    const idx = gameCounts.get(key);
    gameCounts.set(key, idx + 1);
    return options[idx % options.length];
  }

  let bestSchedule = null;
  let bestScore = Infinity;

  function runAttempt(attempt) {
    // Reset the H/A counter each attempt
    for (const key of gameCounts.keys()) gameCounts.set(key, 0);

    const schedule = [];
    const taken = new Set();
    const teamDay = new Map();
    const teamDaySorted = new Map(); // sorted arrays of day-numbers per team
    const teamWeekend = new Map();
    const teamWeek = new Map();
    const teamWeekdayWeek = new Map(); // weekday games per M-F week per team
    const teamField = new Map();
    const lastGameDate = new Map();
    for (let t = 0; t < numTeams; t++) {
      teamDay.set(t, new Set());
      teamDaySorted.set(t, []);
      teamWeekend.set(t, new Map());
      teamWeek.set(t, new Map());
      teamWeekdayWeek.set(t, new Map());
      teamField.set(t, new Map());
    }
    const teamEndGames = new Map(); // games per team in last 5 days
    for (let t = 0; t < numTeams; t++) teamEndGames.set(t, 0);
    let failed = false;
    let runningPenalty = 0; // running estimate of penalties for early exit

    // Shuffle which rounds go to which weekends
    const roundOrder = shuffle([...Array(weekendRounds.length).keys()]);
    // Also shuffle weekday games
    const shuffledWeekdayGames = shuffle(weekdayGames);

    // Phase 1: Assign weekend rounds
    const dateGameCount = new Map(); // track games per date for Sat/Sun spreading
    for (let wi = 0; wi < weekendGroups.length && wi < roundOrder.length; wi++) {
      const wg = weekendGroups[wi];
      const round = weekendRounds[roundOrder[wi]];
      const groupSlots = weekendSlotsByGroup.get(wg);

      const shuffledRound = shuffle(round);

      for (const pair of shuffledRound) {
        const game = getHomeAway(pair[0], pair[1]);
        const { home, away } = game;

        const eligible = groupSlots.filter(s => {
          if (taken.has(s.sortKey)) return false;
          if (teamDay.get(home).has(s.date) || teamDay.get(away).has(s.date)) return false;
          const slotDayNum = dateToDay.get(s.date);
          if (hasThreeInFourDays(teamDaySorted.get(home), slotDayNum) || hasThreeInFourDays(teamDaySorted.get(away), slotDayNum)) return false;
          const wdwk = dateToWeekdayWeek.get(s.date);
          if (wdwk && ((teamWeekdayWeek.get(home).get(wdwk) || 0) >= 1 || (teamWeekdayWeek.get(away).get(wdwk) || 0) >= 1)) return false;
          return true;
        });

        let bestSlot;
        if (eligible.length === 0) {
          const fallback = groupSlots.filter(s => !taken.has(s.sortKey));
          if (fallback.length === 0) { failed = true; break; }
          bestSlot = fallback[Math.floor(Math.random() * fallback.length)];
        } else {
          // Spread across Sat and Sun, prefer underused fields, avoid scarce shared slots
          let bestScore = -Infinity;
          bestSlot = eligible[0];
          for (const s of eligible) {
            let score = -(dateGameCount.get(s.date) || 0);
            score -= (teamField.get(home).get(s.field) || 0) * 0.3;
            score -= (teamField.get(away).get(s.field) || 0) * 0.3;
            if (slotScarcity) score -= (slotScarcity.get(s.sortKey) || 0) * 0.5;
            score += Math.random() * 0.3;
            if (score > bestScore) { bestScore = score; bestSlot = s; }
          }
        }

        taken.add(bestSlot.sortKey);
        dateGameCount.set(bestSlot.date, (dateGameCount.get(bestSlot.date) || 0) + 1);
        recordAssignment(schedule, bestSlot, home, away, teamDay, teamDaySorted, teamWeekend, teamWeek, teamWeekdayWeek, lastGameDate, teamField, teamEndGames, endOfSeasonCutoff, dateToDay, dateToWeekdayWeek, insertSorted);

        // Track weekend double-headers for early exit
        if (bestSlot.weekendGroup) {
          for (const t of [home, away]) {
            const wgCount = teamWeekend.get(t).get(bestSlot.weekendGroup) || 0;
            if (wgCount > 1) {
              // This game just created (or added to) a double-header
              runningPenalty += WEIGHTS.weekendDoubleHeaders;
            }
          }
        }
        if (runningPenalty > bestScore) { failed = true; break; }
      }
      if (failed) return;
    }

    if (failed) return;

    // Phase 1.5: Weekend overflow — place weekday games into unused weekend slots
    // This reduces pressure on Phase 2 when weekday capacity is near the theoretical max.
    const remainingWeekdayGames = [];
    for (const pair of shuffledWeekdayGames) {
      const tA = pair[0], tB = pair[1];

      // Check all unused weekend slots eligible for this game (using raw teams, not H/A)
      let overflowBest = null;
      let overflowBestScore = -Infinity;
      for (const [wg, groupSlots] of weekendSlotsByGroup) {
        for (const s of groupSlots) {
          if (taken.has(s.sortKey)) continue;
          if (teamDay.get(tA).has(s.date) || teamDay.get(tB).has(s.date)) continue;
          const slotDayNum = dateToDay.get(s.date);
          if (hasThreeInFourDays(teamDaySorted.get(tA), slotDayNum) || hasThreeInFourDays(teamDaySorted.get(tB), slotDayNum)) continue;
          // Only overflow into weekends where neither team already has a game (avoid double-headers)
          const hWgCount = teamWeekend.get(tA).get(wg) || 0;
          const aWgCount = teamWeekend.get(tB).get(wg) || 0;
          if (hWgCount >= 1 || aWgCount >= 1) continue;
          let score = 0;
          score -= (dateGameCount.get(s.date) || 0);
          score -= (teamField.get(tA).get(s.field) || 0) * 0.3;
          score -= (teamField.get(tB).get(s.field) || 0) * 0.3;
          if (slotScarcity) score -= (slotScarcity.get(s.sortKey) || 0) * 0.5;
          score += Math.random() * 0.3;
          if (score > overflowBestScore) { overflowBestScore = score; overflowBest = s; }
        }
      }

      if (overflowBest) {
        // Only resolve H/A when actually placing the game
        const game = getHomeAway(tA, tB);
        taken.add(overflowBest.sortKey);
        dateGameCount.set(overflowBest.date, (dateGameCount.get(overflowBest.date) || 0) + 1);
        recordAssignment(schedule, overflowBest, game.home, game.away, teamDay, teamDaySorted, teamWeekend, teamWeek, teamWeekdayWeek, lastGameDate, teamField, teamEndGames, endOfSeasonCutoff, dateToDay, dateToWeekdayWeek, insertSorted);
        if (overflowBest.weekendGroup) {
          for (const t of [game.home, game.away]) {
            const wgCount = teamWeekend.get(t).get(overflowBest.weekendGroup) || 0;
            if (wgCount > 1) runningPenalty += WEIGHTS.weekendDoubleHeaders;
          }
        }
      } else {
        remainingWeekdayGames.push(pair);
      }
    }

    if (runningPenalty > bestScore) return;

    // Phase 2: Assign weekday games via MRV greedy
    // Instead of iterating in random order, dynamically pick the most constrained game first
    const unplacedWeekday = remainingWeekdayGames.slice();
    while (unplacedWeekday.length > 0) {
      // Find the game with the fewest eligible slots (MRV)
      let minEligible = Infinity;
      let bestGameIdx = 0;
      for (let i = 0; i < unplacedWeekday.length; i++) {
        const pair = unplacedWeekday[i];
        const tA = pair[0], tB = pair[1];

        let count = 0;
        for (const s of weekdaySlots) {
          if (taken.has(s.sortKey)) continue;
          if (teamDay.get(tA).has(s.date) || teamDay.get(tB).has(s.date)) continue;
          const slotDayNum = dateToDay.get(s.date);
          if (hasThreeInFourDays(teamDaySorted.get(tA), slotDayNum) || hasThreeInFourDays(teamDaySorted.get(tB), slotDayNum)) continue;
          const wdwk = dateToWeekdayWeek.get(s.date);
          if (wdwk && ((teamWeekdayWeek.get(tA).get(wdwk) || 0) >= 1 || (teamWeekdayWeek.get(tB).get(wdwk) || 0) >= 1)) continue;
          count++;
          if (count >= minEligible) break; // can't beat current best, stop counting
        }

        if (count < minEligible) {
          minEligible = count;
          bestGameIdx = i;
          if (count === 0) break; // can't do better, fail fast
        }
      }

      if (minEligible === 0) { failed = true; break; }

      const pair = unplacedWeekday.splice(bestGameIdx, 1)[0];
      const game = getHomeAway(pair[0], pair[1]);
      const { home, away } = game;

      // Re-filter eligible slots for the chosen game
      const eligible = weekdaySlots.filter(s => {
        if (taken.has(s.sortKey)) return false;
        if (teamDay.get(home).has(s.date) || teamDay.get(away).has(s.date)) return false;
        const slotDayNum = dateToDay.get(s.date);
        if (hasThreeInFourDays(teamDaySorted.get(home), slotDayNum) || hasThreeInFourDays(teamDaySorted.get(away), slotDayNum)) return false;
        const wdwk = dateToWeekdayWeek.get(s.date);
        if (wdwk && ((teamWeekdayWeek.get(home).get(wdwk) || 0) >= 1 || (teamWeekdayWeek.get(away).get(wdwk) || 0) >= 1)) return false;
        return true;
      });

      if (eligible.length === 0) { failed = true; break; }

      let bestSlot = null;
      let bestSlotScore = -Infinity;
      for (const s of eligible) {
        let score = 0;
        // For each team, find the minimum absolute distance from this slot
        // to any existing game date — prefer slots in the biggest schedule gaps
        // Uses binary search on sorted day-number arrays for O(log n) lookup
        const slotDay = dateToDay.get(s.date);
        score += nearestDayDistance(teamDaySorted.get(home), slotDay);
        score += nearestDayDistance(teamDaySorted.get(away), slotDay);

        const hWeekCount = teamWeek.get(home).get(s.week) || 0;
        const aWeekCount = teamWeek.get(away).get(s.week) || 0;
        score -= (hWeekCount + aWeekCount) * 5;

        // Prefer underused fields for both teams
        score -= (teamField.get(home).get(s.field) || 0) * 2;
        score -= (teamField.get(away).get(s.field) || 0) * 2;

        // Avoid slots that other divisions also need
        if (slotScarcity) score -= (slotScarcity.get(s.sortKey) || 0) * 2;

        // LCV: penalize slots in weeks that would constrain remaining games
        const sWdwk = dateToWeekdayWeek.get(s.date);
        if (sWdwk && unplacedWeekday.length <= 20) {
          let futureImpact = 0;
          for (const rp of unplacedWeekday) {
            const ra = rp[0], rb = rp[1];
            if (ra === home || ra === away || rb === home || rb === away) continue;
            if ((teamWeekdayWeek.get(ra).get(sWdwk) || 0) >= 1 || (teamWeekdayWeek.get(rb).get(sWdwk) || 0) >= 1) futureImpact++;
          }
          score -= futureImpact * 0.5;
        }

        score += Math.random() * 0.5;

        if (score > bestSlotScore) {
          bestSlotScore = score;
          bestSlot = s;
        }
      }

      taken.add(bestSlot.sortKey);
      recordAssignment(schedule, bestSlot, home, away, teamDay, teamDaySorted, teamWeekend, teamWeek, teamWeekdayWeek, lastGameDate, teamField, teamEndGames, endOfSeasonCutoff, dateToDay, dateToWeekdayWeek, insertSorted);

      if (runningPenalty > bestScore) { failed = true; break; }
    }

    if (failed) return;

    const score = scoreCandidate(schedule, numTeams, slots);
    if (score < bestScore) {
      bestScore = score;
      bestSchedule = schedule;
    }
  }

  return new Promise(function (resolve, reject) {
    var attempt = 0;
    function step() {
      // Run a batch of attempts before yielding
      var batchEnd = Math.min(attempt + 5, NUM_ATTEMPTS);
      for (; attempt < batchEnd; attempt++) {
        runAttempt(attempt);
      }
      if (onProgress) onProgress(attempt / NUM_ATTEMPTS, bestScore);
      if (attempt < NUM_ATTEMPTS) {
        setTimeout(step, 0);
      } else {
        if (!bestSchedule) {
          reject(new Error('Could not build a valid schedule after ' + NUM_ATTEMPTS + ' attempts. Try adding more slots or reducing games per team.'));
        } else {
          resolve({ schedule: bestSchedule, score: bestScore, details: scoreDetails(bestSchedule, numTeams, slots) });
        }
      }
    }
    step();
  });
}

// Entry point called by ui.js — handles matchup generation, H/A, and scheduling in one call
function buildSchedule(numTeams, gamesPerTeam, slots, onProgress, options) {
  options = options || {};
  const leagueSplit = options.leagueSplit || false;
  const slotScarcity = options.slotScarcity || null;

  // Determine weekend count from slots so selectMatchups uses the same pairs as scheduling
  const weekendGroupSet = new Set();
  for (const s of slots) {
    if (s.weekendGroup) weekendGroupSet.add(s.weekendGroup);
  }
  const numWeekends = weekendGroupSet.size;

  let weekendRounds, weekdayGames;
  if (leagueSplit) {
    const err = validateLeagueSplit(numTeams, gamesPerTeam);
    if (err) throw new Error(err);
    ({ weekendRounds, weekdayGames } = selectMatchupsWithLeagues(numTeams, gamesPerTeam, numWeekends));
  } else {
    const rounds = generateTournamentRounds(numTeams);
    ({ weekendRounds, weekdayGames } = selectMatchups(rounds, numTeams, gamesPerTeam, numWeekends));
  }

  // Flatten the actual selected pairs, then assign H/A on exactly those pairs
  const allPairs = [];
  for (const round of weekendRounds) {
    for (const pair of round) allPairs.push({ teamA: pair[0], teamB: pair[1] });
  }
  for (const pair of weekdayGames) allPairs.push({ teamA: pair[0], teamB: pair[1] });

  const haGames = assignHomeAway(allPairs, numTeams);
  const games = haGames.map(g => ({ home: g.home, away: g.away }));
  return tryBuildSchedule(games, slots, numTeams, onProgress, { weekendRounds, weekdayGames, slotScarcity }).then(result => {
    return annealSchedule(result.schedule, numTeams, slots).then(saResult => {
      if (saResult.improved) {
        result.schedule = saResult.schedule;
      }
      rebalanceHomeAway(result.schedule, numTeams, gamesPerTeam);
      result.details = scoreDetails(result.schedule, numTeams, slots);
      return result;
    });
  });
}

// Helper to record a game assignment and update tracking structures
function recordAssignment(schedule, slot, home, away, teamDay, teamDaySorted, teamWeekend, teamWeek, teamWeekdayWeek, lastGameDate, teamField, teamEndGames, endOfSeasonCutoff, dateToDay, dateToWeekdayWeek, insertSorted) {
  teamDay.get(home).add(slot.date);
  teamDay.get(away).add(slot.date);
  const dayNum = dateToDay.get(slot.date);
  insertSorted(teamDaySorted.get(home), dayNum);
  insertSorted(teamDaySorted.get(away), dayNum);
  if (slot.weekendGroup) {
    const hwm = teamWeekend.get(home);
    hwm.set(slot.weekendGroup, (hwm.get(slot.weekendGroup) || 0) + 1);
    const awm = teamWeekend.get(away);
    awm.set(slot.weekendGroup, (awm.get(slot.weekendGroup) || 0) + 1);
  }
  const hwk = teamWeek.get(home);
  hwk.set(slot.week, (hwk.get(slot.week) || 0) + 1);
  const awk = teamWeek.get(away);
  awk.set(slot.week, (awk.get(slot.week) || 0) + 1);
  if (teamWeekdayWeek && dateToWeekdayWeek) {
    const wdwk = dateToWeekdayWeek.get(slot.date);
    if (wdwk) {
      const hwdw = teamWeekdayWeek.get(home);
      hwdw.set(wdwk, (hwdw.get(wdwk) || 0) + 1);
      const awdw = teamWeekdayWeek.get(away);
      awdw.set(wdwk, (awdw.get(wdwk) || 0) + 1);
    }
  }
  lastGameDate.set(home, slot.date);
  lastGameDate.set(away, slot.date);
  if (teamField) {
    const hf = teamField.get(home);
    hf.set(slot.field, (hf.get(slot.field) || 0) + 1);
    const af = teamField.get(away);
    af.set(slot.field, (af.get(slot.field) || 0) + 1);
  }
  if (teamEndGames && endOfSeasonCutoff && slot.date >= endOfSeasonCutoff) {
    teamEndGames.set(home, teamEndGames.get(home) + 1);
    teamEndGames.set(away, teamEndGames.get(away) + 1);
  }

  schedule.push({
    date: slot.date,
    dayOfWeek: slot.dayOfWeek,
    time: slot.time,
    field: slot.field,
    home,
    away
  });
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
function scoreCandidate(schedule, numTeams, slots) {
  const d = scoreDetails(schedule, numTeams, slots);
  let score = 0;
  for (const key in WEIGHTS) {
    if (d[key] != null) score += d[key] * WEIGHTS[key];
  }
  return score;
}

function scoreDetails(schedule, numTeams, allSlots) {
  const gamesPerTeam = schedule.length * 2 / numTeams;

  const teamGames = new Map();
  for (let t = 0; t < numTeams; t++) teamGames.set(t, []);
  for (const g of schedule) {
    teamGames.get(g.home).push(g);
    teamGames.get(g.away).push(g);
  }

  const teamSortedDates = new Map();
  for (let t = 0; t < numTeams; t++) {
    teamSortedDates.set(t, teamGames.get(t).map(g => g.date).sort());
  }

  const activeWeekends = new Set();
  for (const s of allSlots) {
    if (s.weekendGroup) activeWeekends.add(s.weekendGroup);
  }
  const numActiveWeekends = activeWeekends.size;

  const activeBuckets = new Set();
  for (const s of allSlots) activeBuckets.add(slotBucket(s.dayOfWeek, s.time));

  const activeFields = new Set();
  for (const s of allSlots) activeFields.add(s.field);
  const numFields = activeFields.size;

  const weekdaySlotCount = allSlots.filter(s => !s.weekendGroup).length;

  let weekendSitouts = 0;
  for (let t = 0; t < numTeams; t++) {
    const teamWeekends = new Set();
    for (const g of teamGames.get(t)) {
      const wg = getWeekendGroup(g.date);
      if (wg) teamWeekends.add(wg);
    }
    let sitouts = 0;
    for (const wg of activeWeekends) {
      if (!teamWeekends.has(wg)) sitouts++;
    }
    // If a team has fewer games than weekends, some sitouts are unavoidable
    const totalGames = teamGames.get(t).length;
    const expectedSitouts = Math.max(0, numActiveWeekends - totalGames);
    weekendSitouts += Math.max(0, sitouts - expectedSitouts);
  }

  let weekendDoubleHeaders = 0;
  for (let t = 0; t < numTeams; t++) {
    const wgCount = new Map();
    for (const g of teamGames.get(t)) {
      const wg = getWeekendGroup(g.date);
      if (wg) wgCount.set(wg, (wgCount.get(wg) || 0) + 1);
    }
    for (const [, c] of wgCount) {
      if (c > 1) weekendDoubleHeaders += c - 1;
    }
  }
  const maxWeekdayGamesPerTeam = Math.min(gamesPerTeam, Math.floor(weekdaySlotCount * 2 / numTeams));
  const minWeekendGamesPerTeam = gamesPerTeam - maxWeekdayGamesPerTeam;
  const minDHPerTeam = Math.max(0, minWeekendGamesPerTeam - numActiveWeekends);
  const minWeekendDH = minDHPerTeam * numTeams;

  let gapVariance = 0;
  for (let t = 0; t < numTeams; t++) {
    const dates = teamSortedDates.get(t);
    if (dates.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(daysBetween(dates[i - 1], dates[i]));
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
    gapVariance += Math.sqrt(variance);
  }


  let shortGapPenalty = 0;
  for (let t = 0; t < numTeams; t++) {
    const dates = teamSortedDates.get(t);
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetween(dates[i - 1], dates[i]);
      if (gap > 0) shortGapPenalty += 1 / gap;
    }
  }

  // Time-slot distribution: variance of weekend bucket counts per team
  // Only weekend buckets (WE_MORN, WE_AFT) — weekday time distribution is less meaningful
  const weekendBuckets = [...activeBuckets].filter(b => b === 'WE_MORN' || b === 'WE_AFT');
  let timeDistribution = 0;
  if (weekendBuckets.length > 1) {
    for (let t = 0; t < numTeams; t++) {
      const bucketCounts = new Map();
      for (const b of weekendBuckets) bucketCounts.set(b, 0);
      for (const g of teamGames.get(t)) {
        const b = slotBucket(g.dayOfWeek, g.time);
        if (bucketCounts.has(b)) bucketCounts.set(b, bucketCounts.get(b) + 1);
      }
      const vals = [...bucketCounts.values()];
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      timeDistribution += vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
    }
  }

  // Field balance: variance of field counts per team
  let fieldBalance = 0;
  if (numFields > 1) {
    for (let t = 0; t < numTeams; t++) {
      const fieldCounts = new Map();
      for (const f of activeFields) fieldCounts.set(f, 0);
      for (const g of teamGames.get(t)) {
        fieldCounts.set(g.field, (fieldCounts.get(g.field) || 0) + 1);
      }
      const vals = [...fieldCounts.values()];
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      fieldBalance += vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
    }
  }

  // Early season density: pairs of games within 2 days in first 7 days
  const allDates = [...new Set(schedule.map(g => g.date))].sort();
  const seasonStartDate = allDates[0];
  const earlySeasonCutoff = addDays(seasonStartDate, 6); // first 7 days inclusive
  let earlySeasonDensity = 0;
  for (let t = 0; t < numTeams; t++) {
    const dates = teamSortedDates.get(t);
    const early = dates.filter(d => d >= seasonStartDate && d <= earlySeasonCutoff);
    for (let i = 0; i + 1 < early.length; i++) {
      if (daysBetween(early[i], early[i + 1]) <= 2) earlySeasonDensity++;
    }
  }

  // End of season density: games beyond 1 per team in last 5 days
  const seasonEndDate = allDates[allDates.length - 1];
  const endOfSeasonCutoff = addDays(seasonEndDate, -4);
  let endOfSeasonDensity = 0;
  for (let t = 0; t < numTeams; t++) {
    const dates = teamSortedDates.get(t);
    const endGames = dates.filter(d => d >= endOfSeasonCutoff).length;
    if (endGames > 1) endOfSeasonDensity += endGames - 1;
  }

  // Weekend B2B timeslot: penalize when 2nd day of Fri/Sat or Sat/Sun b2b has earlier timeslot
  let weekendBTBTimePenalty = 0;
  for (let t = 0; t < numTeams; t++) {
    const games = teamGames.get(t);
    const gamesByDate = new Map();
    for (const g of games) {
      if (!gamesByDate.has(g.date)) gamesByDate.set(g.date, g);
    }
    for (const g of games) {
      const prevDay = addDays(g.date, -1);
      const prevGame = gamesByDate.get(prevDay);
      if (prevGame) {
        const prevDow = new Date(prevDay + 'T00:00:00').getDay();
        const curDow = new Date(g.date + 'T00:00:00').getDay();
        const isFriSat = (prevDow === 5 && curDow === 6);
        const isSatSun = (prevDow === 6 && curDow === 0);
        if (isFriSat || isSatSun) {
          if (timeSortKey(g.time) < timeSortKey(prevGame.time)) {
            weekendBTBTimePenalty++;
          }
        }
      }
    }
  }

  // Sat/Sun balance: variance of proportion Saturday per team
  let satSunBalance = 0;
  for (let t = 0; t < numTeams; t++) {
    let satCount = 0, sunCount = 0;
    for (const g of teamGames.get(t)) {
      const dow = new Date(g.date + 'T00:00:00').getDay();
      if (dow === 6) satCount++;
      if (dow === 0) sunCount++;
    }
    const total = satCount + sunCount;
    if (total > 0) {
      const proportion = satCount / total;
      satSunBalance += (proportion - 0.5) ** 2;
    }
  }

  return {
    weekendSitouts, weekendDoubleHeaders, gapVariance: Math.round(gapVariance * 100) / 100,
    shortGapPenalty: Math.round(shortGapPenalty * 100) / 100,
    timeDistribution: Math.round(timeDistribution * 100) / 100,
    fieldBalance: Math.round(fieldBalance * 100) / 100,
    earlySeasonDensity, endOfSeasonDensity,
    weekendBTBTimePenalty,
    satSunBalance: Math.round(satSunBalance * 100) / 100,
    minWeekendDH
  };
}

// ─── Module 4b: Simulated Annealing ─────────────────────────────────────────
function annealSchedule(schedule, numTeams, slots, maxIterations) {
  if (!maxIterations) maxIterations = 500;
  const current = schedule.map(g => ({...g}));
  let currentScore = scoreCandidate(current, numTeams, slots);
  const initialScore = currentScore;
  let bestSchedule = current.map(g => ({...g}));
  let bestScore = currentScore;

  // Build date → game indices map for same-date swaps
  function buildDateIndex() {
    const map = new Map();
    for (let i = 0; i < current.length; i++) {
      const d = current[i].date;
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(i);
    }
    return map;
  }
  let dateToGameIndices = buildDateIndex();
  const multiGameDates = () => [...dateToGameIndices.entries()].filter(([, idx]) => idx.length >= 2);

  // Hard constraint validation for cross-date swaps (applied after swap)
  function crossDateSwapValid(i, j) {
    const affectedTeams = new Set([current[i].home, current[i].away, current[j].home, current[j].away]);
    for (const t of affectedTeams) {
      const dates = [];
      for (const g of current) {
        if (g.home === t || g.away === t) dates.push(g.date);
      }
      dates.sort();
      // No duplicate dates
      for (let k = 1; k < dates.length; k++) {
        if (dates[k] === dates[k - 1]) return false;
      }
      // No 3 in 4 days
      if (teamHasThreeInFourDays(dates)) return false;
      // No 2 weekday games in same M-F span
      const weekdayByWeek = new Map();
      for (const d of dates) {
        const dt = new Date(d + 'T00:00:00');
        const dow = dt.getDay();
        if (dow >= 1 && dow <= 5) {
          const wk = isoWeek(d);
          weekdayByWeek.set(wk, (weekdayByWeek.get(wk) || 0) + 1);
          if (weekdayByWeek.get(wk) > 1) return false;
        }
      }
    }
    return true;
  }

  function swapSlots(i, j, sameDate) {
    const saved = {
      i: { date: current[i].date, dayOfWeek: current[i].dayOfWeek, time: current[i].time, field: current[i].field },
      j: { date: current[j].date, dayOfWeek: current[j].dayOfWeek, time: current[j].time, field: current[j].field }
    };
    if (sameDate) {
      [current[i].time, current[j].time] = [current[j].time, current[i].time];
      [current[i].field, current[j].field] = [current[j].field, current[i].field];
    } else {
      [current[i].date, current[j].date] = [current[j].date, current[i].date];
      [current[i].dayOfWeek, current[j].dayOfWeek] = [current[j].dayOfWeek, current[i].dayOfWeek];
      [current[i].time, current[j].time] = [current[j].time, current[i].time];
      [current[i].field, current[j].field] = [current[j].field, current[i].field];
    }
    return saved;
  }

  function revertSwap(i, j, saved) {
    Object.assign(current[i], saved.i);
    Object.assign(current[j], saved.j);
  }

  const T_START = 2.0;
  const T_END = 0.01;
  const alpha = Math.pow(T_END / T_START, 1 / maxIterations);
  let T = T_START;

  return new Promise((resolve) => {
    let iter = 0;
    function step() {
      const batchEnd = Math.min(iter + 100, maxIterations);
      for (; iter < batchEnd; iter++) {
        const useSameDate = Math.random() < 0.7;
        let swapI, swapJ, saved, sameDate;

        if (useSameDate) {
          const candidates = multiGameDates();
          if (candidates.length === 0) { T *= alpha; continue; }
          const [, indices] = candidates[Math.floor(Math.random() * candidates.length)];
          const a = Math.floor(Math.random() * indices.length);
          let b = Math.floor(Math.random() * (indices.length - 1));
          if (b >= a) b++;
          swapI = indices[a];
          swapJ = indices[b];
          sameDate = true;
          saved = swapSlots(swapI, swapJ, true);
        } else {
          swapI = Math.floor(Math.random() * current.length);
          swapJ = Math.floor(Math.random() * (current.length - 1));
          if (swapJ >= swapI) swapJ++;
          if (current[swapI].date === current[swapJ].date) { T *= alpha; continue; }
          sameDate = false;
          saved = swapSlots(swapI, swapJ, false);
          if (!crossDateSwapValid(swapI, swapJ)) {
            revertSwap(swapI, swapJ, saved);
            T *= alpha;
            continue;
          }
        }

        const newScore = scoreCandidate(current, numTeams, slots);
        const delta = newScore - currentScore;

        if (delta < 0 || Math.random() < Math.exp(-delta / T)) {
          currentScore = newScore;
          if (!sameDate) dateToGameIndices = buildDateIndex();
          if (currentScore < bestScore) {
            bestScore = currentScore;
            bestSchedule = current.map(g => ({...g}));
          }
        } else {
          revertSwap(swapI, swapJ, saved);
        }

        T *= alpha;
      }
      if (iter < maxIterations) {
        setTimeout(step, 0);
      } else {
        resolve({ schedule: bestSchedule, score: bestScore, improved: bestScore < initialScore });
      }
    }
    step();
  });
}

// ─── Module 5: Format CSV ────────────────────────────────────────────────────
function formatCSV(schedule) {
  const sorted = [...schedule].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ta = timeSortKey(a.time), tb = timeSortKey(b.time);
    if (ta !== tb) return ta - tb;
    return a.field < b.field ? -1 : 1;
  });

  const lines = ['Day,Date,Time,Field,Away Team,Home Team'];
  for (const g of sorted) {
    const d = new Date(g.date + 'T00:00:00');
    const day = DAYS[d.getDay()];
    const dateDisplay = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    lines.push(`${day},${dateDisplay},${formatTimeDisplay(g.time)},${g.field},${g.away + 1}B,${g.home + 1}B`);
  }
  return lines.join('\n');
}
