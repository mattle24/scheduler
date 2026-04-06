/**
 * Simulated annealing refinement for the greedy schedule.
 *
 * Expects scoreCandidate, getWeekendGroup, isoWeek, daysBetween, and shuffle
 * to already be defined globally (from scheduler.js).
 */
function anneal(schedule, slots, numTeams, onProgress) {
  // Clone the schedule so we don't mutate the input.
  var current = schedule.map(function (g) {
    return {
      date: g.date,
      dayOfWeek: g.dayOfWeek,
      time: g.time,
      field: g.field,
      home: g.home,
      away: g.away
    };
  });

  // Build a set of used slot keys for O(1) lookup.
  function slotKey(date, time, field) {
    return date + "|" + time + "|" + field;
  }

  var usedSlots = {};
  for (var i = 0; i < current.length; i++) {
    usedSlots[slotKey(current[i].date, current[i].time, current[i].field)] = true;
  }

  // Pre-index slots array by key for quick property lookup during relocate.
  var slotsByKey = {};
  for (var i = 0; i < slots.length; i++) {
    var s = slots[i];
    slotsByKey[slotKey(s.date, s.time, s.field)] = s;
  }

  // Hard constraint: check that the given teams don't play twice on the same
  // day anywhere in the schedule. Only inspects the teams listed.
  function hassameDayConflict(teamsToCheck) {
    // Build a set of (team, date) pairs for the affected teams.
    var seen = {};
    for (var i = 0; i < current.length; i++) {
      var g = current[i];
      var homeAffected = teamsToCheck[g.home];
      var awayAffected = teamsToCheck[g.away];
      if (homeAffected) {
        var k = g.home + "|" + g.date;
        if (seen[k]) return true;
        seen[k] = true;
      }
      if (awayAffected) {
        var k = g.away + "|" + g.date;
        if (seen[k]) return true;
        seen[k] = true;
      }
    }
    return false;
  }

  function hasConsecutiveDayConflict(teamsToCheck) {
    var teamDates = {};
    for (var tid in teamsToCheck) {
      teamDates[tid] = [];
    }
    for (var i = 0; i < current.length; i++) {
      var g = current[i];
      if (teamsToCheck[g.home]) teamDates[g.home].push(g.date);
      if (teamsToCheck[g.away]) teamDates[g.away].push(g.date);
    }
    for (var tid in teamDates) {
      if (teamHasConsecutiveDays(teamDates[tid])) return true;
    }
    return false;
  }

  var currentScore = scoreCandidate(current, numTeams, slots);
  var bestSchedule = current.map(function (g) {
    return {
      date: g.date,
      dayOfWeek: g.dayOfWeek,
      time: g.time,
      field: g.field,
      home: g.home,
      away: g.away
    };
  });
  var bestScore = currentScore;

  // Scale iterations with problem size — more games need more exploration
  var iterations = Math.max(5000, current.length * 80);
  var tStart = currentScore * 0.3;
  var CHUNK_SIZE = 500;

  function runChunk(iter) {
    var chunkEnd = Math.min(iter + CHUNK_SIZE, iterations);
    for (; iter < chunkEnd; iter++) {
      var temperature = tStart * (1 - iter / iterations);

      if (Math.random() < 0.5) {
        // ---- Swap move ----
        var a = Math.floor(Math.random() * current.length);
        var b = Math.floor(Math.random() * current.length);
        if (a === b) continue;

        var ga = current[a];
        var gb = current[b];

        // Save old slot properties.
        var aDate = ga.date, aDow = ga.dayOfWeek, aTime = ga.time, aField = ga.field;
        var bDate = gb.date, bDow = gb.dayOfWeek, bTime = gb.time, bField = gb.field;

        // Apply swap.
        ga.date = bDate; ga.dayOfWeek = bDow; ga.time = bTime; ga.field = bField;
        gb.date = aDate; gb.dayOfWeek = aDow; gb.time = aTime; gb.field = aField;

        // usedSlots stays the same — same set of slot keys, just different games.

        // Hard constraint check — only the four affected teams.
        var affected = {};
        affected[ga.home] = true;
        affected[ga.away] = true;
        affected[gb.home] = true;
        affected[gb.away] = true;

        if (hassameDayConflict(affected) || hasConsecutiveDayConflict(affected)) {
          // Undo.
          ga.date = aDate; ga.dayOfWeek = aDow; ga.time = aTime; ga.field = aField;
          gb.date = bDate; gb.dayOfWeek = bDow; gb.time = bTime; gb.field = bField;
          continue;
        }

        var newScore = scoreCandidate(current, numTeams, slots);
        var delta = newScore - currentScore;

        if (delta < 0 || Math.random() < Math.exp(-delta / temperature)) {
          // Accept.
          currentScore = newScore;
        } else {
          // Reject — undo.
          ga.date = aDate; ga.dayOfWeek = aDow; ga.time = aTime; ga.field = aField;
          gb.date = bDate; gb.dayOfWeek = bDow; gb.time = bTime; gb.field = bField;
        }
      } else {
        // ---- Relocate move ----
        var gi = Math.floor(Math.random() * current.length);
        var game = current[gi];

        // Pick a random unused slot.  We sample from the full slots array and
        // reject used ones. To avoid an infinite loop when most slots are used,
        // cap attempts.
        var newSlot = null;
        for (var attempt = 0; attempt < 20; attempt++) {
          var candidate = slots[Math.floor(Math.random() * slots.length)];
          var ck = slotKey(candidate.date, candidate.time, candidate.field);
          if (!usedSlots[ck]) {
            newSlot = candidate;
            break;
          }
        }
        if (!newSlot) continue; // no unused slot found

        // Save old slot properties.
        var oldDate = game.date, oldDow = game.dayOfWeek, oldTime = game.time, oldField = game.field;
        var oldKey = slotKey(oldDate, oldTime, oldField);
        var newKey = slotKey(newSlot.date, newSlot.time, newSlot.field);

        // Apply relocate.
        game.date = newSlot.date;
        game.dayOfWeek = newSlot.dayOfWeek;
        game.time = newSlot.time;
        game.field = newSlot.field;

        // Update usedSlots.
        delete usedSlots[oldKey];
        usedSlots[newKey] = true;

        // Hard constraint check — only the two affected teams.
        var affected = {};
        affected[game.home] = true;
        affected[game.away] = true;

        if (hassameDayConflict(affected) || hasConsecutiveDayConflict(affected)) {
          // Undo.
          game.date = oldDate; game.dayOfWeek = oldDow; game.time = oldTime; game.field = oldField;
          delete usedSlots[newKey];
          usedSlots[oldKey] = true;
          continue;
        }

        var newScore = scoreCandidate(current, numTeams, slots);
        var delta = newScore - currentScore;

        if (delta < 0 || Math.random() < Math.exp(-delta / temperature)) {
          // Accept.
          currentScore = newScore;
        } else {
          // Reject — undo.
          game.date = oldDate; game.dayOfWeek = oldDow; game.time = oldTime; game.field = oldField;
          delete usedSlots[newKey];
          usedSlots[oldKey] = true;
        }
      }

      // Track best.
      if (currentScore < bestScore) {
        bestScore = currentScore;
        bestSchedule = current.map(function (g) {
          return {
            date: g.date,
            dayOfWeek: g.dayOfWeek,
            time: g.time,
            field: g.field,
            home: g.home,
            away: g.away
          };
        });
      }
    }
    return iter;
  }

  return new Promise(function (resolve) {
    function step(iter) {
      iter = runChunk(iter);
      if (onProgress) onProgress(iter / iterations, bestScore);
      if (iter < iterations) {
        setTimeout(function () { step(iter); }, 0);
      } else {
        resolve({ schedule: bestSchedule, score: bestScore });
      }
    }
    step(0);
  });
}
