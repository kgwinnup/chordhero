/**
 * Pure spectrum analysis: which strings of a chord are ringing, and how chord-like the sound is.
 * Works on a dB magnitude spectrum (as from AnalyserNode.getFloatFrequencyData), so it can be
 * unit-tested with synthetic spectra, no Web Audio needed.
 */
import { type Chord, chordPitchClasses, midiToFreq, stringMidi } from '../music/chords'

// ±30 cents around each expected note: tight enough that a loud strum's dense overtones rarely land
// on a string's note by chance (and the tuner gets the guitar well within it).
export const TOLERANCE = Math.pow(2, 30 / 1200)
/** Overtones checked per string, and how much each is discounted (indexed by harmonic number). */
export const HARMONIC_PENALTY = [0, 0, 0, 3, 6, 8, 10]
/**
 * Overtones checked above the fundamental. Higher overtones crowd together, so in a loud strum some
 * other note's overtone is nearly always nearby; only bass strings, whose fundamentals small mics
 * barely hear, need the higher ones.
 */
/** How many bins a peak spills over on each side (window main lobe). */
const LEAK_BINS = 3
const MAX_HARMONIC = 3
const MAX_HARMONIC_BASS = 6
/** Each note is compared with the noise within half an octave either side of it. */
const LOCAL_FLOOR_SPAN = Math.SQRT2
/** Bass strings get this much slack: even with a local floor, built-in mics hear them least clearly. */
const BASS_RELIEF_DB = 4
const BASS_BELOW_HZ = 130
/**
 * When a string's note could be an overtone of a lower string that's sounding, it only counts
 * if it stands this far above the loudest of that string's other overtones around it.
 */
export const OVERTONE_EXCESS_DB = 8
/**
 * A lower string this far above the noise counts as a possible source of overtones even before
 * it lights: early in a pluck its overtones are already strong while its own note is still rising.
 */
const SOURCE_PRESENT_DB = 6
/**
 * In a strum (enough strings sounding on their own evidence), a string on a lower string's
 * overtone counts if it adds this much over what that string alone would put there.
 */
export const STRUM_EXCESS_DB = 2
/** Assumed fade per overtone step when estimating a string's overtone from one side only. */
const OVERTONE_FADE_DB = 3
/** Strings with their own evidence needed to treat the sound as a strum: at least this many… */
const STRUM_MIN_STRINGS = 3
/** …and at least this share of the chord's strings. */
const STRUM_MIN_SHARE = 0.5
/**
 * A chord counts only if no chord with different notes fits the sound better, give or take this
 * much (so near-twins like Em and Em7 don't trip it).
 */
export const RIVAL_LEEWAY = 0.03
/** Highest partial considered. */
const MAX_PARTIAL_HZ = 2500
/** Above this spectral flatness the sound is noise-like (key clicks, taps, rustle), not strings. */
export const MAX_FLATNESS = 0.3

export interface StringScores {
  /** Per string (low E → high e): dB its best usable partial stands above the local noise */
  scores: number[]
  /** Per string: reads as ringing this frame */
  ringing: boolean[]
  /** Per string: ringing on evidence no other string explains (see `scoreStrings`) */
  independent: boolean[]
}

/** The note each string plays in a chord, in Hz, or null when it's muted. Index 0 = low E. */
export const chordFrequencies = (chord: Chord) =>
  chord.frets.map((_, s) => {
    const m = stringMidi(chord, s)
    return m === null ? null : midiToFreq(m)
  })

export function median(spec: ArrayLike<number>, lo: number, hi: number) {
  const slice = Array.prototype.slice.call(spec, Math.max(0, lo), Math.min(spec.length, hi)) as number[]
  slice.sort((a, b) => a - b)
  return slice[slice.length >> 1]
}

/** Spectral flatness (0 = pure tones … 1 = white noise) over a bin range. */
export function flatness(spec: ArrayLike<number>, lo: number, hi: number) {
  let logSum = 0
  let sum = 0
  for (let b = lo; b < hi; b++) {
    logSum += spec[b] * (Math.LN10 / 10)
    sum += Math.pow(10, spec[b] / 10)
  }
  const n = hi - lo
  return sum > 0 ? Math.exp(logSum / n) / (sum / n) : 1
}

export const toBin = (f: number, binHz: number) => Math.round(f / binHz)

