import { describe, expect, it } from 'vitest'
import { type Chord, chordPitchClasses, CHORDS, CHORDS_BY_ID, STRING_NAMES } from '../music/chords'
import { chordFit, chordFrequencies, chromaMatch, isNoiseLike, RIVAL_LEEWAY, scoreStrings } from './detect'

const SAMPLE_RATE = 48000
const FFT_SIZE = 16384
const BIN_HZ = SAMPLE_RATE / FFT_SIZE
const THRESHOLD = 15 // the app's default sensitivity

/** Small deterministic RNG so every run sees the same noise. */
function rng(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

interface Mic {
  /** dB lost below 120 Hz, as on phone and laptop mics */
  bassRolloff: number
}
const FLAT: Mic = { bassRolloff: 0 }
const PHONE: Mic = { bassRolloff: 12 }

/** A dB spectrum like AnalyserNode gives: a noise floor plus the partials of each plucked string. */
function spectrum(notes: number[], mic: Mic, { level = -40, seed = 1 } = {}) {
  const spec = new Float32Array(FFT_SIZE / 2)
  const rand = rng(seed)
  for (let b = 0; b < spec.length; b++) spec[b] = -100 + (rand() - 0.5) * 6
  const add = (f: number, db: number) => {
    const c = f / BIN_HZ
    for (let b = Math.floor(c) - 3; b <= Math.ceil(c) + 3; b++) {
      const shape = db - 6 * (b - c) ** 2 // a window's main lobe
      spec[b] = 10 * Math.log10(10 ** (spec[b] / 10) + 10 ** (shape / 10))
    }
  }
  for (const f of notes) {
    for (let h = 1; h <= 12; h++) {
      const hf = h * f
      if (hf > 4000) break
      add(hf, level - 5 * (h - 1) - (hf < 120 ? mic.bassRolloff : 0))
    }
  }
  return spec
}

const played = (chord: Chord, strings: number[]) => strings.map((s) => chordFrequencies(chord)[s]!)
const sounding = (chord: Chord) => chord.frets.flatMap((f, s) => (f >= 0 ? [s] : []))
const lit = (ringing: boolean[]) => ringing.flatMap((on, s) => (on ? [STRING_NAMES[s]] : []))

/** Run a few frames, as the app does every animation frame, carrying state between them. */
function listen(chord: Chord, spec: Float32Array) {
  let prev: boolean[] = []
  let result = scoreStrings(spec, BIN_HZ, chord, THRESHOLD, true, prev)
  for (let i = 0; i < 3; i++) {
    prev = result.independent
    result = scoreStrings(spec, BIN_HZ, chord, THRESHOLD, true, prev)
  }
  return result
}

describe.each([
  ['flat mic', FLAT],
  ['phone mic', PHONE],
])('with a %s', (_, mic) => {
  describe('a single plucked string lights only that string', () => {
    const cases = CHORDS.flatMap((chord) => sounding(chord).map((s) => [`${chord.name}, ${STRING_NAMES[s]} string`, chord, s] as const))
    it.each(cases)('%s', (_, chord, s) => {
      const { ringing } = listen(chord, spectrum(played(chord, [s]), mic))
      expect(lit(ringing)).toEqual([STRING_NAMES[s]])
    })
  })

  describe('a full strum lights every string in the chord', () => {
    it.each(CHORDS.map((c) => [c.name, c] as const))('%s', (_, chord) => {
      const { ringing } = listen(chord, spectrum(played(chord, sounding(chord)), mic))
      expect(lit(ringing)).toEqual(sounding(chord).map((s) => STRING_NAMES[s]))
    })
  })

  describe('a strum that skips the lowest string leaves it dark', () => {
    it.each(CHORDS.map((c) => [c.name, c] as const))('%s', (_, chord) => {
      const [lowest, ...rest] = sounding(chord)
      const { ringing } = listen(chord, spectrum(played(chord, rest), mic))
      expect(ringing[lowest]).toBe(false)
    })
  })
})

describe('strings are told apart by pitch, not position', () => {
  it('the open A lights the A string, not low E or D', () => {
    const chord = CHORDS_BY_ID['Am']
    expect(lit(listen(chord, spectrum([110], FLAT)).ringing)).toEqual(['A'])
  })

  it('a G on the low E string lights only the low E string in a G chord', () => {
    const chord = CHORDS_BY_ID['G']
    expect(lit(listen(chord, spectrum([98], FLAT)).ringing)).toEqual(['E'])
  })

  it('muted strings never light, whatever is playing', () => {
    for (const chord of CHORDS) {
      const all = [82.41, 110, 146.83, 196, 246.94, 329.63] // every open string at once
      const { ringing } = listen(chord, spectrum(all, FLAT))
      chord.frets.forEach((f, s) => f < 0 && expect(ringing[s], `${chord.name} ${STRING_NAMES[s]}`).toBe(false))
    }
  })
})

describe('noise', () => {
  it('silence lights nothing', () => {
    expect(lit(listen(CHORDS_BY_ID['Em'], spectrum([], FLAT)).ringing)).toEqual([])
  })

  it('flat, noise-like sound (key clicks) is recognised as noise', () => {
    const spec = new Float32Array(FFT_SIZE / 2)
    const rand = rng(7)
    for (let b = 0; b < spec.length; b++) spec[b] = -50 + 10 * Math.log10(-Math.log(rand() + 1e-9)) // white noise
    expect(isNoiseLike(spec, BIN_HZ)).toBe(true)
    expect(isNoiseLike(spectrum(played(CHORDS_BY_ID['G'], sounding(CHORDS_BY_ID['G'])), FLAT), BIN_HZ)).toBe(false)
  })

  it('nothing rings when the input is gated', () => {
    const chord = CHORDS_BY_ID['G']
    const { ringing } = scoreStrings(spectrum(played(chord, sounding(chord)), FLAT), BIN_HZ, chord, THRESHOLD, false)
    expect(lit(ringing)).toEqual([])
  })
})

describe('chord match', () => {
  it('is high for the right chord and lower for a different one', () => {
    const g = CHORDS_BY_ID['G']
    const spec = spectrum(played(g, sounding(g)), FLAT)
    expect(chromaMatch(spec, BIN_HZ, g)).toBeGreaterThan(0.8)
    expect(chromaMatch(spec, BIN_HZ, CHORDS_BY_ID['Am'])).toBeLessThan(chromaMatch(spec, BIN_HZ, g))
  })
})

describe('telling chords apart', () => {
  const fits = (chord: Chord, spec: Float32Array) => {
    const { match, rival } = chordFit(spec, BIN_HZ, chord, CHORDS)
    return match >= 0.6 && match >= rival - RIVAL_LEEWAY
  }
  const samePitches = (a: Chord, b: Chord) => {
    const pa = chordPitchClasses(a)
    const pb = chordPitchClasses(b)
    return pa.size === pb.size && [...pa].every((p) => pb.has(p))
  }

  describe.each([
    ['flat mic', FLAT],
    ['phone mic', PHONE],
  ])('with a %s', (_, mic) => {
    it.each(CHORDS.map((c) => [c.name, c] as const))('%s played right fits %s better than any other chord', (_, chord) => {
      expect(fits(chord, spectrum(played(chord, sounding(chord)), mic))).toBe(true)
    })

    it('a loudly strummed wrong chord almost never passes for the target', () => {
      let pairs = 0
      let passed = 0
      for (const target of CHORDS) {
        for (const wrong of CHORDS) {
          if (samePitches(target, wrong)) continue
          pairs++
          if (fits(target, spectrum(played(wrong, sounding(wrong)), mic, { level: -30 }))) passed++
        }
      }
      expect(passed / pairs).toBeLessThan(0.02)
    })

    it('bashing all six open strings passes for at most a couple of chords', () => {
      const open = spectrum([82.41, 110, 146.83, 196, 246.94, 329.63], mic, { level: -30 })
      expect(CHORDS.filter((c) => fits(c, open)).length).toBeLessThanOrEqual(2)
    })
  })
})
