import { type Chord, chordPitchClasses, midiToFreq, stringMidi } from '../music/chords'

export interface Analysis {
  /** RMS of the most recent ~40ms of input, 0..1 */
  level: number
  /** Input loud enough to be considered playing */
  gate: boolean
  /** Per string (low E → high e): is that string's note ringing right now */
  strings: boolean[]
  /** Per string: dB above the noise floor of its strongest partial */
  scores: number[]
  /** 0..1 similarity between what we hear and the chord's notes */
  match: number
  /** AudioContext time of the last detected strum */
  lastOnsetAt: number
}

const FFT_SIZE = 16384 // ~2.9 Hz/bin at 48 kHz: enough to separate low E from F
const TOLERANCE = Math.pow(2, 40 / 1200) // ±40 cents around each expected note
const HARMONIC_PENALTY = [0, 0, 3, 6] // indexed by harmonic number
const GATE_RMS = 0.006
const HOLD_SECONDS = 0.25 // keep a string lit briefly so it doesn't flicker

export class AudioEngine {
  readonly ctx: AudioContext
  private analyser: AnalyserNode
  /** Everything connected here gets analysed */
  private input: GainNode
  /** Everything connected here goes to the speakers */
  private output: GainNode
  private micSource: MediaStreamAudioSourceNode | null = null
  private micStream: MediaStream | null = null
  private freqData: Float32Array<ArrayBuffer>
  private timeData: Float32Array<ArrayBuffer>
  private ringAt: number[] = new Array(6).fill(-Infinity)
  private ringChordId: string | null = null
  private rmsHistory: { t: number; v: number }[] = []
  private strumCache = new Map<string, AudioBuffer>()
  lastOnsetAt = -Infinity
  clickVolume = 0.5

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = FFT_SIZE
    this.analyser.smoothingTimeConstant = 0.3
    this.analyser.minDecibels = -120
    this.analyser.maxDecibels = 0
    this.input = this.ctx.createGain()
    this.input.connect(this.analyser)
    this.output = this.ctx.createGain()
    this.output.connect(this.ctx.destination)
    this.freqData = new Float32Array(this.analyser.frequencyBinCount)
    this.timeData = new Float32Array(this.analyser.fftSize)
  }

  get micActive() {
    return this.micStream !== null
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume()
  }

  async enableMic(deviceId?: string) {
    this.disableMic()
    await this.resume()
    // Turn off voice processing: it treats sustained guitar notes as noise.
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    this.micSource = this.ctx.createMediaStreamSource(this.micStream)
    this.micSource.connect(this.input)
  }

  disableMic() {
    this.micSource?.disconnect()
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.micSource = null
    this.micStream = null
  }

  /** Schedule a metronome click at AudioContext time `when`. */
  click(when: number, accent: boolean) {
    if (this.clickVolume <= 0) return
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.frequency.value = accent ? 1600 : 1000
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(this.clickVolume * (accent ? 0.6 : 0.35), when + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06)
    osc.connect(gain).connect(this.output)
    osc.start(when)
    osc.stop(when + 0.08)
  }

  /**
   * Play a synthesized strum of `chord`. With `analyse`, the detector hears it too (test mode).
   * `skip` lists strings to leave out, to imitate a sloppy strum.
   */
  strum(chord: Chord, when = this.ctx.currentTime, analyse = false, skip: number[] = []) {
    const key = `${chord.id}:${skip.join()}`
    let buf = this.strumCache.get(key)
    if (!buf) {
      buf = this.synthesizeStrum(chord, skip)
      this.strumCache.set(key, buf)
    }
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.output)
    if (analyse) src.connect(this.input)
    src.start(Math.max(when, this.ctx.currentTime))
  }

  /** Karplus–Strong plucked strings, low to high with a small strum delay. */
  private synthesizeStrum(chord: Chord, skip: number[]): AudioBuffer {
    const sr = this.ctx.sampleRate
    const buf = this.ctx.createBuffer(1, Math.floor(sr * 3), sr)
    const out = buf.getChannelData(0)
    let k = 0
    chord.frets.forEach((_, s) => {
      const m = stringMidi(chord, s)
      if (m === null || skip.includes(s)) return
      // The averaging filter adds half a sample of delay, so subtract it.
      const period = Math.max(2, Math.round(sr / midiToFreq(m) - 0.5))
      const ring = new Float32Array(period)
      for (let j = 0; j < period; j++) ring[j] = Math.random() * 2 - 1
      const start = Math.floor(k++ * 0.016 * sr)
      let idx = 0
      for (let i = start; i < out.length; i++) {
        const next = (idx + 1) % period
        const cur = ring[idx]
        ring[idx] = 0.4985 * (cur + ring[next])
        out[i] += cur
        idx = next
      }
    })
    let peak = 0
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
    if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.7 / peak
    return buf
  }

  /**
   * Listen against a target chord. `threshold` is how many dB above the
   * noise floor a string's note must be to count as ringing.
   */
  analyze(chord: Chord | null, threshold: number): Analysis {
    const now = this.ctx.currentTime
    this.analyser.getFloatFrequencyData(this.freqData)
    this.analyser.getFloatTimeDomainData(this.timeData)

    // Level over just the newest samples so strums register quickly.
    const recent = 2048
    let sum = 0
    for (let i = this.timeData.length - recent; i < this.timeData.length; i++) sum += this.timeData[i] ** 2
    const level = Math.sqrt(sum / recent)
    const gate = level > GATE_RMS

    // Onset (strum) detection: level jumps well above its recent minimum.
    this.rmsHistory.push({ t: now, v: level })
    while (this.rmsHistory.length && this.rmsHistory[0].t < now - 0.3) this.rmsHistory.shift()
    const recentMin = Math.min(...this.rmsHistory.map((h) => h.v))
    if (gate && level > recentMin * 2 && now - this.lastOnsetAt > 0.25) this.lastOnsetAt = now

    const binHz = this.ctx.sampleRate / FFT_SIZE
    const toBin = (f: number) => Math.round(f / binHz)
    const floor = this.median(toBin(70), toBin(2500))
    const peak = (f: number) => {
      const lo = Math.floor(f / TOLERANCE / binHz)
      const hi = Math.ceil((f * TOLERANCE) / binHz)
      let max = -Infinity
      for (let b = lo; b <= hi && b < this.freqData.length; b++) max = Math.max(max, this.freqData[b])
      return max
    }

    if (chord?.id !== this.ringChordId) {
      this.ringChordId = chord?.id ?? null
      this.ringAt.fill(-Infinity)
    }

    const strings = new Array<boolean>(6).fill(false)
    const scores = new Array<number>(6).fill(0)
    let match = 0

    if (chord) {
      const expected = chord.frets.map((_, s) => {
        const m = stringMidi(chord, s)
        return m === null ? null : midiToFreq(m)
      })
      const near = (a: number, b: number) => a / b < TOLERANCE && b / a < TOLERANCE

      for (let s = 0; s < 6; s++) {
        const f = expected[s]
        if (f === null) continue
        let best = -Infinity
        for (let h = 1; h <= 3; h++) {
          const hf = h * f
          // A harmonic that lands on another string's note proves nothing about this string.
          if (h > 1 && expected.some((g, o) => o !== s && g !== null && near(g, hf))) continue
          best = Math.max(best, peak(hf) - floor - HARMONIC_PENALTY[h])
        }
        scores[s] = best
        if (gate && best > threshold) this.ringAt[s] = now
        strings[s] = now - this.ringAt[s] < HOLD_SECONDS
      }

      if (gate) match = this.chromaMatch(chord, floor, binHz)
    }

    return { level, gate, strings, scores, match, lastOnsetAt: this.lastOnsetAt }
  }

  /** Cosine similarity between the heard pitch-class profile and the chord's notes. */
  private chromaMatch(chord: Chord, floor: number, binHz: number) {
    const chroma = new Array<number>(12).fill(0)
    const lo = Math.floor(75 / binHz)
    const hi = Math.ceil(1600 / binHz)
    for (let b = lo; b <= hi; b++) {
      const above = this.freqData[b] - floor - 12
      if (above <= 0) continue
      const midi = Math.round(12 * Math.log2((b * binHz) / 440) + 69)
      chroma[((midi % 12) + 12) % 12] += above
    }
    const pcs = chordPitchClasses(chord)
    let dot = 0
    let norm = 0
    chroma.forEach((v, pc) => {
      norm += v * v
      if (pcs.has(pc)) dot += v
    })
    return norm > 0 ? dot / (Math.sqrt(norm) * Math.sqrt(pcs.size)) : 0
  }

  private median(lo: number, hi: number) {
    const slice = this.freqData.slice(lo, hi).sort()
    return slice[slice.length >> 1]
  }
}
