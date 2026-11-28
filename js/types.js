// Shared data shapes. These declarations have no runtime cost.
/** @typedef {{date: string, dayOfWeek: number, weekendGroup: string|null, week: string, field: string, time: string, sortKey: string}} Slot */
/** @typedef {{date: string, dayOfWeek: number, time: string, field: string, home: number, away: number, division?: string}} Game */
/** @typedef {keyof typeof import('./constants.js').WEIGHTS} WeightKey */
/** @typedef {Record<WeightKey, number>} Weights */
/** @typedef {{name: string, numTeams: number, gamesPerTeam: number, leagueSplit: boolean, fields: string[], excludedDays: number[]}} DivisionConfig */
/** @typedef {Omit<Weights, 'fieldDivisionClustering'|'weekendOtherDivField'> & {minWeekendDH: number}} ScoreDetails */
/** @typedef {{division: DivisionConfig, schedule: Game[], details: ScoreDetails, greedyDetails: ScoreDetails, slots: Slot[], weights?: Weights}} DivisionResult */
/** @typedef {[string, string, string, number, string|null, string]} PackedSlot */
/** @typedef {[number, number, number]} PackedGame */
/** @typedef {{version: 1, baseWeights: Weights, slots: PackedSlot[], results: {division: DivisionConfig, weights: Weights, games: PackedGame[]}[]}} PackedSchedule */
/** @typedef {{name: string, numTeams: string, gamesPerTeam: string, leagueSplit: boolean, uncheckedFields: string[], excludedDays: number[], weightOverrides: Partial<Record<WeightKey, string>>}} SetupDivision */
/** @typedef {{divisions: SetupDivision[], tsv: string, weights: Partial<Record<WeightKey, string>>, fileName: string}} Setup */
/** @typedef {{format: 'little-league-scheduler', version: 1, setup: Setup, schedule: PackedSchedule|null}} Backup */
export {};
