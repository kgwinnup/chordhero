import { describe, expect, it } from 'vitest'
import { GUITARS, midiToFreq, NOTE_NAMES } from '../music/chords'
import { yinPitch } from './pitch'

const noteLabel = (midi: number) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
const centsOff = (freq: number, targetMidi: number) => 1200 * Math.log2(freq / midiToFreq(targetMidi))
/** Search within 9 semitones of the expected note. */
const searchRange = (targetMidi: number) => ({ minHz: midiToFreq(targetMidi - 9), maxHz: midiToFreq(targetMidi + 9) })

/** A plucked string: a fundamental plus decaying overtones (the 2nd louder than the fundamental, as small mics often hear it), and a little noise. */
function pluck(freq: number, sampleRate: number, length = 16384, seed = 3) {
  const overtones = [0.8, 1, 0.6, 0.45, 0.3, 0.2, 0.12]
  let s = seed
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    let v = 0
    overtones.forEach((a, h) => (v += a * Math.sin(2 * Math.PI * freq * (h + 1) * t + h)))
    out[i] = 0.2 * v * Math.exp(-t * 1.5) + 0.002 * rand()
  }
  return out
}

describe.each([48000, 44100])('at %i Hz', (sampleRate) => {
  const strings = GUITARS.flatMap((g) => g.open.map((midi, i) => [`${g.name}, string ${i + 1} (${noteLabel(midi)})`, midi] as const))

  it.each(strings)('hears %s in tune', (_, midi) => {
    const p = yinPitch(pluck(midiToFreq(midi), sampleRate), sampleRate, searchRange(midi))
    expect(p).not.toBeNull()
    expect(p!.note).toBe(noteLabel(midi))
    expect(Math.abs(centsOff(p!.freq, midi))).toBeLessThan(2)
  })

  it.each([-40, -15, 12, 35])('reads a low E %i cents off as that many cents off', (offset) => {
    const p = yinPitch(pluck(midiToFreq(40) * 2 ** (offset / 1200), sampleRate), sampleRate, searchRange(40))
    expect(centsOff(p!.freq, 40)).toBeCloseTo(offset, 0)
  })

  it('finds a string tuned a few semitones low within its search range', () => {
    const p = yinPitch(pluck(midiToFreq(40 - 4), sampleRate), sampleRate, searchRange(40))
    expect(Math.round(centsOff(p!.freq, 40))).toBe(-400)
  })

  it('reports guitar strings in the right octave despite a loud 2nd overtone', () => {
    for (const midi of [40, 45, 50, 55, 59, 64]) expect(yinPitch(pluck(midiToFreq(midi), sampleRate), sampleRate)!.note).toBe(noteLabel(midi))
  })

  it('stays quiet when there is nothing to hear', () => {
    expect(yinPitch(new Float32Array(16384), sampleRate)).toBeNull()
  })
})
