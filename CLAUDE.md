# Agent Context: Little League Scheduler

## Overview
Browser-based little league baseball/softball scheduler. No server, no build tools — plain JS/CSS/HTML. Generates optimized game schedules for one or more divisions from a TSV field-availability matrix. Each division has its own team count, games-per-team, and set of valid fields.

Whenever you make a change, check whether you need to update CLAUDE.md (this file) to keep it correct and up to date.

## Files
- **scheduler.js** (~1100 lines) — Core engine: TSV parsing, round-robin tournament generation, matchup selection (standard + AL/NL league-aware), home/away assignment, greedy schedule builder, scoring/penalty system
- **ui.js** (~370 lines) — Division management UI, multi-division generate loop, per-division rendering (score cards, team summary, schedule table, heatmap), CSV export, penalty weight sync
- **index.html** — Minimal shell with division table, TSV input, penalty weights, and dynamic results container. Loads: styles.css, scheduler.js, ui.js
- **styles.css** — All styling including CSS-only tooltips and heatmap

## Architecture / Pipeline

### Multi-Division Loop (ui.js `generate()`)
Divisions are scheduled sequentially in row order (priority order). For each division:
1. Filter `allSlots` to the division's valid fields, excluding slots already claimed by higher-priority divisions
2. Run the single-division pipeline (below) with filtered slots
3. Add scheduled game slot keys to `claimedKeys` set

Slot claiming uses `sortKey` (format: `"date-timeSortKey-field"`) which uniquely identifies each slot.

**Scarcity-aware claiming**: Before the sequential loop, a `slotScarcity` map is computed — for each slot, the number of *other* divisions that can also use it (based on field overlap). This is passed through `buildSchedule` → `tryBuildSchedule` and used as a soft penalty during slot selection, nudging divisions away from slots that are scarce for other divisions.

**Iterative re-scheduling**: After the initial sequential pass (when >1 division), up to 3 rounds of re-optimization run. Each round releases one division's slots, re-schedules it with the freed pool, and accepts only if the division's weighted score improves. Stops early if no division improves in a round.

### Single-Division Pipeline (scheduler.js)
1. `buildSchedule(numTeams, gamesPerTeam, slots, onProgress, options)` (entry point)
   - `options.leagueSplit` — when true, uses AL/NL league-aware matchup selection
   - `options.slotScarcity` — Map of sortKey → scarcity count, used to penalize shared slots
2. `generateTournamentRounds()` — circle/polygon algorithm, produces perfect matchings
3. `selectMatchups()` — splits rounds into weekend (full rounds) and weekday (remainder)
   - OR `selectMatchupsWithLeagues()` — layered fill: intra-league pairs first, then inter-league, alternating layers
4. `assignHomeAway()` — greedy + 2 repair passes (per-matchup balance, then overall ±1)
5. `tryBuildSchedule()` — Phase 1: weekend rounds to weekend slots; Phase 2: weekday greedy assignment. 200 random attempts, keeps best.
6. `annealSchedule()` — post-greedy simulated annealing: same-date slot swaps (time+field) and cross-date slot swaps with Metropolis acceptance. 2000 iterations, targets timeslot ordering and other soft penalties.

## Key Data Structures
- **Slot**: `{ date, dayOfWeek, weekendGroup, week, field, time, sortKey }`
- **Game**: `{ date, dayOfWeek, time, field, home, away }` (home/away are 0-indexed team IDs)
- **Division config**: `{ name, numTeams, gamesPerTeam, leagueSplit, fields: string[] }` — read from UI division table
- **Division result**: `{ division, schedule, details, greedyDetails, slots }` — collected per-division after scheduling
- **teamDay**: `Map<teamId, Set<dateStrings>>` — tracks which dates each team plays
- **WEIGHTS**: global object with penalty weights, synced from UI inputs before each run

