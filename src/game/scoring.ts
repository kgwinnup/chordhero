export type Grade = 'perfect' | 'great' | 'good' | 'ok' | 'miss'

export interface Judgment {
  /** Unique per judgment, so the UI can re-trigger animations */
  id: number
  abs: number
  grade: Grade
  points: number
  /** 0..1 combined accuracy (strings × timing) */
  quality: number
  stringsHit: number
  stringsExpected: number
  /** Seconds the strum landed after (+) or before (−) the chord's beat; null for misses */
  offset: number | null
  timing: 'early' | 'late' | null
  multiplier: number
}

export interface ScoreState {
  points: number
  combo: number
  maxCombo: number
  multiplier: number
  qualitySum: number
  judged: number
  counts: Record<Grade, number>
  last: Judgment | null
}

export const BASE_POINTS = 100
export const MAX_MULTIPLIER = 4
/** Combo length needed for each multiplier step, like Guitar Hero's 10-note steps. */
export const COMBO_STEP = 6

/** Timing windows in seconds, with the share of points each keeps. */
const TIMING_TIERS: { within: number; factor: number }[] = [
  { within: 0.08, factor: 1 },
  { within: 0.16, factor: 0.85 },
  { within: 0.28, factor: 0.7 },
]
const OFF_BEAT_FACTOR = 0.5

export const GRADE_LABEL: Record<Grade, string> = {
  perfect: 'PERFECT!',
  great: 'GREAT',
  good: 'GOOD',
  ok: 'OK',
  miss: 'MISS',
}

export const emptyScore = (): ScoreState => ({
  points: 0,
  combo: 0,
  maxCombo: 0,
  multiplier: 1,
  qualitySum: 0,
  judged: 0,
  counts: { perfect: 0, great: 0, good: 0, ok: 0, miss: 0 },
  last: null,
})

export const multiplierFor = (combo: number) => Math.min(MAX_MULTIPLIER, 1 + Math.floor(combo / COMBO_STEP))

export function timingFactor(offset: number) {
  const abs = Math.abs(offset)
  return TIMING_TIERS.find((t) => abs <= t.within)?.factor ?? OFF_BEAT_FACTOR
}

export function gradeFor(quality: number): Grade {
  if (quality >= 0.95) return 'perfect'
  if (quality >= 0.8) return 'great'
  if (quality >= 0.6) return 'good'
  return 'ok'
}

let nextId = 1

/** Grade a played chord from how many strings rang and how close to the beat it was strummed. */
export function judge(score: ScoreState, abs: number, stringsHit: number, stringsExpected: number, offset: number): Judgment {
  const quality = (stringsHit / stringsExpected) * timingFactor(offset)
  const multiplier = multiplierFor(score.combo + 1)
  return {
    id: nextId++,
    abs,
    grade: gradeFor(quality),
    points: Math.round(BASE_POINTS * quality) * multiplier,
    quality,
    stringsHit,
    stringsExpected,
    offset,
    timing: Math.abs(offset) <= TIMING_TIERS[0].within ? null : offset < 0 ? 'early' : 'late',
    multiplier,
  }
}

export function missJudgment(abs: number, stringsExpected: number): Judgment {
  return {
    id: nextId++,
    abs,
    grade: 'miss',
    points: 0,
    quality: 0,
    stringsHit: 0,
    stringsExpected,
    offset: null,
    timing: null,
    multiplier: 1,
  }
}

export function applyJudgment(score: ScoreState, j: Judgment): ScoreState {
  const combo = j.grade === 'miss' ? 0 : score.combo + 1
  return {
    points: score.points + j.points,
    combo,
    maxCombo: Math.max(score.maxCombo, combo),
    multiplier: multiplierFor(combo),
    qualitySum: score.qualitySum + j.quality,
    judged: score.judged + 1,
    counts: { ...score.counts, [j.grade]: score.counts[j.grade] + 1 },
    last: j,
  }
}

/** Letter-ish star rating from average accuracy. */
export function starsFor(score: ScoreState) {
  if (!score.judged) return 0
  const acc = score.qualitySum / score.judged
  return acc >= 0.95 ? 5 : acc >= 0.85 ? 4 : acc >= 0.7 ? 3 : acc >= 0.5 ? 2 : 1
}
