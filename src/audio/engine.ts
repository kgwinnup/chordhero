import { type Chord, CHORDS, MAX_STRINGS, midiToFreq, stringMidi } from '../music/chords'
import { Crowd } from './crowd'
import { chordFit, isNoiseLike, mutedRinging, noteLevels, scoreStrings } from './detect'
import { type Pitch, type PitchRange, yinPitch } from './pitch'

export type { Pitch } from './pitch'

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
  /** The same similarity for the best-fitting other chord */
  rival: number
  /** AudioContext time of the last detected strum */
  lastOnsetAt: number
  /** Per string: dB its note stands above the noise (see `noteLevels`) */
  notes: number[]
  /** Muted strings (✕) ringing anyway: hit by mistake (see `mutedRinging`) */
  muted: boolean[]
}

const FFT_SIZE = 16384 // ~2.9 Hz/bin at 48 kHz: enough to separate low E from F
/** Consecutive frames a string must read as ringing before it lights. */
const PERSIST_FRAMES = 2
/** Input quieter than this is treated as silence. Low, so soft playing on a phone mic still counts. */
const GATE_RMS = 0.003
const HOLD_SECONDS = 0.25 // keep a string lit briefly so it doesn't flicker

export interface MicInfo {
  contextRate: number
  micRate: number | null
  /** Newer browsers may report a mode string here instead of a boolean. */
  echoCancellation: boolean | string | null
  autoGainControl: boolean | null
  noiseSuppression: boolean | null
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
  private ringAt: number[] = new Array(MAX_STRINGS).fill(-Infinity)
  /** Per string: consecutive frames it has read as ringing, and whether it had its own evidence last frame. */
  private streak: number[] = new Array(MAX_STRINGS).fill(0)
  private mutedAt: number[] = new Array(MAX_STRINGS).fill(-Infinity)
  private mutedStreak: number[] = new Array(MAX_STRINGS).fill(0)
  private wasIndependent: boolean[] = new Array(MAX_STRINGS).fill(false)
  private ringChordId: string | null = null
  private rmsHistory: { t: number; v: number }[] = []
  private strumCache = new Map<string, AudioBuffer>()
  lastOnsetAt = -Infinity
  clickVolume = 0.5
  crowd!: Crowd

