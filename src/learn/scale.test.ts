import { describe, expect, it } from 'vitest'
import { GUITARS } from '../music/chords'
import { gradeNotes, inScale, newNoteScores, noteName, playedNotes, runScore, SCALES, scaleNotes, upAndDown } from './scale'

const em = SCALES['em-pent']
const six = GUITARS.find((g) => g.id === 'six')!.open

describe('E minor pentatonic', () => {
  it('lays out the open-position box on a 6-string', () => {
    const notes = scaleNotes(em, six)
    expect(notes.map((n) => `${n.string}:${n.fret}`)).toEqual(['0:0', '0:3', '1:0', '1:2', '2:0', '2:2', '3:0', '3:2', '4:0', '4:3', '5:0', '5:3'])
    expect(notes.map((n) => noteName(n.midi)).join(' ')).toBe('E G A B D E G A B D E G')
    expect(notes.filter((n) => n.root).map((n) => n.midi)).toEqual([40, 52, 64])
  })

  it('lays out A minor pentatonic in open position too', () => {
    const notes = scaleNotes(SCALES['am-pent'], six)
    expect(notes.map((n) => `${n.string}:${n.fret}`)).toEqual(['0:0', '0:3', '1:0', '1:3', '2:0', '2:2', '3:0', '3:2', '4:1', '4:3', '5:0', '5:3'])
    expect(notes.map((n) => noteName(n.midi)).join(' ')).toBe('E G A C D E G A C D E G')
    expect(notes.filter((n) => n.root).map((n) => n.midi)).toEqual([45, 57])
  })

  it('finds only scale notes on every guitar, with no note twice', () => {
    for (const g of GUITARS) for (const scale of Object.values(SCALES)) {
      const notes = scaleNotes(scale, g.open)
      expect(notes.length).toBeGreaterThan(4)
      expect(new Set(notes.map((n) => n.midi)).size).toBe(notes.length)
      for (const n of notes) expect(inScale(scale, n.midi)).toBe(true)
    }
  })

  it('runs up and back down, playing the top note once', () => {
    expect(upAndDown([1, 2, 3])).toEqual([1, 2, 3, 2, 1])
  })
})

describe('grading a run', () => {
  const run = [40, 43, 45, 47]
  const at = (i: number, off = 0) => 1 + i * 0.5 + off

  it('scores right notes in time', () => {
    const g = gradeNotes(run, 1, 0.5, run.map((midi, i) => ({ at: at(i), midi })))
    expect(g.slots).toEqual(['hit', 'hit', 'hit', 'hit'])
    expect(runScore(g, run.length)).toBe(100)
  })

  it('tells wrong notes, early and late ones, and misses apart', () => {
    const g = gradeNotes(run, 1, 0.5, [
      { at: at(0, -0.1), midi: 40 },
      { at: at(1), midi: 44 },
      { at: at(2, 0.1), midi: 45 },
    ])
    expect(g.slots).toEqual(['early', 'wrong', 'late', 'miss'])
    expect(g.hits).toBe(2)
    expect(runScore(g, run.length)).toBe(50)
  })

  it('counts stray and doubled notes against you, and leaves the future pending', () => {
    const g = gradeNotes(run, 1, 0.5, [{ at: at(0), midi: 40 }, { at: at(0, 0.03), midi: 40 }, { at: at(0.5), midi: 41 }], at(1))
    expect(g.slots).toEqual(['hit', 'pending', 'pending', 'pending'])
    expect(g.extras).toBe(2)
  })
})

describe('hearing the note a pick added', () => {
  const binHz = 48000 / 16384
  const bins = 8192
  /** A spectrum in dB: a noise floor plus each note's harmonics, `amps[h]` for harmonic h+1. */
  const spectrum = (notes: { midi: number; gain: number; amps?: number[] }[]) => {
    const power = new Float64Array(bins).fill(1e-9)
    for (const { midi, gain, amps = [1, 0.8, 0.6, 0.45, 0.35, 0.25, 0.18, 0.12] } of notes) {
      const f0 = 440 * 2 ** ((midi - 69) / 12)
      amps.forEach((a, h) => {
        const bin = (f0 * (h + 1)) / binHz
        for (let b = Math.floor(bin) - 2; b <= Math.ceil(bin) + 2; b++) if (b > 0 && b < bins) power[b] += (gain * a) ** 2 * Math.exp(-((b - bin) ** 2))
      })
    }
    return Float32Array.from(power, (p) => 10 * Math.log10(p))
  }
  const midis = Array.from({ length: 32 }, (_, i) => 38 + i)
  const heard = (before: Parameters<typeof spectrum>[0], after: Parameters<typeof spectrum>[0]) =>
    playedNotes(newNoteScores(spectrum(before), spectrum(after), binHz, midis), midis, 1e-6)

  it('hears the new note, not the louder one still ringing', () => {
    expect(heard([{ midi: 40, gain: 0.05 }], [{ midi: 40, gain: 0.04 }, { midi: 45, gain: 0.02 }])[0]).toBe(45)
    expect(heard([{ midi: 43, gain: 0.05 }, { midi: 45, gain: 0.03 }], [{ midi: 43, gain: 0.045 }, { midi: 45, gain: 0.025 }, { midi: 47, gain: 0.02 }])[0]).toBe(47)
  })

  it("doesn't take a note for the octave below or above", () => {
    expect(heard([], [{ midi: 52, gain: 0.03 }])[0]).toBe(52)
    // A low E through a small mic: its fundamental barely there.
    expect(heard([], [{ midi: 40, gain: 0.03, amps: [0.25, 1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2] }])).toContain(40)
  })

  it("doesn't take a note for the one a fifth below, whose 3rd harmonic it is", () => {
    // F2 has C4 as its 3rd harmonic, but nothing at F2 or F3. (The octave below may still be
    // heard, sharing every other harmonic: the same note name, which is what a jam judges by.)
    for (const midi of [60, 55, 48]) expect(noteName(Math.min(...heard([], [{ midi, gain: 0.03 }])))).toBe(noteName(midi))
  })

  it('hears nothing when nothing new sounded', () => {
    expect(heard([{ midi: 40, gain: 0.05 }], [{ midi: 40, gain: 0.04 }])).toEqual([])
  })
})
