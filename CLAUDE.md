# Agent Context: Little League Scheduler

## Overview
Browser-based little league baseball/softball scheduler. No server, no build tools — plain JS/CSS/HTML. Generates an optimized game schedule from team count, games-per-team, and a TSV field-availability matrix.

Whenever you make a change, check whether you need to update CLAUDE.md (this file) to keep it correct and up to date.

## Files
- **scheduler.js** (~1100 lines) — Core engine: TSV parsing, round-robin tournament generation, matchup selection (standard + AL/NL league-aware), home/away assignment, greedy schedule builder, scoring/penalty system
- **annealing.js** (~230 lines) — Simulated annealing optimizer: swap and relocate moves with hard constraint checks (same-day conflict, 3-consecutive-day limit)
- **ui.js** (~320 lines) — UI rendering: score cards, per-team summary table, schedule table, heatmap, CSV export, penalty weight sync
- **index.html** — Minimal shell with input form and result sections. Loads: styles.css, scheduler.js, annealing.js, ui.js
- **styles.css** — All styling including CSS-only tooltips and heatmap

## Architecture / Pipeline
1. `buildSchedule(numTeams, gamesPerTeam, slots, onProgress, options)` (entry point in scheduler.js, called from ui.js `generate()`)
   - `options.leagueSplit` — when true, uses AL/NL league-aware matchup selection
2. `generateTournamentRounds()` — circle/polygon algorithm, produces perfect matchings
3. `selectMatchups()` — splits rounds into weekend (full rounds) and weekday (remainder)
   - OR `selectMatchupsWithLeagues()` — layered fill: intra-league pairs first, then inter-league, alternating layers
4. `assignHomeAway()` — greedy + 2 repair passes (per-matchup balance, then overall ±1)
5. `tryBuildSchedule()` — Phase 1: weekend rounds to weekend slots; Phase 2: weekday greedy assignment. 200 random attempts, keeps best.
6. `anneal()` — simulated annealing with swap/relocate moves, linear cooling

## Key Data Structures
- **Slot**: `{ date, dayOfWeek, weekendGroup, week, field, time, sortKey }`
- **Game**: `{ date, dayOfWeek, time, field, home, away }` (home/away are 0-indexed team IDs)
- **teamDay**: `Map<teamId, Set<dateStrings>>` — tracks which dates each team plays
- **WEIGHTS**: global object with penalty weights, synced from UI inputs before each run

## Scoring System (scoreCandidate / scoreDetails)
Weighted sum of penalties. Current weights in `WEIGHTS` global:
- weekendSitouts (12) — team has zero games on a weekend with available slots
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

## AL/NL League Split (optional)
When "Split into AL / NL" checkbox is enabled:
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