## Scoring System (scoreCandidate / scoreDetails)
Weighted sum of penalties. Current weights in `WEIGHTS` global:
- weekendSitouts (12) — team has zero games on a weekend with available slots; if a team has fewer total games than weekends, that many sitouts are forgiven
- weekendDoubleHeaders (5) — 2+ games in same Sat-Sun weekend
- gapVariance (6) — std dev of gap lengths per team
- shortGapPenalty (3) — sum of 1/gap for all consecutive game pairs
- timeDistribution (3) — variance of weekend time-slot bucket counts per team (WE_MORN/WE_AFT only)
- fieldBalance (4) — variance of field assignment counts per team
- earlySeasonDensity (8) — pairs of games within 2 days in first 7 days of season
- endOfSeasonDensity (8) — games beyond 1 per team in last 5 days of season
- weekendBTBTimePenalty (3) — 2nd day of Fri/Sat or Sat/Sun b2b has earlier timeslot than 1st day
- satSunBalance (4) — variance of proportion Saturday among weekend games per team

`scoreCandidate` and `weightedScore` (ui.js) both use a dynamic loop over WEIGHTS keys.

Users can adjust all weights via collapsible "Penalty Weights" panel in Settings.

## Hard Constraints (enforced in greedy builder + SA)

Show hard constraints in the UI in the penalty weights section.

- No team plays twice on the same day
- No team plays 3+ games in any 4-day window (`hasThreeInFourDays` / `teamHasThreeInFourDays`)
- Max 1 weekday game per Monday–Friday span (`hasWeekdayGameThisWeek`)
- AL/NL split: each team plays every intra-league opponent at least once (`validateLeagueSplit`)

## Multi-Division Scheduling
- User defines divisions in a table: name, team count, games/team, AL/NL split, valid fields
- Field checkboxes populate after TSV is pasted/uploaded (parsed from header row)
- A field can be valid for multiple divisions; divisions compete for shared slots
- Priority = row order in the table; first division gets first pick of slots
- Each division is scored/optimized independently
- Results render per-division: each gets its own score cards, team summary, schedule table, heatmap
- CSV export includes a "Division" column

## AL/NL League Split (optional, per-division)
When a division's "AL/NL" checkbox is enabled:
- AL = odd-numbered teams (1B, 3B, 5B…), NL = even-numbered teams (2B, 4B, 6B…); odd team count → AL gets extra
- Matchup fill order (layered): intra-league layer → inter-league layer → repeat
- Intra-league rounds generated via circle algorithm on each sub-league
- Inter-league rounds generated via bipartite round-robin (round r: AL[i] vs NL[(i+r) % nlSize])
- Hard constraint: gamesPerTeam must be >= max(alSize, nlSize) - 1

## Known Issues
- None

## Conventions
- Dates are ISO strings: "2026-04-11"
- Times are normalized lowercase: "9:00am", "1:00pm"
- Team IDs are 0-indexed internally, displayed as "{n}B" (e.g. "1B", "2B")
- Weekend grouping: keyed by Saturday's date string (Sun maps to preceding Sat)
- ISO week: keyed by Monday's date string

## Date Performance

`new Date()` construction is expensive in hot loops. The greedy builder runs 200 attempts × many games × many candidate slots, so eligibility filters are called millions of times. Key patterns:

- **`dateToDay` map**: Precomputed at the start of `tryBuildSchedule` — maps date strings to day-numbers (integer days since epoch). All date arithmetic in the eligibility filter uses day-number comparisons instead of Date objects.
- **`teamDaySorted`**: Sorted arrays of day-numbers per team. Used by `hasThreeInFourDays` for binary-search-based window checks, and by `nearestDayDistance` for gap scoring.
- **`dateToWeekdayWeek` map**: Precomputed date → isoWeek key (only for weekdays, null for weekends). Combined with `teamWeekdayWeek` tracking map (weekday games per M-F week per team) to enforce the max-1-weekday-per-week constraint via O(1) map lookups instead of iterating dates.
- **`dateToDow` map**: Precomputed date → day-of-week.

**Rule of thumb**: Never create `new Date()` inside an eligibility filter. Precompute any date-derived value into a map keyed by date string at `tryBuildSchedule` init time. The `addDays()` utility is fine for one-off use (constraint helpers, scoring) but too expensive for per-slot-per-game-per-attempt hot paths.

