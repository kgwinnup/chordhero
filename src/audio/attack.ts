/** Samples per envelope step: ~5 ms, fine enough to time a strum. */
const BLOCK = 256
/** Steps the level is measured over: ~21 ms, longer than one cycle of the low E, so a ringing string reads steady. */
const WINDOW_BLOCKS = 4
/** A block this many times louder than the quietest just before it is a new strum. */
export const ATTACK_RATIO = 1.6
/** How far back to look for that quietest level, in seconds. */
const LOOKBACK = 0.08
/** Strums closer together than this are one strum (its strings arriving one after another). */
const REFRACTORY = 0.1
/** Below this RMS there's nothing to hear. */
const GATE_RMS = 0.003

/**
 * Strum attacks, timed from the audio itself rather than from when a screen frame happened to
 * look. Each call scans the newest samples in ~5 ms blocks, so a strum is timed to a few
 * milliseconds however slowly frames come, and a strum while the last one still rings counts
 * as long as it jumps out above it.
 */
export class AttackDetector {
  /** Time of the latest attack */
  lastAt = -Infinity
  private env: { t: number; v: number }[] = []
  /** Sums of squares of the latest blocks, for the sliding window. */
  private sums: number[] = []
  /** Blocks ending at or before this time have been looked at already. */
  private doneUntil = -Infinity

  /** Look at `samples`, whose last sample is at time `end`. Returns the time of a new attack, if any. */
  feed(samples: Float32Array, sampleRate: number, end: number): number | null {
    const blocks = Math.floor(samples.length / BLOCK)
    const blockSec = BLOCK / sampleRate
    let found: number | null = null
    for (let i = 0; i < blocks; i++) {
      const tEnd = end - (blocks - 1 - i) * blockSec
      if (tEnd <= this.doneUntil + 1e-9) continue
      const from = samples.length - (blocks - i) * BLOCK
      let sum = 0
      for (let j = from; j < from + BLOCK; j++) sum += samples[j] ** 2
      this.sums.push(sum)
      if (this.sums.length > WINDOW_BLOCKS) this.sums.shift()
      const v = Math.sqrt(this.sums.reduce((a, b) => a + b, 0) / (this.sums.length * BLOCK))

      let min = Infinity
      for (const e of this.env) if (e.t >= tEnd - LOOKBACK) min = Math.min(min, e.v)
      const start = tEnd - blockSec
      if (min !== Infinity && v > GATE_RMS && v >= Math.max(min, GATE_RMS) * ATTACK_RATIO && start - this.lastAt > REFRACTORY) {
        this.lastAt = start
        found = start
      }

      this.env.push({ t: tEnd, v })
      while (this.env.length && this.env[0].t < tEnd - 2 * LOOKBACK) this.env.shift()
      this.doneUntil = tEnd
    }
    return found
  }

  reset() {
    this.lastAt = -Infinity
    this.env = []
    this.sums = []
    this.doneUntil = -Infinity
  }
}
