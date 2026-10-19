import { type Chord, chordPitchClasses, midiToFreq, NOTE_NAMES, stringMidi } from '../music/chords'

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
/** Overtones checked per string, and how much each is discounted (indexed by harmonic number). */
const HARMONIC_PENALTY = [0, 0, 0, 3, 6, 8, 10]
/** Each note is compared with the noise within half an octave either side of it. */
const LOCAL_FLOOR_SPAN = Math.SQRT2
/** Bass strings get this much slack: even with a local floor, built-in mics hear them least clearly. */
const BASS_RELIEF_DB = 4
const BASS_BELOW_HZ = 130
/**
 * When a string's note could be an overtone of a lower string that's sounding, it only counts
 * if it stands this far above the loudest of that string's other overtones around it.
 */
const OVERTONE_EXCESS_DB = 6
/**
 * A lower string this far above the noise counts as a possible source of overtones even before
 * it lights: early in a pluck its overtones are already strong while its own note is still rising.
 */
const SOURCE_PRESENT_DB = 6
/** Above this spectral flatness the sound is noise-like (key clicks, taps, rustle), not strings. */
const MAX_FLATNESS = 0.3
/** Consecutive frames a string must read as ringing before it lights. */
const PERSIST_FRAMES = 2
const GATE_RMS = 0.006
const HOLD_SECONDS = 0.25 // keep a string lit briefly so it doesn't flicker

export interface MicInfo {
  contextRate: number
  micRate: number | null
  /** Newer browsers may report a mode string here instead of a boolean. */
  echoCancellation: boolean | string | null
  autoGainControl: boolean | null
  noiseSuppression: boolean | null
}

export interface Pitch {
  freq: number
  note: string
  /** How far off the nearest note, −50…50 */
  cents: number
}

export class AudioEngine {
  private _ctx!: AudioContext
  private analyser!: AnalyserNode
  /** Everything connected here gets analysed */
  private input!: GainNode
  /** Everything connected here goes to the speakers */
  private output!: GainNode
  private micSource: MediaStreamAudioSourceNode | null = null
  private micStream: MediaStream | null = null
  private freqData!: Float32Array<ArrayBuffer>
  private timeData!: Float32Array<ArrayBuffer>
  private ringAt: number[] = new Array(6).fill(-Infinity)
  /** Per string: consecutive frames it has read as ringing, and whether it had its own evidence last frame. */
  private streak: number[] = new Array(6).fill(0)
  private wasIndependent: boolean[] = new Array(6).fill(false)
  private ringChordId: string | null = null
  private rmsHistory: { t: number; v: number }[] = []
  private strumCache = new Map<string, AudioBuffer>()
  lastOnsetAt = -Infinity
  clickVolume = 0.5

  constructor() {
    this.build()
  }

  get ctx() {
    return this._ctx
  }

  private build(sampleRate?: number) {
    try {
      this._ctx = new AudioContext({ latencyHint: 'interactive', sampleRate })
    } catch {
      this._ctx = new AudioContext({ latencyHint: 'interactive' })
    }
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

  /** Swap in a fresh AudioContext (and graph), dropping anything tied to the old one. */
  private rebuild(sampleRate?: number) {
    const old = this._ctx
    this.build(sampleRate)
    old.close().catch(() => {})
    this.strumCache.clear()
    this.rmsHistory = []
    this.ringAt.fill(-Infinity)
    this.lastOnsetAt = -Infinity
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
    // iOS switches the hardware sample rate when the mic opens, and an AudioContext made
    // before that keeps the old rate: every pitch then reads ~1.5 semitones off. So build
    // the audio graph again now that the mic is live, at the mic's own rate.
    this.rebuild(this.micStream.getAudioTracks()[0]?.getSettings().sampleRate)
    await this.resume().catch(() => {})
    this.micSource = this.ctx.createMediaStreamSource(this.micStream)
    this.micSource.connect(this.input)
  }

  /** What the browser actually gave us, for the mic check. */
  micInfo(): MicInfo {
    const settings = this.micStream?.getAudioTracks()[0]?.getSettings()
    return {
      contextRate: this.ctx.sampleRate,
      micRate: settings?.sampleRate ?? null,
      echoCancellation: settings?.echoCancellation ?? null,
      autoGainControl: settings?.autoGainControl ?? null,
      noiseSuppression: settings?.noiseSuppression ?? null,
    }
  }

  /**
   * The pitch of a single plucked string, from the latest input (call after `analyze`).
   * Uses YIN on the waveform: unlike picking the loudest spectral peak, it isn't fooled
   * into octave errors by a guitar's strong overtones. Null when it's quiet or unclear.
   */
  pitch(): Pitch | null {
    const sr = this.ctx.sampleRate
    const W = 2048
    const x = this.timeData.subarray(this.timeData.length - W * 2)
    let energy = 0
    for (let i = W; i < W * 2; i++) energy += x[i] * x[i]
    if (Math.sqrt(energy / W) < 0.003) return null

    const minTau = Math.floor(sr / 1100)
    const maxTau = Math.min(W - 1, Math.ceil(sr / 70))
    // Cumulative-mean-normalised difference function.
    const d = new Float32Array(maxTau + 1)
    let running = 0
    let tau = -1
    for (let t = 1; t <= maxTau; t++) {
      let sum = 0
      for (let i = 0; i < W; i++) {
        const diff = x[i] - x[i + t]
        sum += diff * diff
      }
      running += sum
      d[t] = running ? (sum * t) / running : 1
      if (t > minTau + 1 && d[t - 1] < 0.15 && d[t - 1] <= d[t] && d[t - 1] <= d[t - 2]) {
        tau = t - 1
        break
      }
    }
    if (tau < 0) return null
    const [a, m, c] = [d[tau - 1], d[tau], d[tau + 1]]
    const shift = a + c - 2 * m === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * m + c)
    const freq = sr / (tau + shift)
    const midi = 69 + 12 * Math.log2(freq / 440)
    const nearest = Math.round(midi)
    return { freq, note: `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`, cents: Math.round((midi - nearest) * 100) }
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
   * Listen against a target chord. `threshold` is how many dB a string's note must
   * stand above the noise around its own pitch to count as ringing.
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
    // Local floor: built-in mics roll off the bass and rooms rumble there, so a single
    // spectrum-wide floor both hides a quiet low E and lets rumble pass for one.
    const localFloor = (f: number) => this.median(toBin(f / LOCAL_FLOOR_SPAN), toBin(f * LOCAL_FLOOR_SPAN) + 1)
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
      this.streak.fill(0)
      this.wasIndependent.fill(false)
    }
    const tonal = this.flatness(toBin(70), toBin(3000)) < MAX_FLATNESS

