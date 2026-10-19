export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export type ChordGroup = 'Major' | 'Minor' | '7th' | 'Other'

export interface Chord {
  id: string
  name: string
  group: ChordGroup
  /** Fret per string, -1 = muted, 0 = open */
  frets: number[]
  /** Finger per string (1 index … 4 pinky), 0 = none */
  fingers: number[]
  barre?: { fret: number; from: number; to: number }
}

const c = (
  id: string,
  group: ChordGroup,
  shape: string,
  fingers: string,
  barre?: Chord['barre'],
  name = id,
): Chord => ({
  id,
  name,
  group,
  frets: [...shape].map((ch) => (ch === 'x' ? -1 : parseInt(ch, 10))),
  fingers: [...fingers].map((ch) => (ch === 'x' ? 0 : parseInt(ch, 10))),
  barre,
})

/** The chord shapes on a six-string guitar; other guitars' shapes are derived from them. */
const SIX_STRING_CHORDS: Chord[] = [
  c('C', 'Major', 'x32010', 'x32010'),
  c('D', 'Major', 'xx0232', 'xx0132'),
  c('E', 'Major', '022100', '023100'),
  c('F', 'Major', '133211', '134211', { fret: 1, from: 0, to: 5 }),
  c('G', 'Major', '320003', '210003'),
  c('A', 'Major', 'x02220', 'x01230'),
  c('Am', 'Minor', 'x02210', 'x02310'),
  c('Bm', 'Minor', 'x24432', 'x13421', { fret: 2, from: 1, to: 5 }),
  c('Dm', 'Minor', 'xx0231', 'xx0231'),
  c('Em', 'Minor', '022000', '023000'),
  c('A7', '7th', 'x02020', 'x02030'),
  c('B7', '7th', 'x21202', 'x21304'),
  c('C7', '7th', 'x32310', 'x32410'),
  c('D7', '7th', 'xx0212', 'xx0213'),
  c('E7', '7th', '020100', '020100'),
  c('G7', '7th', '320001', '320001'),
  c('Am7', '7th', 'x02010', 'x02010'),
  c('Em7', '7th', '020000', '020000'),
  c('Cadd9', 'Other', 'x32033', 'x21034'),
  c('Fmaj7', 'Other', 'xx3210', 'xx3210'),
  c('Asus2', 'Other', 'x02200', 'x01200'),
  c('Dsus4', 'Other', 'xx0233', 'xx0123'),
  c('Esus4', 'Other', '022200', '023400'),
]

export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export interface Guitar {
  id: string
  name: string
  hint: string
  /** Open-string MIDI notes, from the bass side */
  open: number[]
  /** Short names for the neck, from the bass side */
  names: string[]
  /** Names for the coach to say */
  spoken: string[]
  /** String thickness in px */
  gauge: number[]
  wound: boolean[]
}

export const GUITARS: Guitar[] = [
  {
    id: 'six',
    name: '6-string',
    hint: 'A standard guitar, acoustic, electric or classical',
    open: [40, 45, 50, 55, 59, 64],
    names: ['E', 'A', 'D', 'G', 'B', 'e'],
    spoken: ['low E', 'A', 'D', 'G', 'B', 'high E'],
    gauge: [4.2, 3.5, 2.8, 2.1, 1.6, 1.25],
    wound: [true, true, true, false, false, false],
  },
  {
    id: 'seven',
    name: '7-string',
    hint: 'An extra low B below the low E',
    open: [35, 40, 45, 50, 55, 59, 64],
    names: ['B', 'E', 'A', 'D', 'G', 'B', 'e'],
    spoken: ['low B', 'low E', 'A', 'D', 'G', 'B', 'high E'],
    gauge: [4.6, 4.0, 3.4, 2.7, 2.0, 1.55, 1.2],
    wound: [true, true, true, true, false, false, false],
  },
  {
    id: 'three',
    name: '3-string',
    hint: 'Tuned G B E, like a Loog: a guitar’s top three strings',
    open: [55, 59, 64],
    names: ['G', 'B', 'E'],
    spoken: ['G', 'B', 'high E'],
    gauge: [2.6, 2.0, 1.5],
    wound: [false, false, false],
  },
]

