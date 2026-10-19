import { describe, expect, it } from 'vitest'
import { centsOff, INSTRUMENTS, INSTRUMENTS_BY_ID, nextToTune, noteLabel, searchRange, stringNumber, tuneHint, tuneOrder } from './tunings'
import { midiToFreq } from './chords'

const labels = (instrument: string, tuning: string) => INSTRUMENTS_BY_ID[instrument].tunings.find((t) => t.id === tuning)!.notes.map(noteLabel)

describe('instruments and tunings', () => {
  it('list each string in order from the bass side', () => {
    expect(labels('acoustic', 'standard')).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4'])
    expect(labels('electric', 'drop-d')).toEqual(['D2', 'A2', 'D3', 'G3', 'B3', 'E4'])
    expect(labels('acoustic', 'half-down')).toEqual(['D#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'])
    expect(labels('acoustic', 'open-g')).toEqual(['D2', 'G2', 'D3', 'G3', 'B3', 'D4'])
    expect(labels('acoustic', 'dadgad')).toEqual(['D2', 'A2', 'D3', 'G3', 'A3', 'D4'])
    expect(labels('bass', 'standard')).toEqual(['E1', 'A1', 'D2', 'G2'])
    expect(labels('ukulele', 'standard')).toEqual(['G4', 'C4', 'E4', 'A4'])
  })

  it('match the headstock: six pegs for guitars, seven or three for those guitars, four for bass and ukulele', () => {
    const STRINGS: Record<string, number> = { bass: 4, ukulele: 4, seven: 7, three: 3 }
    for (const inst of INSTRUMENTS) {
      const strings = STRINGS[inst.id] ?? 6
      for (const t of inst.tunings) expect(t.notes, `${inst.name} ${t.name}`).toHaveLength(strings)
      expect(['three-a-side', 'three-a-side-outer-near', 'six-in-line'].includes(inst.layout)).toBe(strings >= 6)
    }
  })

  it('have unique ids', () => {
    expect(new Set(INSTRUMENTS.map((i) => i.id)).size).toBe(INSTRUMENTS.length)
    for (const inst of INSTRUMENTS) expect(new Set(inst.tunings.map((t) => t.id)).size).toBe(inst.tunings.length)
  })
})

describe('tuning math', () => {
  it('measures cents sharp and flat', () => {
    expect(centsOff(midiToFreq(40), 40)).toBeCloseTo(0)
    expect(centsOff(midiToFreq(40) * 2 ** (10 / 1200), 40)).toBeCloseTo(10)
    expect(centsOff(midiToFreq(39), 40)).toBeCloseTo(-100)
  })

  it('tells you which way to turn', () => {
    expect(tuneHint(3)).toEqual({ kind: 'in-tune' })
    expect(tuneHint(-30)).toEqual({ kind: 'up', semitones: 0 })
    expect(tuneHint(40)).toEqual({ kind: 'down', semitones: 0 })
    expect(tuneHint(-210)).toEqual({ kind: 'up', semitones: 2 })
  })

  it('searches 9 semitones either side of the target, so a badly detuned string is still found', () => {
    const { minHz, maxHz } = searchRange(40)
    expect(minHz).toBeCloseTo(midiToFreq(31))
    expect(maxHz).toBeCloseTo(midiToFreq(49))
  })
})

describe('tuning order', () => {
  const guitar = INSTRUMENTS_BY_ID['acoustic'].tunings[0]
  const uke = INSTRUMENTS_BY_ID['ukulele'].tunings[0]

  it('starts at the highest string and works down to the bass side', () => {
    expect(tuneOrder(guitar).map((i) => noteLabel(guitar.notes[i]))).toEqual(['E4', 'B3', 'G3', 'D3', 'A2', 'E2'])
    expect(tuneOrder(uke).map((i) => noteLabel(uke.notes[i]))).toEqual(['A4', 'E4', 'C4', 'G4'])
  })

  it('numbers strings the standard way: 1 is the high e, 6 the low E', () => {
    expect(stringNumber(guitar, 5)).toBe(1)
    expect(stringNumber(guitar, 0)).toBe(6)
  })

  it('moves on to the next string, skipping ones already in tune, and stops when all are done', () => {
    const order = tuneOrder(guitar) // [5, 4, 3, 2, 1, 0]
    expect(nextToTune(order, 5, new Set([5]))).toBe(4)
    expect(nextToTune(order, 4, new Set([5, 4, 3]))).toBe(2)
    expect(nextToTune(order, 0, new Set([0, 5]))).toBe(4) // wraps round to a skipped string
    expect(nextToTune(order, 0, new Set([0, 1, 2, 3, 4, 5]))).toBeUndefined()
  })
})