    const strings = new Array<boolean>(6).fill(false)
    const scores = new Array<number>(6).fill(0)
    let match = 0

    if (chord) {
      const expected = chord.frets.map((_, s) => {
        const m = stringMidi(chord, s)
        return m === null ? null : midiToFreq(m)
      })
      const near = (a: number, b: number) => a / b < TOLERANCE && b / a < TOLERANCE
      /** Is `hf` (close to) some overtone of the note `g`? Returns which one, or 0. */
      const overtoneOf = (hf: number, g: number) => {
        const k = Math.round(hf / g)
        return k >= 1 && near(k * g, hf) ? k : 0
      }
      /** How far a partial stands above the noise around it; immune to the mic's bass rolloff. */
      const contrast = (f: number) => peak(f) - localFloor(f)
      const ringingNow = new Array<boolean>(6).fill(false)
      const present = new Array<boolean>(6).fill(false)
      // Strings whose evidence is their own: a peak no sounding lower string explains, or one
      // that clearly stands out from that string's overtones. Only these may claim neighbouring
      // overtones as theirs; strings lit on the benefit of the doubt can't vouch for each other.
      const independentNow = new Array<boolean>(6).fill(false)
      const vouches = (o: number) => independentNow[o] || this.wasIndependent[o]

      // Decide strings from low to high pitch, so a higher string's note can be checked against
      // the overtones of lower strings already known to be sounding.
      const order = expected.map((f, i) => ({ f, i })).filter((x) => x.f !== null).sort((a, b) => a.f! - b.f!)
      for (const { f: fNote, i: s } of order) {
        const f = fNote!
        let best = -Infinity
        let bestOwn = -Infinity
        for (let h = 1; h < HARMONIC_PENALTY.length; h++) {
          const hf = h * f
          if (hf > 2500) break
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
            } else if (present[o] || ringingNow[o]) {
              // A lower string that's sounding could have made this peak. Count it only if it stands
              // out from that string's own overtone envelope: all its overtones up to two past this one
              // (a low E's 2nd overtone is often its loudest), skipping any another string claims.
              const neighbours = Array.from({ length: k + 2 }, (_, n) => n + 1)
                .filter((n) => n !== k && n * g <= 2500)
                .map((n) => n * g)
                .filter((nf) => !expected.some((g2, o2) => o2 !== o && o2 !== s && g2 !== null && vouches(o2) && overtoneOf(nf, g2)))
              if (!neighbours.length) own = false // nothing to compare against: benefit of the doubt
              else if (contrast(hf) - Math.max(...neighbours.map(contrast)) < OVERTONE_EXCESS_DB) usable = false
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
        ringingNow[s] = gate && tonal && best > need
        independentNow[s] = gate && tonal && bestOwn > need
        this.streak[s] = ringingNow[s] ? this.streak[s] + 1 : 0
        if (this.streak[s] >= PERSIST_FRAMES) this.ringAt[s] = now
        strings[s] = now - this.ringAt[s] < HOLD_SECONDS
      }
      this.wasIndependent = independentNow

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

  /** Spectral flatness (0 = pure tones … 1 = white noise) over a bin range. */
  private flatness(lo: number, hi: number) {
    let logSum = 0
    let sum = 0
    for (let b = lo; b < hi; b++) {
      const db = this.freqData[b]
      logSum += db * (Math.LN10 / 10)
      sum += Math.pow(10, db / 10)
    }
    const n = hi - lo
    return sum > 0 ? Math.exp(logSum / n) / (sum / n) : 1
  }

  private median(lo: number, hi: number) {
    const slice = this.freqData.slice(lo, hi).sort()
    return slice[slice.length >> 1]
  }
}