export const GUITARS_BY_ID: Record<string, Guitar> = Object.fromEntries(GUITARS.map((g) => [g.id, g]))

/** The longest string count of any guitar, for buffers that must fit them all. */
export const MAX_STRINGS = Math.max(...GUITARS.map((g) => g.open.length))

/**
 * A six-string shape on another guitar. A 7-string's low B rings open when B is in the chord and
 * the low E is played too (E, G, Em…), and is muted otherwise. A 3-string plays the top three
 * strings of the shape, which is how Loog chord charts are drawn.
 */
export function adaptChord(chord: Chord, to: Guitar): Chord {
  const six = GUITARS_BY_ID.six
  if (to.id === 'seven') {
    const hasB = [...chordPitchClasses(chord, six.open)].includes(11)
    return {
      ...chord,
      frets: [hasB && chord.frets[0] >= 0 ? 0 : -1, ...chord.frets],
      fingers: [0, ...chord.fingers],
      barre: chord.barre && { ...chord.barre, from: chord.barre.from + 1, to: chord.barre.to + 1 },
    }
  }
  if (to.id === 'three') {
    const drop = 3
    const barre = chord.barre && chord.barre.to >= drop ? { ...chord.barre, from: Math.max(0, chord.barre.from - drop), to: chord.barre.to - drop } : undefined
    return { ...chord, frets: chord.frets.slice(drop), fingers: chord.fingers.slice(drop), barre }
  }
  return chord
}

// The guitar being played. These are live bindings: `setGuitar` swaps them for every importer.
export let guitar: Guitar = GUITARS_BY_ID.six
/** Strings are indexed from the bass side: on a 6-string 0 = low E, 5 = high e. */
export let STRING_NAMES = guitar.names
export let OPEN_MIDI = guitar.open
export let SPOKEN_STRING = guitar.spoken
export let CHORDS: Chord[] = SIX_STRING_CHORDS
export let CHORDS_BY_ID: Record<string, Chord> = Object.fromEntries(CHORDS.map((ch) => [ch.id, ch]))

export function setGuitar(id: string) {
  const next = GUITARS_BY_ID[id] ?? GUITARS_BY_ID.six
  if (next === guitar) return
  guitar = next
  STRING_NAMES = next.names
  OPEN_MIDI = next.open
  SPOKEN_STRING = next.spoken
  CHORDS = SIX_STRING_CHORDS.map((ch) => adaptChord(ch, next))
  CHORDS_BY_ID = Object.fromEntries(CHORDS.map((ch) => [ch.id, ch]))
}

export const stringMidi = (chord: Chord, s: number, open = OPEN_MIDI) =>
  chord.frets[s] < 0 ? null : open[s] + chord.frets[s]

export const chordPitchClasses = (chord: Chord, open = OPEN_MIDI): Set<number> => {
  const pcs = new Set<number>()
  chord.frets.forEach((_, s) => {
    const m = stringMidi(chord, s, open)
    if (m !== null) pcs.add(m % 12)
  })
  return pcs
}

export const PRESETS: { name: string; chords: string[] }[] = [
  { name: 'Beginner: Em → G', chords: ['Em', 'G'] },
  { name: 'G – C – D', chords: ['G', 'C', 'D', 'G'] },
  { name: 'Pop: C – G – Am – F', chords: ['C', 'G', 'Am', 'F'] },
  { name: 'Am – F – C – G', chords: ['Am', 'Fmaj7', 'C', 'G'] },
  { name: 'Blues in E', chords: ['E7', 'E7', 'A7', 'E7', 'B7', 'A7', 'E7', 'B7'] },
  { name: 'D – A – Bm – G', chords: ['D', 'A', 'Bm', 'G'] },
  { name: 'E – A – D', chords: ['E', 'A', 'D', 'A'] },
]
