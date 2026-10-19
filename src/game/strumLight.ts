import type { Grade } from './scoring'
import { OPEN_MIDI } from '../music/chords'

/**
 * How brightly the neck lights the strings that rang: dim while a strum is being listened to,
 * bright if it sounded like the chord and dim if it didn't (however hard it was hit), then by grade
 * once the game scores it. Decided once per strum, so it doesn't flicker as the strings ring on.
 */
export type Tone = 'listening' | 'right' | 'wrong' | Grade

/** Seconds after a strum before deciding whether it was the chord. */
export const VERDICT_SECONDS = 0.3
/** Frames in that time that must sound like the chord: one stray frame isn't enough. */
export const RIGHT_FRAMES = 3
/** Seconds of silence before a strum's lights go out. */
export const FADE_SECONDS = 0.3

export interface StrumLight {
  chordId: string | null
  /** Onset time of the strum being shown (0: none yet for this chord) */
  onset: number
  /** When the verdict is due */
  until: number
  /** Every string that rang during the verdict window */
  union: boolean[]
  rightFrames: number
  verdict: 'right' | 'wrong' | null
  grade: Grade | null
  quietSince: number | null
  /** Muted strings (✕) hit during this strum */
  mutedHit: boolean[]
  /** What to draw */
  strings: boolean[]
  tone: Tone | null
}

export interface Frame {
  now: number
  /** Time of the latest strum onset */
  onset: number
  chordId: string | null
  /** Strings of the chord ringing this frame */
  strings: boolean[]
  /** This frame sounds like the chord, and more than any other */
  soundsRight: boolean
  /** Muted strings ringing this frame */
  muted?: boolean[]
}

const none = () => Array<boolean>(OPEN_MIDI.length).fill(false)

export const emptyLight = (): StrumLight => ({
  chordId: null,
  onset: 0,
  until: 0,
  union: none(),
  rightFrames: 0,
  verdict: null,
  grade: null,
  quietSince: null,
  mutedHit: none(),
  strings: none(),
  tone: null,
})

export function updateLight(prev: StrumLight, f: Frame): StrumLight {
  let l = prev
  // A different chord: what was showing was judged against the old one. (Strums already seen stay
  // seen; one arriving right now is for the new chord.)
  if (f.chordId !== l.chordId) l = { ...emptyLight(), chordId: f.chordId, onset: l.onset }
  if (f.onset < l.onset) l = { ...l, onset: f.onset } // the audio clock restarted

  if (f.onset > l.onset) {
    l = { ...l, onset: f.onset, until: f.now + VERDICT_SECONDS, union: [...f.strings], rightFrames: f.soundsRight ? 1 : 0, verdict: null, grade: null, quietSince: null, mutedHit: none() }
  } else if (l.until && l.verdict === null) {
    const union = l.union.map((on, i) => on || f.strings[i])
    const rightFrames = l.rightFrames + (f.soundsRight ? 1 : 0)
    const verdict = f.now >= l.until ? (rightFrames >= RIGHT_FRAMES ? 'right' : 'wrong') : null
    l = { ...l, union, rightFrames, verdict }
  }

  const muted = f.muted ?? none()
  l = { ...l, mutedHit: l.mutedHit.map((on, i) => on || muted[i]) }
  const sounding = f.strings.some(Boolean) || muted.some(Boolean)
  const quietSince = sounding ? null : (l.quietSince ?? f.now)
  l = { ...l, quietSince }
  if (quietSince !== null && f.now - quietSince >= FADE_SECONDS) return { ...l, until: 0, verdict: null, grade: null, mutedHit: none(), strings: none(), tone: null }

  if (!l.until) {
    // Ringing without a strum we caught (a soft pluck): show it, but don't claim it's right.
    return { ...l, strings: [...f.strings], tone: sounding ? 'listening' : null }
  }
  if (l.grade) return { ...l, strings: l.union, tone: l.grade }
  if (l.verdict) return { ...l, strings: l.union, tone: l.verdict }
  return { ...l, strings: [...f.strings], tone: 'listening' }
}

/** The game scored the strum being shown: light it in the grade's color. */
export const gradeLight = (l: StrumLight, grade: Grade): StrumLight =>
  l.until && grade !== 'miss' ? { ...l, grade, strings: l.union.map((on, i) => on || l.strings[i]), tone: grade } : l
