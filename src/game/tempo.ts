import type { Judgment } from './scoring'

/** Clean chords in a row (GREAT or better) before the tempo goes up. */
export const TEMPO_UP_STREAK = 4
/** Missed (or barely-played) chords in a row before the tempo comes down. */
export const TEMPO_DOWN_STREAK = 2
export const TEMPO_UP = 3
export const TEMPO_DOWN = 5
export const MIN_ADAPTIVE_BPM = 40
export const MAX_ADAPTIVE_BPM = 160

export interface TempoState {
  clean: number
  rough: number
}

export const emptyTempo = (): TempoState => ({ clean: 0, rough: 0 })

/**
 * Adaptive tempo: nudge the BPM up a little after a run of clean chords and back down after a
 * couple of misses, so practice stays right at the edge of what you can play.
 */
export function adaptTempo(state: TempoState, j: Judgment, bpm: number): { state: TempoState; bpm: number } {
  if (j.grade === 'perfect' || j.grade === 'great') {
    const clean = state.clean + 1
    if (clean >= TEMPO_UP_STREAK) return { state: emptyTempo(), bpm: bpm >= MAX_ADAPTIVE_BPM ? bpm : Math.min(MAX_ADAPTIVE_BPM, bpm + TEMPO_UP) }
    return { state: { clean, rough: 0 }, bpm }
  }
  if (j.grade === 'miss' || j.grade === 'ok') {
    const rough = state.rough + 1
    if (rough >= TEMPO_DOWN_STREAK) return { state: emptyTempo(), bpm: bpm <= MIN_ADAPTIVE_BPM ? bpm : Math.max(MIN_ADAPTIVE_BPM, bpm - TEMPO_DOWN) }
    return { state: { clean: 0, rough }, bpm }
  }
  // A GOOD chord: not clean enough to speed up, not bad enough to slow down.
  return { state: emptyTempo(), bpm }
}