/** Loudest bin within ±TOLERANCE of `f`. */
export function peakAt(spec: ArrayLike<number>, binHz: number, f: number) {
  const lo = Math.floor(f / TOLERANCE / binHz)
  const hi = Math.ceil((f * TOLERANCE) / binHz)
  let max = -Infinity
  for (let b = Math.max(0, lo); b <= hi && b < spec.length; b++) max = Math.max(max, spec[b])
  return max
}

/**
 * How far the partial at `f` stands above the noise within half an octave of it. Measuring
 * against local noise means a mic's bass rolloff and room rumble cancel out.
 */
export function contrastAt(spec: ArrayLike<number>, binHz: number, f: number) {
  return peakAt(spec, binHz, f) - median(spec, toBin(f / LOCAL_FLOOR_SPAN, binHz), toBin(f * LOCAL_FLOOR_SPAN, binHz) + 1)
}

/**
 * How far each of a chord's notes stands above the local noise right now (0 for muted strings).
 * Bass strings also count their first overtone, since small mics barely hear their fundamental.
 */
export function noteLevels(spec: ArrayLike<number>, binHz: number, chord: Chord) {
  return chordFrequencies(chord).map((f) =>
    f === null ? 0 : f < BASS_BELOW_HZ ? Math.max(contrastAt(spec, binHz, f), contrastAt(spec, binHz, 2 * f) - HARMONIC_PENALTY[3]) : contrastAt(spec, binHz, f),
  )
}

/** A picked string's note must jump at least this much from just before the pick. */
export const PICK_RISE_DB = 6

/**
 * Did picking a single string make it ring? Judged by how much its note rose from just before the
 * pick, not by whether it's there: when strings picked earlier are still ringing, their overtones
 * already sit on this string's note (the A string's 3rd overtone is the high e), so presence proves
 * nothing, but only the string itself makes it jump.
 */
export const pickRang = (before: number, after: number, threshold: number) => after - before >= PICK_RISE_DB && after >= threshold

export const isNoiseLike = (spec: ArrayLike<number>, binHz: number) => flatness(spec, toBin(70, binHz), toBin(3000, binHz)) >= MAX_FLATNESS

/**
 * Decide which of a chord's strings are ringing.
 *
 * A plucked string's overtones land on other strings' notes (in Em the low E's 2nd, 3rd and 4th
 * overtones are the D, B and high e strings' notes), so strings are decided from low to high
 * pitch: a higher string's note that could be an overtone of a lower string that's sounding only
 * counts if it clearly stands out from that string's overtone envelope. When a full strum leaves
 * nothing clean to compare against, it gets the benefit of the doubt, but such strings aren't
 * "independent" and can't vouch for others (so they can't keep each other lit).
 *
 * @param allowed false when the input is too quiet or noise-like: nothing may ring
 * @param prevIndependent each string's `independent` from the previous frame
 */
export function scoreStrings(
  spec: ArrayLike<number>,
  binHz: number,
  chord: Chord,
  threshold: number,
  allowed: boolean,
  prevIndependent: readonly boolean[] = [],
): StringScores {
  const strict = decide(spec, binHz, chord, threshold, allowed, prevIndependent, false)
  // A full strum covers every overtone with some string, so the single-note rule would leave
  // octave strings (the D string's E3 over the low E) dark. When enough strings sound on their own
  // evidence, it's a strum: judge overtone strings by how much they add instead.
  const sounding = chord.frets.filter((f) => f >= 0).length
  const own = strict.independent.filter(Boolean).length
  if (own < Math.max(STRUM_MIN_STRINGS, Math.ceil(sounding * STRUM_MIN_SHARE))) return strict
  const strum = decide(spec, binHz, chord, threshold, allowed, prevIndependent, true)
  return { ...strum, independent: strict.independent }
}

/** A muted string must stand this much further above the noise than a played one to count as hit. */
export const MUTED_EXTRA_DB = 6

/** Open-string notes in standard tuning, low E → high e, in Hz. */
const OPEN_HZ = [82.41, 110, 146.83, 196, 246.94, 329.63]

/**
 * The chord's muted strings (✕) that are ringing open anyway, strummed by mistake (the low E in
 * Am). A muted string is always below every string that's played, so nothing else's overtones land
 * on its note; it's judged on that note alone, measured narrowly so a nearby note's spill can't
 * count, and needs extra margin so a string humming in sympathy doesn't.
 */
