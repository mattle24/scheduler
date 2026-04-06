// ─── Constants ───────────────────────────────────────────────────────────────
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const NUM_ATTEMPTS = 200;

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

// Returns true if adding newDate to a team's date set would create 3 consecutive game days
function hasConsecutiveDays(teamDaySet, newDate) {
  // Check 3 windows of length 3 that include newDate
  const p2 = addDays(newDate, -2), p1 = addDays(newDate, -1);
  const n1 = addDays(newDate, 1), n2 = addDays(newDate, 2);
  if (teamDaySet.has(p2) && teamDaySet.has(p1)) return true;
  if (teamDaySet.has(p1) && teamDaySet.has(n1)) return true;
  if (teamDaySet.has(n1) && teamDaySet.has(n2)) return true;
  return false;
}

// Returns true if a sorted array of date strings contains 3 consecutive calendar days
function teamHasConsecutiveDays(datesArray) {
  const sorted = [...datesArray].sort();
  for (let i = 0; i + 2 < sorted.length; i++) {
    if (daysBetween(sorted[i], sorted[i + 2]) === 2) return true;
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
      for (const r of result) {
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
        for (const r of result) {
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
        for (const r of result) {
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

// ─── Module 4: Build Schedule (Round-Robin Tournament Approach) ─────────────
function tryBuildSchedule(games, slots, numTeams) {
  const totalGames = games.length;
  if (slots.length < totalGames) {
    throw new Error(`Not enough slots: need ${totalGames} games but only ${slots.length} slots available.`);
  }

  // Recover tournament structure: figure out how many teams and rebuild rounds
  // from the games we were given (which already have home/away assigned)
  const rounds = generateTournamentRounds(numTeams);

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

  // Select matchups split into weekend rounds and weekday games
  const { weekendRounds, weekdayGames } = selectMatchups(rounds, numTeams, gamesPerTeam, numWeekends);

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

  for (let attempt = 0; attempt < NUM_ATTEMPTS; attempt++) {
    // Reset the H/A counter each attempt
    for (const key of gameCounts.keys()) gameCounts.set(key, 0);

    const schedule = [];
    const taken = new Set();
    const teamDay = new Map();
    const teamWeekend = new Map();
    const teamWeek = new Map();
    const teamField = new Map();
    const lastGameDate = new Map();
    for (let t = 0; t < numTeams; t++) {
      teamDay.set(t, new Set());
      teamWeekend.set(t, new Map());
      teamWeek.set(t, new Map());
      teamField.set(t, new Map());
    }
    let failed = false;

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

        const eligible = groupSlots.filter(s =>
          !taken.has(s.sortKey) &&
          !teamDay.get(home).has(s.date) &&
          !teamDay.get(away).has(s.date) &&
          !hasConsecutiveDays(teamDay.get(home), s.date) &&
          !hasConsecutiveDays(teamDay.get(away), s.date)
        );

        let bestSlot;
        if (eligible.length === 0) {
          const fallback = groupSlots.filter(s => !taken.has(s.sortKey));
          if (fallback.length === 0) { failed = true; break; }
          bestSlot = fallback[Math.floor(Math.random() * fallback.length)];
        } else {
          // Spread across Sat and Sun, prefer underused fields
          let bestScore = -Infinity;
          bestSlot = eligible[0];
          for (const s of eligible) {
            let score = -(dateGameCount.get(s.date) || 0);
            score -= (teamField.get(home).get(s.field) || 0) * 0.3;
            score -= (teamField.get(away).get(s.field) || 0) * 0.3;
            score += Math.random() * 0.3;
            if (score > bestScore) { bestScore = score; bestSlot = s; }
          }
        }

        taken.add(bestSlot.sortKey);
        dateGameCount.set(bestSlot.date, (dateGameCount.get(bestSlot.date) || 0) + 1);
        recordAssignment(schedule, bestSlot, home, away, teamDay, teamWeekend, teamWeek, lastGameDate, teamField);
      }
      if (failed) break;
    }

    if (failed) continue;

    // Phase 2: Assign weekday games via greedy
    for (const pair of shuffledWeekdayGames) {
      const game = getHomeAway(pair[0], pair[1]);
      const { home, away } = game;

      const eligible = weekdaySlots.filter(s =>
        !taken.has(s.sortKey) &&
        !teamDay.get(home).has(s.date) &&
        !teamDay.get(away).has(s.date) &&
        !hasConsecutiveDays(teamDay.get(home), s.date) &&
        !hasConsecutiveDays(teamDay.get(away), s.date)
      );

      if (eligible.length === 0) { failed = true; break; }

      let bestSlot = null;
      let bestSlotScore = -Infinity;
      for (const s of eligible) {
        let score = 0;
        // For each team, find the minimum absolute distance from this slot
        // to any existing game date — prefer slots in the biggest schedule gaps
        const homeDates = teamDay.get(home);
        const awayDates = teamDay.get(away);
        if (homeDates.size > 0) {
          let minDist = Infinity;
          for (const d of homeDates) minDist = Math.min(minDist, Math.abs(daysBetween(d, s.date)));
          score += Math.min(minDist, 14);
        } else {
          score += 14;
        }
        if (awayDates.size > 0) {
          let minDist = Infinity;
          for (const d of awayDates) minDist = Math.min(minDist, Math.abs(daysBetween(d, s.date)));
          score += Math.min(minDist, 14);
        } else {
          score += 14;
        }

        const hWeekCount = teamWeek.get(home).get(s.week) || 0;
        const aWeekCount = teamWeek.get(away).get(s.week) || 0;
        score -= (hWeekCount + aWeekCount) * 5;

        // Prefer underused fields for both teams
        score -= (teamField.get(home).get(s.field) || 0) * 2;
        score -= (teamField.get(away).get(s.field) || 0) * 2;

        score += Math.random() * 0.5;

        if (score > bestSlotScore) {
          bestSlotScore = score;
          bestSlot = s;
        }
      }

      taken.add(bestSlot.sortKey);
      recordAssignment(schedule, bestSlot, home, away, teamDay, teamWeekend, teamWeek, lastGameDate, teamField);
    }

    if (failed) continue;

    const score = scoreCandidate(schedule, numTeams, slots);
    if (score < bestScore) {
      bestScore = score;
      bestSchedule = schedule;
    }
  }

  if (!bestSchedule) {
    throw new Error('Could not build a valid schedule after ' + NUM_ATTEMPTS + ' attempts. Try adding more slots or reducing games per team.');
  }

  return { schedule: bestSchedule, score: bestScore, details: scoreDetails(bestSchedule, numTeams, slots) };
}

// Entry point called by ui.js — handles matchup generation, H/A, and scheduling in one call
function buildSchedule(numTeams, gamesPerTeam, slots) {
  // Determine weekend count from slots so selectMatchups uses the same pairs as scheduling
  const weekendGroupSet = new Set();
  for (const s of slots) {
    if (s.weekendGroup) weekendGroupSet.add(s.weekendGroup);
  }
  const numWeekends = weekendGroupSet.size;

  const rounds = generateTournamentRounds(numTeams);
  const { weekendRounds, weekdayGames } = selectMatchups(rounds, numTeams, gamesPerTeam, numWeekends);

  // Flatten the actual selected pairs, then assign H/A on exactly those pairs
  const allPairs = [];
  for (const round of weekendRounds) {
    for (const pair of round) allPairs.push({ teamA: pair[0], teamB: pair[1] });
  }
  for (const pair of weekdayGames) allPairs.push({ teamA: pair[0], teamB: pair[1] });

  const haGames = assignHomeAway(allPairs, numTeams);
  const games = haGames.map(g => ({ home: g.home, away: g.away }));
  return tryBuildSchedule(games, slots, numTeams);
}

// Helper to record a game assignment and update tracking structures
function recordAssignment(schedule, slot, home, away, teamDay, teamWeekend, teamWeek, lastGameDate, teamField) {
  teamDay.get(home).add(slot.date);
  teamDay.get(away).add(slot.date);
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
  lastGameDate.set(home, slot.date);
  lastGameDate.set(away, slot.date);
  if (teamField) {
    const hf = teamField.get(home);
    hf.set(slot.field, (hf.get(slot.field) || 0) + 1);
    const af = teamField.get(away);
    af.set(slot.field, (af.get(slot.field) || 0) + 1);
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
  return d.weekendSitouts * 12 + d.weekdayBackToBack * 10 + d.weekendDoubleHeaders * 8 + d.crossBoundaryBTB * 7 + d.gapVariance * 6
    + d.rollingDensity * 5 + d.sixDayDensity * 5 + d.weeklyClumps * 4 + d.shortGapPenalty * 3 + d.timeDistribution * 3 + d.fieldBalance * 4;
}

function scoreDetails(schedule, numTeams, allSlots) {
  const gamesPerTeam = schedule.length * 2 / numTeams;

  const teamGames = new Map();
  for (let t = 0; t < numTeams; t++) teamGames.set(t, []);
  for (const g of schedule) {
    teamGames.get(g.home).push(g);
    teamGames.get(g.away).push(g);
  }

  const activeWeekends = new Set();
  for (const s of allSlots) {
    if (s.weekendGroup) activeWeekends.add(s.weekendGroup);
  }
  const numActiveWeekends = activeWeekends.size;

  const weekdaySlotCount = allSlots.filter(s => !s.weekendGroup).length;
  const weekendSlotCount = allSlots.filter(s => s.weekendGroup).length;

  const allWeeks = new Set();
  for (const s of allSlots) allWeeks.add(s.week);
  const numWeeks = allWeeks.size;

  let weekendSitouts = 0;
  for (let t = 0; t < numTeams; t++) {
    const teamWeekends = new Set();
    for (const g of teamGames.get(t)) {
      const wg = getWeekendGroup(g.date);
      if (wg) teamWeekends.add(wg);
    }
    for (const wg of activeWeekends) {
      if (!teamWeekends.has(wg)) weekendSitouts++;
    }
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
    const dates = teamGames.get(t).map(g => g.date).sort();
    if (dates.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(daysBetween(dates[i - 1], dates[i]));
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
    gapVariance += Math.sqrt(variance);
  }

  let weeklyClumps = 0;
  for (let t = 0; t < numTeams; t++) {
    const weekCount = new Map();
    for (const g of teamGames.get(t)) {
      const w = isoWeek(g.date);
      weekCount.set(w, (weekCount.get(w) || 0) + 1);
    }
    for (const [, c] of weekCount) {
      if (c > 1) weeklyClumps += c - 1;
    }
  }
  const minClumpsPerTeam = Math.max(0, gamesPerTeam - numWeeks);
  const minWeeklyClumps = minClumpsPerTeam * numTeams;

  let shortGapPenalty = 0;
  let weekdayBackToBack = 0;
  let crossBoundaryBTB = 0;
  for (let t = 0; t < numTeams; t++) {
    const dates = teamGames.get(t).map(g => g.date).sort();
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetween(dates[i - 1], dates[i]);
      if (gap > 0) shortGapPenalty += 1 / gap;
      if (gap === 1) {
        const dow = new Date(dates[i] + 'T00:00:00').getDay();
        const prevDow = new Date(dates[i - 1] + 'T00:00:00').getDay();
        const prevIsWeekday = prevDow >= 1 && prevDow <= 5;
        const curIsWeekday = dow >= 1 && dow <= 5;
        if (prevIsWeekday && curIsWeekday) {
          weekdayBackToBack++;
        } else if (prevIsWeekday !== curIsWeekday) {
          // Fri→Sat (prevDow=5, dow=6) or Sun→Mon (prevDow=0, dow=1)
          crossBoundaryBTB++;
        }
      }
    }
  }

  // Time-slot distribution: variance of bucket counts per team
  // Buckets: WE_MORN, WE_AFT, MON, TUE, WED, THU, FRI
  // Only count buckets that actually have slots available
  const activeBuckets = new Set();
  for (const s of allSlots) activeBuckets.add(slotBucket(s.dayOfWeek, s.time));

  let timeDistribution = 0;
  for (let t = 0; t < numTeams; t++) {
    const bucketCounts = new Map();
    for (const b of activeBuckets) bucketCounts.set(b, 0);
    for (const g of teamGames.get(t)) {
      const b = slotBucket(g.dayOfWeek, g.time);
      bucketCounts.set(b, (bucketCounts.get(b) || 0) + 1);
    }
    const vals = [...bucketCounts.values()];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    timeDistribution += vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
  }

  // Field balance: variance of field counts per team
  const activeFields = new Set();
  for (const s of allSlots) activeFields.add(s.field);
  const numFields = activeFields.size;

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

  // 5-day rolling window density: penalize 3+ games in any 5-day window
  let rollingDensity = 0;
  for (let t = 0; t < numTeams; t++) {
    const dates = teamGames.get(t).map(g => g.date).sort();
    for (let i = 0; i < dates.length; i++) {
      let count = 1;
      for (let j = i + 1; j < dates.length; j++) {
        if (daysBetween(dates[i], dates[j]) <= 4) count++;
        else break;
      }
      if (count >= 3) rollingDensity += (count - 2) * (count - 2);
    }
  }

  // 6-day rolling window: explicit penalties for 3+ games
  // 3 games: 4, 4 games: 12, 5 games: 20
  const sixDayPenalties = [0, 0, 0, 4, 12, 20];
  let sixDayDensity = 0;
  for (let t = 0; t < numTeams; t++) {
    const dates = teamGames.get(t).map(g => g.date).sort();
    for (let i = 0; i < dates.length; i++) {
      let count = 1;
      for (let j = i + 1; j < dates.length; j++) {
        if (daysBetween(dates[i], dates[j]) <= 5) count++;
        else break;
      }
      if (count >= 3) sixDayDensity += count < sixDayPenalties.length ? sixDayPenalties[count] : sixDayPenalties[5] + (count - 5) * 20;
    }
  }

  return {
    weekendSitouts, weekendDoubleHeaders, gapVariance: Math.round(gapVariance * 100) / 100,
    weeklyClumps, weekdayBackToBack, crossBoundaryBTB, shortGapPenalty: Math.round(shortGapPenalty * 100) / 100,
    rollingDensity, sixDayDensity,
    timeDistribution: Math.round(timeDistribution * 100) / 100,
    fieldBalance: Math.round(fieldBalance * 100) / 100,
    minWeekendDH, minWeeklyClumps
  };
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
    lines.push(`${day},${dateDisplay},${formatTimeDisplay(g.time)},${g.field},Team ${g.away + 1},Team ${g.home + 1}`);
  }
  return lines.join('\n');
}
