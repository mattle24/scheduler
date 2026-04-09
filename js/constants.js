const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const NUM_ATTEMPTS = 500;
const WKND_BUCKET_THRESHOLDS = [630, 900]; // minutes: early < 10:30am, mid 10:30am–3pm, late >= 3pm
const WKND_BUCKET_IMPORTANCE = { WKND_EARLY: 1.5, WKND_MID: 0.5, WKND_LATE: 1.5 };

// WEIGHTS, WEIGHT_LABELS, and WEIGHT_DESCRIPTIONS alphabetical by convention
const WEIGHTS = {
  btbBalance: 12,
  earlySeasonDensity: 4,
  fieldBalance: 2,
  fieldContinuity: 10,
  fieldDivisionClustering: 20,
  gapVariance: 6,
  loneWeekendGame: 1,
  satSunBalance: 8,
  shortGapPenalty: 3,
  shortGapBalance: 5,
  timeDistribution: 3,
  timeSlotSpread: 4,
  weekendBTBTimePenalty: 3,
  weekendDoubleHeaders: 5,
  weekendOtherDivField: 4,
  weekendSitouts: 20,
};

const WEIGHT_LABELS = {
  btbBalance: 'Back-to-Back Balance (equal back-to-back games per team)',
  earlySeasonDensity: 'Early Season Density (games within 2 days in first 7 days)',
  fieldBalance: 'Field Balance (teams play even games at each field)',
  fieldContinuity: 'Field Continuity (same-division games back-to-back on a field)',
  fieldDivisionClustering: 'Field Division Clustering (same-division games grouped on field)',
  gapVariance: 'Gap Variance (difference time between games across teams)',
  loneWeekendGame: 'Lone Weekend Game (only game for this division on a field that day)',
  satSunBalance: 'Sat/Sun Balance (equal Saturday & Sunday games per team)',
  shortGapPenalty: 'Short Gap Penalty',
  shortGapBalance: 'Short Gap Balance (equal short-rest games across teams)',
  timeDistribution: 'Time Distribution (early/mid/late)',
  timeSlotSpread: 'Weekend Time Slot Spread (avoid simultaneous games on same date)',
  weekendBTBTimePenalty: 'Weekend B2B Timeslot (2nd day should be later time)',
  weekendDoubleHeaders: 'Weekend Back-to-Back',
  weekendOtherDivField: 'Weekend Other-Division Field (sharing field+day with another division)',
  weekendSitouts: 'Weekend Sit-outs (no games in a weekend)',
};

const WEIGHT_DESCRIPTIONS = {
  btbBalance: 'Penalizes uneven distribution of back-to-back games (consecutive days) across teams. Higher = teams have similar numbers of back-to-back days.',
  fieldDivisionClustering: 'Penalizes switching between divisions on the same field in a day. A-B-A patterns (switching back and forth) are penalized much more heavily than A-A-B (single switch).',
  earlySeasonDensity: 'Penalizes games scheduled within 2 days of each other during the first 7 days of the season.',
  fieldBalance: 'Penalizes uneven distribution of field assignments per team. Higher = teams play at each field more equally.',
  fieldContinuity: 'Penalizes gaps between same-division games on the same field on weekends. Back-to-back games reduce umpire travel. Higher = prefer consecutive same-division games.',
  gapVariance: 'Penalizes uneven spacing between games across a team\'s schedule. Higher = more consistent rest for all teams.',
  satSunBalance: 'Penalizes uneven split of Saturday vs Sunday games per team. Higher = equal Sat & Sun games.',
  shortGapPenalty: 'Adds 1/gap-days for each pair of consecutive games. Strongly penalizes 1–2 day gaps, fades for longer gaps.',
  shortGapBalance: 'Penalizes uneven distribution of short-rest games (< 3 days between consecutive games) across teams. Higher = all teams have similar numbers of short-rest games.',
  timeDistribution: 'Penalizes uneven distribution of weekend time buckets (early < 10:30am, mid 10:30am–3pm, late >= 3pm) per team. Early and late slots are weighted more heavily.',
  timeSlotSpread: 'Penalizes multiple games at the same time on the same weekend date. Spreads games across distinct time slots so umpires can cover more games sequentially.',
  weekendBTBTimePenalty: 'When a team plays back-to-back weekend days, prefers a later timeslot on the second day.',
  weekendDoubleHeaders: 'Penalizes 2+ games in the same Sat–Sun weekend. Higher = at most 1 game per weekend per team.',
  weekendOtherDivField: 'Penalizes weekend games on a field+day that another division also uses. Encourages divisions to own separate field days.',
  weekendSitouts: 'Penalizes when a team has zero games on a weekend. Higher = fewer idle weekends per team.',
};

export { DAYS, NUM_ATTEMPTS, WKND_BUCKET_THRESHOLDS, WKND_BUCKET_IMPORTANCE, WEIGHTS, WEIGHT_LABELS, WEIGHT_DESCRIPTIONS };