export function mutedRinging(spec: ArrayLike<number>, binHz: number, chord: Chord, threshold: number, allowed: boolean): boolean[] {
  return chord.frets.map((f, s) => {
    if (!allowed || f >= 0) return false
    const hz = OPEN_HZ[s]
    const b = Math.round(hz / binHz)
    const peak = Math.max(spec[b - 1], spec[b], spec[b + 1])
    const floor = median(spec, toBin(hz / LOCAL_FLOOR_SPAN, binHz), toBin(hz * LOCAL_FLOOR_SPAN, binHz) + 1)
    return peak - floor > threshold + MUTED_EXTRA_DB - (hz < BASS_BELOW_HZ ? BASS_RELIEF_DB : 0)
  })
}

function decide(
  spec: ArrayLike<number>,
  binHz: number,
  chord: Chord,
  threshold: number,
  allowed: boolean,
  prevIndependent: readonly boolean[],
  strum: boolean,
): StringScores {
  const expected = chordFrequencies(chord)
  // Whether two partials could be the same peak. Wider than the measuring window: a peak spills
  // over a few bins either side, so a partial just outside the window still shows up inside it.
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * (TOLERANCE - 1) + LEAK_BINS * binHz
  /** Is `hf` (close to) some overtone of the note `g`? Returns which one, or 0. */
  const overtoneOf = (hf: number, g: number) => {
    const k = Math.round(hf / g)
    return k >= 1 && near(k * g, hf) ? k : 0
  }
  const contrast = (f: number) => contrastAt(spec, binHz, f)

  const scores = new Array<number>(6).fill(0)
  const ringing = new Array<boolean>(6).fill(false)
  const independent = new Array<boolean>(6).fill(false)
  const present = new Array<boolean>(6).fill(false)
  const vouches = (o: number) => independent[o] || !!prevIndependent[o]

  const order = expected.map((f, i) => ({ f, i })).filter((x): x is { f: number; i: number } => x.f !== null).sort((a, b) => a.f - b.f)
  for (const { f, i: s } of order) {
    let best = -Infinity
    let bestOwn = -Infinity
    const maxH = f < BASS_BELOW_HZ ? MAX_HARMONIC_BASS : MAX_HARMONIC
    for (let h = 1; h <= maxH; h++) {
      const hf = h * f
      if (hf > MAX_PARTIAL_HZ) break
      let usable = true
      let own = true
      for (let o = 0; o < 6 && usable; o++) {
        const g = expected[o]
        if (o === s || g === null) continue
        const k = overtoneOf(hf, g)
        if (!k) continue
        if (g >= f) {
          // Our overtone sits on a higher string's note or overtone: it proves nothing about us.
          if (h > 1) usable = false
        } else if (present[o] || ringing[o]) {
          own = false
          if (strum) {
            // Strum: does this peak add to what the lower string alone would put here? Estimate that
            // from its overtones either side that no other string's notes cover, assuming a gentle fade.
            const claimed = (nf: number) => expected.some((g2, o2) => o2 !== o && o2 !== s && g2 !== null && overtoneOf(nf, g2))
            // Use the closest clean overtones (one step away if possible): extrapolating further is unreliable.
            const clean = [k - 1, k + 1, k - 2, k + 2].filter((n) => n >= 1 && n * g <= MAX_PARTIAL_HZ && !claimed(n * g))
            const nearest = Math.min(...clean.map((n) => Math.abs(n - k)))
            const estimates = clean.filter((n) => Math.abs(n - k) === nearest).map((n) => contrast(n * g) - (k - n) * OVERTONE_FADE_DB)
            // Every side covered by other strings: nothing to compare against, benefit of the doubt.
            if (estimates.length) {
              const alone = estimates.reduce((a, b) => a + b, 0) / estimates.length
              if (contrast(hf) - alone < STRUM_EXCESS_DB) usable = false
            }
          } else {
            // Single notes: count it only if it stands out from that string's own overtone envelope:
            // all its overtones up to two past this one (a low E's 2nd overtone is often its
            // loudest), skipping any another string claims.
            const neighbours = Array.from({ length: k + 2 }, (_, n) => n + 1)
              .filter((n) => n !== k && n * g <= MAX_PARTIAL_HZ)
              .map((n) => n * g)
              .filter((nf) => !expected.some((g2, o2) => o2 !== o && o2 !== s && g2 !== null && vouches(o2) && overtoneOf(nf, g2)))
            if (!neighbours.length) continue // nothing to compare against: benefit of the doubt
            if (contrast(hf) - Math.max(...neighbours.map(contrast)) < OVERTONE_EXCESS_DB) usable = false
            else own = true // clearly its own
          }
        }
      }
      if (!usable) continue
      const score = contrast(hf) - HARMONIC_PENALTY[h]
      best = Math.max(best, score)
      if (own) bestOwn = Math.max(bestOwn, score)
    }
    scores[s] = best
    present[s] = best > SOURCE_PRESENT_DB
    const need = threshold - (f < BASS_BELOW_HZ ? BASS_RELIEF_DB : 0)
    ringing[s] = allowed && best > need
    independent[s] = allowed && bestOwn > need
  }
  return { scores, ringing, independent }
}

