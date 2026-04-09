# Agent Context: Little League Scheduler

## Overview
Browser-based little league baseball/softball scheduler. No server, no build tools — plain JS/CSS/HTML. Generates optimized game schedules for one or more divisions from a TSV field-availability matrix. Each division has its own team count, games-per-team, and set of valid fields.

Whenever you make a change, check whether you need to update CLAUDE.md (this file) to keep it correct and up to date.

Also check the methodology explainer in index.html to see if the user-facing docs should change.

## Files
- **js/constants.js** — WEIGHTS, WEIGHT_LABELS, WEIGHT_DESCRIPTIONS, DAYS, NUM_ATTEMPTS, and bucket threshold/importance constants
- **js/utils.js** — Date/time helpers (parseDate, dateStr, daysBetween, getWeekendGroup, isoWeek), time slot helpers (normalizeTime, slotBucket, timeSortKey, formatTimeDisplay, slotKey, addDays), shuffle, hasThreeInFourDays, teamHasThreeInFourDays
- **js/parser.js** — parseTSV: parses the field-availability TSV into slot objects
- **js/matchups.js** — Round-robin matchup generation (generateTournamentRounds, selectMatchups, selectMatchupsWithLeagues), AL/NL league validation, fillWeekendByes, assignHomeAway, rebalanceHomeAway
- **js/scoring.js** — scoreCandidate, scoreDetails (all 11 penalty metrics), scoreCrossfieldDivisionClustering, scoreWeekendOtherDivField
- **js/optimizer.js** — Post-greedy optimization: annealSchedule (simulated annealing), consolidateFields, slideCleanup
- **js/builder.js** — Core scheduling pipeline: tryBuildSchedule (greedy builder, 200 attempts), buildSchedule (entry point: matchup gen → greedy → anneal → consolidate → slide → rebalance)
- **js/state.js** — saveState, loadState, debouncedSave (localStorage persistence)
- **js/divisions.js** — Division table UI (addDivisionRow, removeDivisionRow, populateFieldCheckboxes, updateFieldChoices), penalty weight UI (buildPenaltyGrid, syncWeights, resetWeights, togglePenalties), readDivisions, readDivWeightOverrides, clearCachedFields
- **js/render.js** — renderMultiDivisionResults, renderFieldSections, renderDivisionBlock, renderHeatmapInto, formatMultiDivisionCSV, downloadCSV, showError, clearError, setLastCSV
- **js/generate.js** — generate() (multi-division scheduling loop, scarcity-aware, iterative re-optimization), globalScore, weightedScore
- **js/ui.js** — Entry point: restoreState, clearInputs, loadSample, handleFileUpload, DOMContentLoaded init, window.* assignments for onclick handlers
- **index.html** — Minimal shell with division table, TSV input, penalty weights, and dynamic results container. Loads: styles.css, js/ui.js (ES module entry point)
- **styles.css** — All styling including CSS-only tooltips and heatmap

## Architecture / Pipeline

### Multi-Division Loop (js/generate.js `generate()`)
Divisions are scheduled sequentially in row order (priority order). For each division:
1. Filter `allSlots` to the division's valid fields, excluding slots already claimed by higher-priority divisions and slots on excluded days of the week
2. Run the single-division pipeline (below) with filtered slots
3. Add scheduled game slot keys to `claimedKeys` set

Slot claiming uses `sortKey` (format: `"date-timeSortKey-field"`) which uniquely identifies each slot.

**Scarcity-aware claiming**: Before the sequential loop, a `slotScarcity` map is computed — for each slot, the number of *other* divisions that can also use it (based on field overlap and day-of-week exclusions). This is passed through `buildSchedule` → `tryBuildSchedule` and used as a soft penalty during slot selection, nudging divisions away from slots that are scarce for other divisions.

**Iterative re-scheduling**: After the initial sequential pass, up to 3 rounds of re-optimization run for all schedules (including single-division). Each round releases one division's slots, re-schedules it with the freed pool (passing other divisions' games via `otherDivisionGames` for cross-division clustering), and accepts only if the global score (sum of per-division scores + cross-division clustering penalty) improves. Stops early if no division improves in a round. For single-division runs this provides multiple independent greedy+anneal attempts, keeping the best.

