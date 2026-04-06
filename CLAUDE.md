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

### Single-Division Pipeline (scheduler.js)
1. `buildSchedule(numTeams, gamesPerTeam, slots, onProgress, options)` (entry point)
   - `options.leagueSplit` — when true, uses AL/NL league-aware matchup selection
2. `generateTournamentRounds()` — circle/polygon algorithm, produces perfect matchings
3. `selectMatchups()` — splits rounds into weekend (full rounds) and weekday (remainder)
   - OR `selectMatchupsWithLeagues()` — layered fill: intra-league pairs first, then inter-league, alternating layers
4. `assignHomeAway()` — greedy + 2 repair passes (per-matchup balance, then overall ±1)
5. `tryBuildSchedule()` — Phase 1: weekend rounds to weekend slots; Phase 2: weekday greedy assignment. 200 random attempts, keeps best.

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
- weekdayBackToBack (10) — consecutive weekday games (Mon+Tue, etc.)
- weekendDoubleHeaders (8) — 2+ games in same Sat-Sun weekend
- crossBoundaryBTB (7) — Fri-Sat or Sun-Mon back-to-back
- gapVariance (6) — std dev of gap lengths per team
- rollingDensity (5) — 3+ games in 5-day window, penalty = (count-2)^2
- sixDayDensity (5) — 3+ games in 6-day window, explicit penalties: 3→4, 4→12, 5→20
- shortGapPenalty (3) — sum of 1/gap for all consecutive game pairs
- timeDistribution (3) — variance of time-slot bucket counts per team
- fieldBalance (4) — variance of field assignment counts per team

Users can adjust all weights via collapsible "Penalty Weights" panel in Settings.

## Hard Constraints (enforced in greedy builder + SA)

Show hard constraints in the UI in the penalty weights section.

- No team plays twice on the same day
- No team plays 3+ consecutive calendar days (`hasConsecutiveDays` / `teamHasConsecutiveDays`)
- In the first 10 days of the season, no team can have games within 2 days of each other (`hasEarlySeasonConflict` / `teamHasEarlySeasonConflict`)
- In the last 5 days of the season, each team plays at most 1 game (`endOfSeasonCutoff`)
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
- AL = teams 0..floor(n/2)-1, NL = teams floor(n/2)..n-1 (odd count → NL gets extra)
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

Hard constraints are checked inline via `hasConsecutiveDays`, `hasEarlySeasonConflict`, and end-of-season limits. If no eligible slot exists for a weekday game, the attempt fails.

### Scoring Function

`scoreDetails` computes 10 penalty metrics, each multiplied by a user-adjustable weight:

| Metric | What it measures |
|---|---|
| `weekendSitouts` | Weekends where a team has 0 games (forgives unavoidable sitouts) |
| `weekendDoubleHeaders` | Extra games beyond 1 per team per Sat-Sun pair |
| `weekdayBackToBack` | Consecutive weekday games (Mon+Tue, etc.) |
| `crossBoundaryBTB` | Fri→Sat or Sun→Mon back-to-backs |
| `gapVariance` | Sum of per-team std dev of inter-game gaps |
| `rollingDensity` | 5-day window: `(count-2)^2` for 3+ games |
| `sixDayDensity` | 6-day window: explicit penalty table (3→4, 4→12, 5→20) |
| `shortGapPenalty` | Sum of `1/gap` for all consecutive game pairs |
| `timeDistribution` | Variance of time-bucket counts per team |
| `fieldBalance` | Variance of field-assignment counts per team |

### Why No Simulated Annealing

A simulated annealing step was tested (swap and relocate moves with Metropolis acceptance). Diagnostic counters showed ~76% of moves were rejected by hard constraints, and the remaining accepted moves produced near-zero net improvement — the greedy builder's 200-attempt best-of approach already reaches a local optimum that single-move perturbations can't escape. SA was removed since it added runtime without improving scores.