/**
 * How well the sound fits `chord` compared with every other chord: `match` for the target, and
 * `rival` for the best-fitting chord with different notes. A strum that sounds more like some
 * other chord than the one asked for wasn't that chord, however loud.
 */
export function chordFit(spec: ArrayLike<number>, binHz: number, chord: Chord, others: readonly Chord[]) {
  const profile = pitchProfile(spec, binHz)
  const target = chordPitchClasses(chord)
  const match = profileMatch(profile, chordTemplate(chord))
  let rival = 0
  for (const other of others) {
    // The same notes, or the same notes plus one (Am7 for Am, G7 for G): not a rival. Overtones put
    // a little of every chord's 7th into the sound, so its 7th version can fit as well as it does.
    if (isTwin(target, chordPitchClasses(other))) continue
    rival = Math.max(rival, profileMatch(profile, chordTemplate(other)))
  }
  return { match, rival }
}

/** Cosine similarity (0..1) between the heard pitch-class profile and the chord's notes. */
export function chromaMatch(spec: ArrayLike<number>, binHz: number, chord: Chord) {
  return profileMatch(pitchProfile(spec, binHz), chordTemplate(chord))
}

/** How much of what's heard falls on each of the 12 note names. */
function pitchProfile(spec: ArrayLike<number>, binHz: number) {
  const floor = median(spec, toBin(70, binHz), toBin(MAX_PARTIAL_HZ, binHz))
  const chroma = new Array<number>(12).fill(0)
  for (let b = Math.floor(PROFILE_LO_HZ / binHz); b <= Math.ceil(PROFILE_HI_HZ / binHz); b++) {
    const above = spec[b] - floor - 12
    if (above <= 0) continue
    const midi = Math.round(12 * Math.log2((b * binHz) / 440) + 69)
    chroma[((midi % 12) + 12) % 12] += above
  }
  return chroma
}

/** The range the heard profile covers. */
const PROFILE_LO_HZ = 75
const PROFILE_HI_HZ = 1600
/** How much less each harmonic counts than the one below it, in the template. */
export const HARMONIC_DECAY = 0.9

/**
 * What a chord's strings put on each note name, overtones included: a string's 2nd, 4th and 8th
 * harmonics are its own note again, but its 3rd and 6th are a fifth up, its 5th a major third up
 * and its 7th a minor seventh up (a G string also sounds some D, B and F: without them G reads as
 * G7). The heard profile adds up dB above the noise, so every harmonic in range counts nearly as
 * much as the note itself, and low strings have many more of them in range than high ones.
 */
const templates = new Map<string, number[]>()
function chordTemplate(chord: Chord) {
  let t = templates.get(chord.id)
  if (!t) {
    t = new Array<number>(12).fill(0)
    for (const f of chordFrequencies(chord)) {
      if (f === null) continue
      for (let h = 1; h * f <= PROFILE_HI_HZ; h++) {
        if (h * f < PROFILE_LO_HZ) continue
        const midi = Math.round(12 * Math.log2((h * f) / 440) + 69)
        t[midi % 12] += HARMONIC_DECAY ** (h - 1)
      }
    }
    templates.set(chord.id, t)
  }
  return t
}

/** `other` has all of `target`'s notes and at most one more. */
const isTwin = (target: Set<number>, other: Set<number>) => [...target].every((p) => other.has(p)) && other.size - target.size <= 1

/** Cosine similarity (0..1) between the heard pitch-class profile and a chord's template. */
function profileMatch(chroma: number[], template: number[]) {
  let dot = 0
  let a = 0
  let b = 0
  chroma.forEach((v, pc) => {
    dot += v * template[pc]
    a += v * v
    b += template[pc] * template[pc]
  })
  return a > 0 && b > 0 ? dot / Math.sqrt(a * b) : 0
}