### Single-Division Pipeline (js/builder.js)
1. `buildSchedule(numTeams, gamesPerTeam, slots, onProgress, options)` (entry point)
   - `options.leagueSplit` — when true, uses AL/NL league-aware matchup selection
   - `options.slotScarcity` — Map of sortKey → scarcity count, used to penalize shared slots
   - `options.otherDivisionGames` — array of games from other divisions, used for cross-division clustering in slot scoring
2. `generateTournamentRounds()` — circle/polygon algorithm, produces perfect matchings
3. `selectMatchups()` — splits rounds into weekend (full rounds) and weekday (remainder)
   - OR `selectMatchupsWithLeagues()` — layered fill: intra-league pairs first, then inter-league, alternating layers
4. `assignHomeAway()` — greedy + 2 repair passes (per-matchup balance, then overall ±1)
5. `tryBuildSchedule()` — Phase 1: weekend rounds to weekend slots; Phase 1.5: overflow weekday games into unused weekend slots only when no eligible weekday slot exists (back-to-back Sat/Sun allowed, same-day blocked); Phase 2: weekday MRV greedy (most-constrained-game-first with LCV slot scoring). 250 random attempts, keeps best.
6. `annealSchedule()` — post-greedy simulated annealing: 4 move types, 2000 iterations (see below).
7. `consolidateFields()` — moves 1-2 game groups from a sparse field to a same-date field with ≥ as many games, if all games can be packed consecutively and score improves.
8. `slideCleanup()` — for each weekend (field, date) with multiple games, tries all windows of N consecutive available slots and applies the best packing. Repeats until no improvement or 100 passes.
9. `rebalanceHomeAway()` — final greedy home/away rebalancing pass after all field optimization; greedy flip pass plus a 2-hop chain pass through intermediate teams.

## Key Data Structures
- **Slot**: `{ date, dayOfWeek, weekendGroup, week, field, time, sortKey }`
- **Game**: `{ date, dayOfWeek, time, field, home, away }` (home/away are 0-indexed team IDs)
- **Division config**: `{ name, numTeams, gamesPerTeam, leagueSplit, fields: string[], excludedDays: number[] }` — read from UI division table. `excludedDays` contains day-of-week numbers (0=Sun..6=Sat) on which this division cannot be scheduled.
- **Division result**: `{ division, schedule, details, greedyDetails, slots }` — collected per-division after scheduling
- **teamDay**: `Map<teamId, Set<dateStrings>>` — tracks which dates each team plays
- **WEIGHTS**: global object with penalty weights, synced from UI inputs before each run

## Scoring System (scoreCandidate / scoreDetails)
Weighted sum of penalties. Current weights in `WEIGHTS` global:
- weekendSitouts (20) — team has zero games on a weekend with available slots; if a team has fewer total games than weekends, that many sitouts are forgiven
- weekendDoubleHeaders (5) — 2+ games in same Sat-Sun weekend
- gapVariance (6) — std dev of gap lengths per team
- shortGapPenalty (3) — sum of 1/gap for all consecutive game pairs
- timeDistribution (3) — weighted variance of weekend time-slot bucket counts per team (WKND_EARLY/WKND_MID/WKND_LATE); early and late weighted 1.5x, mid 0.5x
- timeSlotSpread (4) — penalizes simultaneous games on the same weekend date (for umpire scheduling); counts extra games beyond 1 at each date+time combination
- fieldBalance (2) — variance of field assignment counts per team
- fieldContinuity (10) — gaps between same-division weekend games on the same field (umpire travel)
- earlySeasonDensity (4) — pairs of games within 2 days in first 7 days of season
- weekendBTBTimePenalty (3) — 2nd day of Fri/Sat or Sat/Sun b2b has earlier timeslot than 1st day
- satSunBalance (4) — variance of proportion Saturday among weekend games per team
- btbBalance (3) — exponential penalty on (max − min) back-to-back game counts across teams: `exp(spread) − 1`; spread of 0 = no penalty, grows rapidly with imbalance
- loneWeekendGame (1) — game is the only game for this division on that field+date (weekend only); computed per-division in `scoreDetails`
- fieldDivisionClustering (20) — cross-division penalty for switching between divisions on the same field in a day; A-B-A patterns penalized 4x more than A-B switches. Computed across all divisions together via `scoreCrossfieldDivisionClustering()`, NOT per-division in scoreDetails.
- weekendOtherDivField (4) — weekend game on a field+date that another division also uses; computed cross-division via `scoreWeekendOtherDivField()`, NOT per-division in scoreDetails.

