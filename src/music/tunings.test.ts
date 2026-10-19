import { describe, expect, it } from 'vitest'
import { centsOff, INSTRUMENTS, INSTRUMENTS_BY_ID, noteLabel, searchRange, tuneHint } from './tunings'
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

  it('match the headstock: six pegs for guitars, four for bass and ukulele', () => {
    for (const inst of INSTRUMENTS) {
      const strings = ['bass', 'ukulele'].includes(inst.id) ? 4 : 6
      for (const t of inst.tunings) expect(t.notes, `${inst.name} ${t.name}`).toHaveLength(strings)
      expect(['three-a-side', 'six-in-line'].includes(inst.layout)).toBe(strings === 6)
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
