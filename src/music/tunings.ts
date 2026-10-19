import { midiToFreq, NOTE_NAMES } from './chords'

/** How the tuning pegs sit on the headstock (looking at its face, nut at the bottom). */
export type HeadstockLayout = 'three-a-side' | 'three-a-side-outer-near' | 'six-in-line' | 'two-a-side' | 'four-in-line'

export interface Tuning {
  id: string
  name: string
  /** MIDI note of each string, in the order they sit from the bass side (low E first on a guitar) */
  notes: number[]
}

export interface Instrument {
  id: string
  name: string
  layout: HeadstockLayout
  tunings: Tuning[]
}

const SIX_STRING_TUNINGS: Tuning[] = [
  { id: 'standard', name: 'Standard (E A D G B E)', notes: [40, 45, 50, 55, 59, 64] },
  { id: 'drop-d', name: 'Drop D (D A D G B E)', notes: [38, 45, 50, 55, 59, 64] },
  { id: 'half-down', name: 'Half step down (E♭)', notes: [39, 44, 49, 54, 58, 63] },
  { id: 'open-g', name: 'Open G (D G D G B D)', notes: [38, 43, 50, 55, 59, 62] },
  { id: 'dadgad', name: 'DADGAD', notes: [38, 45, 50, 55, 57, 62] },
]

export const INSTRUMENTS: Instrument[] = [
  { id: 'acoustic', name: 'Acoustic', layout: 'three-a-side-outer-near', tunings: SIX_STRING_TUNINGS },
  { id: 'electric', name: 'Electric', layout: 'six-in-line', tunings: SIX_STRING_TUNINGS },
  { id: 'classical', name: 'Classical', layout: 'three-a-side', tunings: [SIX_STRING_TUNINGS[0], SIX_STRING_TUNINGS[1]] },
  {
    id: 'bass',
    name: 'Bass',
    layout: 'four-in-line',
    tunings: [
      { id: 'standard', name: 'Standard (E A D G)', notes: [28, 33, 38, 43] },
      { id: 'drop-d', name: 'Drop D (D A D G)', notes: [26, 33, 38, 43] },
    ],
  },
  {
    id: 'ukulele',
    name: 'Ukulele',
    layout: 'two-a-side',
    // Re-entrant: the G string is tuned above the C, which is the lowest-pitched string.
    tunings: [{ id: 'standard', name: 'Standard (G C E A)', notes: [67, 60, 64, 69] }],
  },
]

export const INSTRUMENTS_BY_ID: Record<string, Instrument> = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]))

export const noteLabel = (midi: number) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`

/** Cents from the target note: positive = sharp (too high), negative = flat (too low). */
export const centsOff = (freq: number, targetMidi: number) => 1200 * Math.log2(freq / midiToFreq(targetMidi))

/** Within this many cents counts as in tune. */
export const IN_TUNE_CENTS = 5

export type TuneHint = { kind: 'in-tune' } | { kind: 'up' | 'down'; semitones: number }

/** What to tell the player for a reading this many cents off. */
export function tuneHint(cents: number): TuneHint {
  if (Math.abs(cents) <= IN_TUNE_CENTS) return { kind: 'in-tune' }
  return { kind: cents < 0 ? 'up' : 'down', semitones: Math.round(Math.abs(cents) / 100) }
}

/** Search range for a string's pitch: wide enough to catch a badly detuned string, narrow enough to skip octaves. */
export const searchRange = (targetMidi: number) => ({ minHz: midiToFreq(targetMidi - 9), maxHz: midiToFreq(targetMidi + 9) })

/** Strings in the order they're tuned: from the highest (string 1, a guitar's thin high e) down to the bass side. */
export const tuneOrder = (tuning: Tuning) => tuning.notes.map((_, i) => i).reverse()

/** Conventional string number: 1 is the treble-side string (high e on a guitar, A on a ukulele). */
export const stringNumber = (tuning: Tuning, index: number) => tuning.notes.length - index

/** The next string to tune after `current`, wrapping round to any skipped; undefined once all are tuned. */
export function nextToTune(order: number[], current: number, tuned: ReadonlySet<number>): number | undefined {
  const at = order.indexOf(current)
  return [...order.slice(at + 1), ...order.slice(0, at)].find((i) => !tuned.has(i))
}
