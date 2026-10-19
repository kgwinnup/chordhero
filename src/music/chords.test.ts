import { describe, expect, it } from 'vitest'
import { CHORDS, CHORDS_BY_ID, chordPitchClasses, midiToFreq, NOTE_NAMES, OPEN_MIDI, PRESETS, STRING_NAMES, stringMidi } from './chords'

const noteName = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`

/** Chord tones from the chord's name, as semitones above the root. */
const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  add9: [0, 4, 7, 2],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
}

function spell(name: string) {
  const [, root, quality] = /^([A-G]#?)(.*)$/.exec(name)!
  const rootPc = NOTE_NAMES.indexOf(root)
  return { rootPc, tones: QUALITY[quality].map((i) => (rootPc + i) % 12) }
}

describe('strings', () => {
  it('are indexed low E (0) to high e (5), in standard tuning', () => {
    expect(STRING_NAMES).toEqual(['E', 'A', 'D', 'G', 'B', 'e'])
    expect(OPEN_MIDI.map(noteName)).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4'])
  })

  it('open low E is 82.4 Hz and A is 110 Hz', () => {
    expect(midiToFreq(OPEN_MIDI[0])).toBeCloseTo(82.41, 1)
    expect(midiToFreq(OPEN_MIDI[1])).toBeCloseTo(110, 5)
  })
})

describe('chord library', () => {
  it('has unique ids', () => {
    expect(new Set(CHORDS.map((c) => c.id)).size).toBe(CHORDS.length)
  })

  it.each(CHORDS.map((c) => [c.name, c] as const))('%s has one fret and one finger per string', (_, chord) => {
    expect(chord.frets).toHaveLength(6)
    expect(chord.fingers).toHaveLength(6)
  })

  it.each(CHORDS.map((c) => [c.name, c] as const))('%s only plays its own chord tones, with the root lowest', (name, chord) => {
    const { rootPc, tones } = spell(name)
    const played = [...chordPitchClasses(chord)]
    for (const pc of played) expect(tones, `${name} plays ${NOTE_NAMES[pc]}`).toContain(pc)
    // Every chord tone is present except possibly the fifth (C7 drops its G, as is standard).
    const fifth = (rootPc + 7) % 12
    for (const t of tones) if (t !== fifth) expect(played, `${name} is missing ${NOTE_NAMES[t]}`).toContain(t)
    const lowest = Math.min(...chord.frets.map((_, s) => stringMidi(chord, s) ?? Infinity))
    expect(lowest % 12, `${name} bass note`).toBe(rootPc)
  })

  it.each(CHORDS.map((c) => [c.name, c] as const))('%s fingering matches its frets', (name, chord) => {
    chord.frets.forEach((fret, s) => {
      const finger = chord.fingers[s]
      if (fret <= 0) expect(finger, `${name} string ${STRING_NAMES[s]}`).toBe(0)
      else expect(finger, `${name} string ${STRING_NAMES[s]}`).toBeGreaterThanOrEqual(1)
      expect(finger).toBeLessThanOrEqual(4)
    })
    // One finger can cover several strings only on the same fret (a barre).
    const fretOf = new Map<number, number>()
    chord.fingers.forEach((finger, s) => {
      if (!finger) return
      const fret = chord.frets[s]
      if (fretOf.has(finger)) expect(fret, `${name}: finger ${finger} on two frets`).toBe(fretOf.get(finger))
      fretOf.set(finger, fret)
    })
  })

  it.each(CHORDS.filter((c) => c.barre).map((c) => [c.name, c] as const))('%s barre covers fretted strings at its lowest fret', (name, chord) => {
    const barre = chord.barre!
    const fretted = chord.frets.filter((f) => f > 0)
    expect(barre.fret).toBe(Math.min(...fretted))
    for (let s = barre.from; s <= barre.to; s++) expect(chord.frets[s], `${name} string ${STRING_NAMES[s]}`).toBeGreaterThanOrEqual(barre.fret)
    expect(chord.fingers[barre.from]).toBe(1)
    expect(chord.fingers[barre.to]).toBe(1)
  })

  it('every chord fits on the 5 frets the neck shows', () => {
    for (const chord of CHORDS) expect(Math.max(...chord.frets), chord.name).toBeLessThanOrEqual(5)
  })

  it('spot-checks a few voicings string by string', () => {
    const notes = (id: string) => CHORDS_BY_ID[id].frets.map((_, s) => (stringMidi(CHORDS_BY_ID[id], s) === null ? 'x' : noteName(stringMidi(CHORDS_BY_ID[id], s)!)))
    expect(notes('Em')).toEqual(['E2', 'B2', 'E3', 'G3', 'B3', 'E4'])
    expect(notes('G')).toEqual(['G2', 'B2', 'D3', 'G3', 'B3', 'G4'])
    expect(notes('C')).toEqual(['x', 'C3', 'E3', 'G3', 'C4', 'E4'])
    expect(notes('D')).toEqual(['x', 'x', 'D3', 'A3', 'D4', 'F#4'])
    expect(notes('Am')).toEqual(['x', 'A2', 'E3', 'A3', 'C4', 'E4'])
    expect(notes('F')).toEqual(['F2', 'C3', 'F3', 'A3', 'C4', 'F4'])
  })

  it('presets only use chords that exist', () => {
    for (const p of PRESETS) for (const id of p.chords) expect(CHORDS_BY_ID[id], `${p.name}: ${id}`).toBeDefined()
  })
})