**Cross-division scoring pattern**: `fieldDivisionClustering` and `weekendOtherDivField` are both computed by standalone functions, then added to the global score in js/generate.js's three `globalScoreBefore`/`newGlobalScore` expressions. Neither appears in `scoreDetails` or `scoreCandidate`. Add new cross-division penalties the same way.

**`clusteringScore` coupling**: The `clusteringScore` heuristic inside `tryBuildSchedule` guides greedy slot selection toward the same incentives as the formal penalties. Its magnitudes mirror `WEIGHTS.loneWeekendGame` (+1 reward for joining own games) and `WEIGHTS.weekendOtherDivField` (-4 for sharing with another division). Keep them in sync when adjusting weights.

`scoreCandidate` and `weightedScore` (js/generate.js) both use a dynamic loop over WEIGHTS keys.

Users can adjust all weights via collapsible "Penalty Weights" panel in Settings.

## Hard Constraints (enforced in greedy builder + SA)

Show hard constraints in the UI in the penalty weights section.

- No team plays twice on the same day
- No team plays 3+ games in any 4-day window (`hasThreeInFourDays` / `teamHasThreeInFourDays`)
- Max 1 weekday game per Monday–Friday span (`hasWeekdayGameThisWeek`)
- AL/NL split: each team plays every intra-league opponent at least once (`validateLeagueSplit`)

## Multi-Division Scheduling
- User defines divisions in a table: name, team count, games/team, AL/NL split, excluded days, valid fields
- Field checkboxes populate after TSV is pasted/uploaded (parsed from header row)
- Each division can exclude specific days of the week (e.g., no games on Tuesdays); excluded-day checkboxes are inline in the division table
- A field can be valid for multiple divisions; divisions compete for shared slots
- Priority = row order in the table; first division gets first pick of slots
- Each division is scored/optimized independently
- Results render per-field: each field gets a heatmap section (rows = divisions, columns = date+time, colored by usage/free/unavailable)
- Results render per-division: each gets its own score cards, team summary (with per-team weekend time-slot bucket columns), schedule table, heatmap
- CSV export includes a "Division" column

## AL/NL League Split (optional, per-division)
When a division's "AL/NL" checkbox is enabled:
- AL = odd-numbered teams (1B, 3B, 5B…), NL = even-numbered teams (2B, 4B, 6B…); odd team count → AL gets extra
- Matchup fill order (layered): intra-league layer → inter-league layer → repeat
- Intra-league rounds generated via circle algorithm on each sub-league
- Inter-league rounds generated via bipartite round-robin (round r: AL[i] vs NL[(i+r) % nlSize])
- Hard constraint: gamesPerTeam must be >= max(alSize, nlSize) - 1

## Weight Sync
`resetWeights()` in js/divisions.js reads directly from the `WEIGHTS` object defined in js/constants.js (no separate `DEFAULT_WEIGHTS` copy). Keep weights only in js/constants.js.

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
- **Double header**: two games for the same team on the *same day* — blocked as a hard constraint via `teamDay`
- **Back-to-back**: a team plays on consecutive days (e.g., Sat + Sun of the same weekend) — this is *allowed*

## Advanced Scheduler Explanation

### Matchup Generation

The core uses the **circle method** for round-robin tournaments (js/matchups.js): fix team 0, rotate teams 1..n-1. For odd team counts, a dummy team is added and its pairings become byes. This produces `n-1` rounds of `floor(n/2)` games each — a perfect 1-factorization of K_n.

Rounds are cycled to reach `totalGames = numTeams * gamesPerTeam / 2`. The first `numWeekends` rounds become weekend rounds (preserving their structure as perfect matchings so no team double-books on a weekend). Remaining games are flattened into a weekday pool.