## Glossary

- "divisions" are age groups. These are akin to MLB / AAA / AA / etc.

## Advanced Scheduler Explanation

### Matchup Generation

The core uses the **circle method** for round-robin tournaments (scheduler.js:204-237): fix team 0, rotate teams 1..n-1. For odd team counts, a dummy team is added and its pairings become byes. This produces `n-1` rounds of `floor(n/2)` games each — a perfect 1-factorization of K_n.

Rounds are cycled to reach `totalGames = numTeams * gamesPerTeam / 2`. The first `numWeekends` rounds become weekend rounds (preserving their structure as perfect matchings so no team double-books on a weekend). Remaining games are flattened into a weekday pool.

For **AL/NL league splits** (scheduler.js:245-379), matchup generation uses a layered fill: intra-league rounds (circle algorithm on each sub-league, merged since they're disjoint) alternate with inter-league rounds (bipartite round-robin: `AL[i] vs NL[(i+r) % nlSize]`). Excess games are trimmed by greedily removing pairs where both teams have the highest game counts. The result is re-grouped into valid matchings via greedy set-packing.

### Home/Away Assignment

`assignHomeAway` uses a two-priority system: per-matchup balance (has team A hosted team B more than vice versa?) takes precedence over overall balance (does team A have too many home games total?). Two repair passes follow — pass 1 fixes per-matchup imbalances beyond ±1, pass 2 fixes overall team imbalances beyond ±1. A post-hoc `rebalanceHomeAway` does a greedy flip pass plus a 2-hop chain pass through intermediate teams at excess 0.

### Greedy Builder

`tryBuildSchedule` runs 200 attempts with randomized round-to-weekend mappings and shuffled weekday game order. Each attempt:

- **Phase 1 (weekends)**: For each weekend group, assigns shuffled round games to eligible slots. Slot selection scores by: `-dateGameCount` (spread across Sat/Sun) and `-teamFieldCount * 0.3` (field balance), plus random jitter.
- **Phase 2 (weekdays)**: Greedy slot selection scores by: `min distance to nearest existing game` (fill gaps), `-weekCount * 5` (avoid clustering in one week), `-teamFieldCount * 2` (field balance), plus jitter.

Hard constraints are checked inline via `hasThreeInFourDays` and `hasWeekdayGameThisWeek`. If no eligible slot exists for a weekday game, the attempt fails.

### Scoring Function

`scoreDetails` computes 10 penalty metrics, each multiplied by a user-adjustable weight:

| Metric | What it measures |
|---|---|
| `weekendSitouts` | Weekends where a team has 0 games (forgives unavoidable sitouts) |
| `weekendDoubleHeaders` | Extra games beyond 1 per team per Sat-Sun pair |
| `gapVariance` | Sum of per-team std dev of inter-game gaps |
| `shortGapPenalty` | Sum of `1/gap` for all consecutive game pairs |
| `timeDistribution` | Variance of weekend time-bucket counts per team (WE_MORN/WE_AFT) |
| `fieldBalance` | Variance of field-assignment counts per team |
| `earlySeasonDensity` | Pairs of games within 2 days in first 7 days |
| `endOfSeasonDensity` | Games beyond 1 per team in last 5 days |
| `weekendBTBTimePenalty` | 2nd day of weekend b2b has earlier timeslot |
| `satSunBalance` | Variance of proportion Saturday per team |

### Post-Greedy Simulated Annealing

`annealSchedule` runs 2000 iterations after the greedy builder. Two move types:
- **Same-date slot swap (70%):** Swap time+field between two games on the same date. Always valid since no date-based constraints change. Directly targets timeslot ordering optimization.
- **Cross-date slot swap (30%):** Swap full slot (date, dayOfWeek, time, field) between two games. Validated against hard constraints (3-in-4-days, weekday-per-week, no same-day).

Uses Metropolis acceptance with geometric cooling (T: 2.0 → 0.01). Tracks best schedule seen.

