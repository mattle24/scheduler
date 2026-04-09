import { shuffle } from './utils.js';

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

export { generateTournamentRounds, selectMatchups, selectMatchupsWithLeagues, validateLeagueSplit, assignHomeAway, rebalanceHomeAway };
