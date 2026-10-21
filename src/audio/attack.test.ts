import { describe, expect, it } from 'vitest'
import { AttackDetector } from './attack'

const SR = 48000

/** Strums at `times` (seconds): a burst of strings that rings on, decaying slowly, over a little noise. */
function strums(times: number[], length: number, gains = times.map(() => 1)) {
  const out = new Float32Array(Math.round(length * SR))
  let seed = 7
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5
  for (let i = 0; i < out.length; i++) out[i] = 0.001 * rand()
  times.forEach((t0, k) => {
    for (let i = Math.round(t0 * SR); i < out.length; i++) {
      const t = i / SR - t0
      // Six strings arriving over ~15 ms, as a strum sweeps across them.
      let v = 0
      for (let s = 0; s < 6; s++) if (t >= s * 0.003) v += Math.sin(2 * Math.PI * (82 * (s + 1) * 1.26) * t) * Math.exp(-(t - s * 0.003) * 2.5)
      out[i] += 0.04 * gains[k] * v * Math.min(1, t / 0.002)
    }
  })
  return out
}

/** Feed `audio` the way the analyser sees it: the newest 16384 samples, once per frame. */
function listen(audio: Float32Array, frameSec = 1 / 60) {
  const det = new AttackDetector()
  const heard: number[] = []
  const size = 16384
  for (let end = frameSec; end * SR <= audio.length; end += frameSec) {
    const last = Math.round(end * SR)
    const buf = new Float32Array(size)
    const from = Math.max(0, last - size)
    buf.set(audio.subarray(from, last), size - (last - from))
    const at = det.feed(buf, SR, end)
    if (at !== null) heard.push(at)
  }
  return heard
}

describe('strum attacks', () => {
  it('times each strum to within 10 ms, at 60 frames a second or 15', () => {
    const times = [0.5, 1.0, 1.5, 2.0]
    for (const fps of [60, 15]) {
      const heard = listen(strums(times, 2.6), 1 / fps)
      expect(heard).toHaveLength(times.length)
      heard.forEach((t, i) => expect(Math.abs(t - times[i])).toBeLessThan(0.01))
    }
  })

  it('hears quick eighth notes while the last strum still rings, even softer upstrokes', () => {
    // Eighths at 80 BPM, every other one (the upstrokes) softer.
    const times = Array.from({ length: 8 }, (_, i) => 0.4 + i * 0.375)
    const gains = times.map((_, i) => (i % 2 ? 0.6 : 1))
    const heard = listen(strums(times, 3.8, gains))
    expect(heard).toHaveLength(times.length)
    // A soft strum over a loud one takes a few more milliseconds to stand out.
    heard.forEach((t, i) => expect(Math.abs(t - times[i])).toBeLessThan(0.02))
  })

  it('hears nothing in silence or a fading chord', () => {
    expect(listen(strums([], 1))).toEqual([])
    expect(listen(strums([0.2], 2.5)).length).toBe(1)
  })
})