  /** AudioContext time until which something we scheduled may still be sounding. */
  private soundUntil = 0
  private sleepTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    this.build()
    // Hidden: nothing to show and nobody looking, so stop listening and let the audio hardware rest.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        const hidden = document.visibilityState === 'hidden'
        this.micStream?.getAudioTracks().forEach((t) => (t.enabled = !hidden))
        if (hidden) void this.ctx.suspend().catch(() => {})
        else if (this.micStream) void this.resume().catch(() => {})
      })
    }
  }

  /**
   * Suspend the audio context once nothing is playing, so the audio hardware can sleep. For when
   * no mic and no song needs it; anything that plays a sound wakes it again.
   */
  sleepWhenQuiet() {
    clearTimeout(this.sleepTimer)
    const check = () => {
      if (this.micStream || this.ctx.state !== 'running') return
      // Let the crowd's fade and any ringing strum finish first.
      if (this.crowd.running) this.soundUntil = Math.max(this.soundUntil, this.ctx.currentTime + 3)
      const left = this.soundUntil - this.ctx.currentTime
      if (left > 0) this.sleepTimer = setTimeout(check, left * 1000 + 100)
      else void this.ctx.suspend().catch(() => {})
    }
    this.sleepTimer = setTimeout(check, 2000)
  }

  /** Something is about to sound until `until` (AudioContext time): keep (or get) the context running. */
  private sounding(until: number) {
    this.soundUntil = Math.max(this.soundUntil, until)
    if (this.ctx.state === 'suspended' && document.visibilityState !== 'hidden') void this.resume().catch(() => {})
  }

  get ctx() {
    return this._ctx
  }

  /** The node everything the detectors hear passes through (mic, and test strums). */
  get listenInput(): AudioNode {
    return this.input
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
    // Speakers only: the detectors never hear the crowd.
    this.crowd = new Crowd(this.ctx, this.output)
    this.freqData = new Float32Array(this.analyser.frequencyBinCount)
    this.timeData = new Float32Array(this.analyser.fftSize)
  }

  /** Swap in a fresh AudioContext (and graph), dropping anything tied to the old one. */
  private rebuild(sampleRate?: number) {
    const old = this._ctx
    const crowdWasOn = this.crowd.running
    this.build(sampleRate)
    if (crowdWasOn) this.crowd.start()
    old.close().catch(() => {})
    this.strumCache.clear()
    this.rmsHistory = []
    this.ringAt.fill(-Infinity)
    this.streak.fill(0)
    this.mutedAt.fill(-Infinity)
    this.mutedStreak.fill(0)
    this.wasIndependent.fill(false)
    this.lastOnsetAt = -Infinity
  }

  /** Whether the audio clock is running (not suspended to save power). */
  get awake() {
    return this.ctx.state === 'running'
  }

  get micActive() {
    return this.micStream !== null
  }

  async resume() {
    clearTimeout(this.sleepTimer)
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
   * The pitch of a single plucked string, from the latest input. Null when it's quiet or
   * unclear. See `yinPitch`.
   */
  pitch(range?: PitchRange): Pitch | null {
    // Read fresh samples: the game loop analyses only a few times a second while it's quiet.
    this.analyser.getFloatTimeDomainData(this.timeData)
    return yinPitch(this.timeData, this.ctx.sampleRate, range)
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
    this.sounding(when + 0.1)
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
    this.sounding(when + 3)
    const key = `${chord.frets.join()}:${skip.join()}`
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

  /** Play one note, e.g. a single string of a chord. */
  pluck(midi: number, when = this.ctx.currentTime, analyse = false) {
    this.sounding(when + 3)
    const src = this.ctx.createBufferSource()
    src.buffer = this.synthesize([midi])
    src.connect(this.output)
    if (analyse) src.connect(this.input)
    src.start(Math.max(when, this.ctx.currentTime))
  }

  private synthesizeStrum(chord: Chord, skip: number[]): AudioBuffer {
    const notes = chord.frets.flatMap((_, s) => {
      const m = stringMidi(chord, s)
      return m === null || skip.includes(s) ? [] : [m]
    })
    return this.synthesize(notes)
  }

  /** Karplus–Strong plucked strings, in the order given with a small strum delay. */
  private synthesize(notes: number[]): AudioBuffer {
    const sr = this.ctx.sampleRate
    const buf = this.ctx.createBuffer(1, Math.floor(sr * 3), sr)
    const out = buf.getChannelData(0)
    let k = 0
    notes.forEach((m) => {
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
    // Keyed by string count too: the same chord on another guitar is a different shape.
    const ringKey = chord ? `${chord.id}/${chord.frets.length}` : null
    if (ringKey !== this.ringChordId) {
      this.ringChordId = ringKey
      this.ringAt.fill(-Infinity)
      this.streak.fill(0)
      this.mutedAt.fill(-Infinity)
      this.mutedStreak.fill(0)
      this.wasIndependent.fill(false)
    }

    const n = chord?.frets.length ?? MAX_STRINGS
    const strings = new Array<boolean>(n).fill(false)
    const muted = new Array<boolean>(n).fill(false)
    let scores = new Array<number>(n).fill(0)
    let match = 0
    let rival = 0
    let notes = new Array<number>(n).fill(0)
    if (chord) {
      notes = noteLevels(this.freqData, binHz, chord)
      const allowed = gate && !isNoiseLike(this.freqData, binHz)
      // Too quiet or just noise: nothing can ring, so skip the costly per-string scoring.
      const result = allowed ? scoreStrings(this.freqData, binHz, chord, threshold, allowed, this.wasIndependent) : silent(chord.frets.length)
      scores = result.scores
      this.wasIndependent = result.independent
      for (let s = 0; s < n; s++) {
        // A string lights after reading as ringing a few frames in a row, then holds briefly.
        this.streak[s] = result.ringing[s] ? this.streak[s] + 1 : 0
        if (this.streak[s] >= PERSIST_FRAMES) this.ringAt[s] = now
        strings[s] = now - this.ringAt[s] < HOLD_SECONDS
      }
      const hit = mutedRinging(this.freqData, binHz, chord, threshold, allowed)
      for (let s = 0; s < n; s++) {
        this.mutedStreak[s] = hit[s] ? this.mutedStreak[s] + 1 : 0
        if (this.mutedStreak[s] >= PERSIST_FRAMES) this.mutedAt[s] = now
        muted[s] = now - this.mutedAt[s] < HOLD_SECONDS
      }
      if (gate) ({ match, rival } = chordFit(this.freqData, binHz, chord, CHORDS))
    }

    return { level, gate, strings, scores, match, rival, lastOnsetAt: this.lastOnsetAt, notes, muted }
  }
}

/** String scores for a frame where nothing may ring. */
const silent = (n: number) => ({ scores: new Array<number>(n).fill(0), ringing: new Array<boolean>(n).fill(false), independent: new Array<boolean>(n).fill(false) })
