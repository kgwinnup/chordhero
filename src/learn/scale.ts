import { NOTE_NAMES } from '../music/chords'

/** A scale: its root's pitch class (0 = C) and the semitones above it. */
export interface Scale {
  id: string
  name: string
  root: number
  intervals: number[]
}

export const SCALES: Record<string, Scale> = {
  'em-pent': { id: 'em-pent', name: 'E minor pentatonic', root: 4, intervals: [0, 3, 5, 7, 10] },
}

/** Where a note of the scale is played. */
export interface ScaleNote {
  /** String index, low → high, as in a chord's `frets` */
  string: number
  fret: number
  midi: number
  root: boolean
}

export const noteName = (midi: number) => NOTE_NAMES[((midi % 12) + 12) % 12]
const pitchClass = (midi: number) => ((midi % 12) + 12) % 12

export const inScale = (scale: Scale, midi: number) => scale.intervals.some((i) => (scale.root + i) % 12 === pitchClass(midi))

/**
 * The scale's notes within `maxFret` on a guitar with these open strings, low to high. A note
 * reachable on two strings is played on the higher string, nearer the nut.
 */
export function scaleNotes(scale: Scale, open: number[], maxFret = 3): ScaleNote[] {
  const byMidi = new Map<number, ScaleNote>()
  open.forEach((o, string) => {
    for (let fret = 0; fret <= maxFret; fret++) {
      const midi = o + fret
      if (!inScale(scale, midi)) continue
      const have = byMidi.get(midi)
      if (!have || string > have.string) byMidi.set(midi, { string, fret, midi, root: pitchClass(midi) === scale.root })
    }
  })
  return [...byMidi.values()].sort((a, b) => a.midi - b.midi)
}

/** Up the scale and back down, the top note played once. */
export const upAndDown = <T,>(notes: T[]): T[] => [...notes, ...notes.slice(0, -1).reverse()]

/** Harmonics of a note that count towards hearing it, and how much each counts. */
const HARMONIC_WEIGHTS = [1, 0.85, 0.7, 0.55, 0.45, 0.35]
/** A harmonic is looked for within this many semitones of where it should be. */
const HARMONIC_SPAN = 0.3

/**
 * How strongly each note sounds in what a pick added: the spectrum after it, less the spectrum
 * just before. Notes still ringing from earlier picks are in both and cancel out, so only the new
 * note is left, which a pitch tracker can't separate from the old ones. Each note is scored by the
 * new energy at its harmonics, the lower harmonics counting most, so the true note outscores the
 * octave below it (which only shares every other harmonic).
 */
export function newNoteScores(before: ArrayLike<number>, after: ArrayLike<number>, binHz: number, midis: number[]): number[] {
  const added = (bin: number) => Math.max(0, 10 ** (after[bin] / 10) - 10 ** (before[bin] / 10))
  return midis.map((midi) => {
    const f0 = 440 * 2 ** ((midi - 69) / 12)
    let score = 0
    HARMONIC_WEIGHTS.forEach((w, h) => {
      const f = f0 * (h + 1)
      const lo = Math.max(1, Math.floor((f * 2 ** (-HARMONIC_SPAN / 12)) / binHz))
      const hi = Math.min(after.length - 1, Math.ceil((f * 2 ** (HARMONIC_SPAN / 12)) / binHz))
      let peak = 0
      for (let b = lo; b <= hi; b++) peak = Math.max(peak, added(b))
      score += w * peak
    })
    return score
  })
}

/** A note counts as played if it scores at least this share of the strongest. */
export const PLAYED_SHARE = 0.4

/** The notes a pick played, strongest first: those scoring near the best, if anything new sounded at all. */
export function playedNotes(scores: number[], midis: number[], floor: number): number[] {
  const best = Math.max(...scores)
  if (!(best > floor)) return []
  return midis
    .map((midi, i) => ({ midi, s: scores[i] }))
    .filter((n) => n.s >= best * PLAYED_SHARE)
    .sort((a, b) => b.s - a.s)
    .map((n) => n.midi)
}

/** How a note of a run went. `wrong` is a note in time but not the right one. */
export type NoteGrade = 'pending' | 'hit' | 'early' | 'late' | 'wrong' | 'miss'

export interface NoteGrades {
  slots: NoteGrade[]
  /** Right notes in time */
  hits: number
  /** Notes whose chance has passed */
  expected: number
  /** Notes played where none belonged, or a second on one beat */
  extras: number
  /** Average timing of the hits in seconds: negative is early */
  drift: number
}

/** A note this close to its beat is right on time, in seconds. */
const ON_TIME = 0.06
const MAX_WINDOW = 0.15

/** A note heard: when it started, and what it was (null if it couldn't be told). */
export interface HeardNote {
  at: number
  midi: number | null
}

/** A pick heard: when, and every note it made ring, the strongest first. */
export interface Pick {
  at: number
  rang: number[]
}

/**
 * Grades the notes heard against `expected`, one every `stepSec` from `start`. Each note heard
 * belongs to the nearest step; steps whose window hasn't closed by `now` are pending.
 */
export function gradeNotes(expected: number[], start: number, stepSec: number, heard: HeardNote[], now = Infinity): NoteGrades {
  const window = Math.min(MAX_WINDOW, stepSec * 0.45)
  const got: (HeardNote & { dt: number })[] = new Array(expected.length)
  let extras = 0
  for (const h of heard) {
    const i = Math.round((h.at - start) / stepSec)
    const dt = h.at - (start + i * stepSec)
    if (i < 0 || i >= expected.length || Math.abs(dt) > window || got[i]) {
      if (i >= -1 && i <= expected.length) extras++
      continue
    }
    got[i] = { ...h, dt }
  }
  const slots: NoteGrade[] = []
  let hits = 0
  let done = 0
  let drift = 0
  expected.forEach((midi, i) => {
    const g = got[i]
    const closed = now > start + i * stepSec + window
    if (!g) {
      slots.push(closed ? 'miss' : 'pending')
      if (closed) done++
      return
    }
    done++
    if (g.midi !== midi) return void slots.push('wrong')
    hits++
    drift += g.dt
    slots.push(Math.abs(g.dt) <= ON_TIME ? 'hit' : g.dt < 0 ? 'early' : 'late')
  })
  return { slots, hits, expected: done, extras, drift: hits ? drift / hits : 0 }
}

/** Percent of the run's notes right and in time, less any extras. */
export const runScore = (g: NoteGrades, total: number) => (total ? Math.round((Math.max(0, g.hits - g.extras) / total) * 100) : 0)
