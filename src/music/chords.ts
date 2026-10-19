// Strings are indexed low → high: 0 = low E, 5 = high e (standard tuning).
export const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e']
export const OPEN_MIDI = [40, 45, 50, 55, 59, 64]
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

export const CHORDS: Chord[] = [
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

export const CHORDS_BY_ID: Record<string, Chord> = Object.fromEntries(CHORDS.map((ch) => [ch.id, ch]))

export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export const stringMidi = (chord: Chord, s: number) =>
  chord.frets[s] < 0 ? null : OPEN_MIDI[s] + chord.frets[s]

export const chordPitchClasses = (chord: Chord): Set<number> => {
  const pcs = new Set<number>()
  chord.frets.forEach((_, s) => {
    const m = stringMidi(chord, s)
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