For **AL/NL league splits** (js/matchups.js), matchup generation uses a layered fill: intra-league rounds (circle algorithm on each sub-league, merged since they're disjoint) alternate with inter-league rounds (bipartite round-robin: `AL[i] vs NL[(i+r) % nlSize]`). Excess games are trimmed by greedily removing pairs where both teams have the highest game counts. The result is re-grouped into valid matchings via greedy set-packing.

### Home/Away Assignment

`assignHomeAway` uses a two-priority system: per-matchup balance (has team A hosted team B more than vice versa?) takes precedence over overall balance (does team A have too many home games total?). Two repair passes follow — pass 1 fixes per-matchup imbalances beyond ±1, pass 2 fixes overall team imbalances beyond ±1. After all field optimization (consolidate + slide), `rebalanceHomeAway` runs a final greedy flip pass plus a 2-hop chain pass through intermediate teams at excess 0.

### Greedy Builder

`tryBuildSchedule` runs 200 attempts with randomized round-to-weekend mappings and shuffled weekday game order. Each attempt:

- **Phase 1 (weekends)**: For each weekend group, assigns shuffled round games to eligible slots. Slot selection scores by: `-dateGameCount` (spread across Sat/Sun), `-teamFieldCount * 0.3` (field balance), `clusteringScore` (prefer fields with own-division games, avoid other-division fields), plus random jitter.
- **Phase 1.5 (weekend overflow)**: Attempts to place weekday-pool games into unused weekend slots, but ONLY if the game has no eligible weekday slots (genuine scarcity). Back-to-back weekend games (Sat+Sun) are allowed. Also uses clustering scoring. Prevents unnecessary back-to-backs when weekday capacity is available.
- **Phase 2 (weekdays)**: Uses MRV (minimum remaining values) ordering — dynamically picks the unplaced game with fewest eligible slots first, preventing constrained games from being stranded. Slot selection scores by: `min distance to nearest existing game` (fill gaps), `-weekCount * 5` (avoid clustering in one week), `-teamFieldCount * 2` (field balance), `clusteringScore` (cross-division awareness), LCV penalty (penalizes slots in weeks that constrain remaining games), plus jitter.

All three phases track `divFieldDate` (this division's games per field+date) and use `otherDivFieldDate` (other divisions' games) for clustering. The `clusteringScore` function rewards fields where this division already has games (+2) and penalizes fields where other divisions have games (-1.5).

Hard constraints are checked inline via `hasThreeInFourDays` and `hasWeekdayGameThisWeek`. If no eligible slot exists for a weekday game, the attempt fails.

### Scoring Function

`scoreDetails` computes 11 penalty metrics, each multiplied by a user-adjustable weight:

| Metric | What it measures |
|---|---|
| `weekendSitouts` | Weekends where a team has 0 games (forgives unavoidable sitouts) |
| `weekendDoubleHeaders` | Extra games beyond 1 per team per Sat-Sun pair |
| `gapVariance` | Sum of per-team std dev of inter-game gaps |
| `shortGapPenalty` | Sum of `1/gap` for all consecutive game pairs |
| `timeDistribution` | Weighted variance of weekend time-bucket counts per team (WKND_EARLY/WKND_MID/WKND_LATE) |
| `timeSlotSpread` | Simultaneous games on the same weekend date (umpire scheduling) |
| `fieldBalance` | Variance of field-assignment counts per team |
| `fieldContinuity` | Gaps between same-division weekend games on the same field |
| `earlySeasonDensity` | Pairs of games within 2 days in first 7 days |
| `weekendBTBTimePenalty` | 2nd day of weekend b2b has earlier timeslot |
| `satSunBalance` | Variance of proportion Saturday per team |
| `btbBalance` | Exponential penalty on (max − min) back-to-back game counts: `exp(spread) − 1` |
| `fieldDivisionClustering` | Cross-division: switches between divisions on same field/day (A-B-A penalized 4x) |

### Post-Greedy Simulated Annealing

`annealSchedule` runs 2000 iterations after the greedy builder. Four move types:
- **Same-date slot swap (40%):** Swap time+field between two games on the same date. Always valid since no date-based constraints change.
- **Cross-date slot swap (15%):** Swap full slot (date, dayOfWeek, time, field) between two games. Validated against hard constraints (3-in-4-days, weekday-per-week, no same-day).
- **Relocate to unused slot (25%):** Move a game to any unused slot from the available pool. Validated against hard constraints.
- **Slide (20%):** Move a weekend game one slot earlier/later on the same field+date. No constraint check needed (same day, date-based constraints unchanged).

Uses Metropolis acceptance with geometric cooling (T: 2.0 → 0.01). Tracks used/unused slot sets for relocations. Tracks best schedule seen.

