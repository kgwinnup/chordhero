import { NOTE_NAMES } from '../music/chords'

export interface Pitch {
  freq: number
  note: string
  /** How far off the nearest note, −50…50 */
  cents: number
}

export interface PitchRange {
  minHz?: number
  maxHz?: number
}

/** Below this RMS there's nothing to measure. */
const QUIET_RMS = 0.003
/** YIN's threshold on the normalised difference: lower is pickier. */
const YIN_THRESHOLD = 0.15

/**
 * Pitch of a single note with YIN (de Cheveigné & Kawahara) on the newest samples of `samples`.
 * Unlike picking the loudest spectral peak, it isn't fooled into octave errors by a plucked
 * string's strong overtones. Searching a narrow range around the expected note (as the tuner
 * does) rules out octave mistakes entirely.
 */
export function yinPitch(samples: Float32Array, sampleRate: number, { minHz = 70, maxHz = 1100 }: PitchRange = {}): Pitch | null {
  // The window must hold at least two periods of the lowest pitch (a bass's low E is 41 Hz).
  const W = Math.min(Math.floor(samples.length / 2), Math.max(2048, 2 ** Math.ceil(Math.log2((2.2 * sampleRate) / minHz))))
  const x = samples.subarray(samples.length - W * 2)
  let energy = 0
  for (let i = W; i < W * 2; i++) energy += x[i] * x[i]
  if (Math.sqrt(energy / W) < QUIET_RMS) return null

  const minTau = Math.max(2, Math.floor(sampleRate / maxHz))
  const maxTau = Math.min(W - 1, Math.ceil(sampleRate / minHz))
  // Cumulative-mean-normalised difference function, stopping at the first clear dip.
  const d = new Float32Array(maxTau + 2)
  d[0] = 1
  let running = 0
  let tau = -1
  for (let t = 1; t <= maxTau + 1; t++) {
    let sum = 0
    for (let i = 0; i < W; i++) {
      const diff = x[i] - x[i + t]
      sum += diff * diff
    }
    running += sum
    d[t] = running ? (sum * t) / running : 1
    const prev = t - 1
    if (prev >= minTau && d[prev] < YIN_THRESHOLD && d[prev] <= d[t] && d[prev] <= d[prev - 1]) {
      tau = prev
      break
    }
  }
  if (tau < 0) return null
  const [a, m, c] = [d[tau - 1], d[tau], d[tau + 1]]
  const shift = a + c - 2 * m === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * m + c)
  const freq = sampleRate / (tau + shift)
  const midi = 69 + 12 * Math.log2(freq / 440)
  const nearest = Math.round(midi)
  return { freq, note: `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`, cents: Math.round((midi - nearest) * 100) }
}
