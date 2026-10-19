/**
 * A synthesized crowd: a murmur that swells with the crowd meter, cheers for great chords and
 * applause at the end. All noise shaped with filters, so there are no samples to download. It plays
 * to the speakers only, never into the detectors.
 */

/** How loud the murmur is with the meter empty and full. */
const MURMUR_MIN = 0.015
const MURMUR_MAX = 0.12
/** The roar layer (excited voices, higher up) only comes in above this. */
const ROAR_FROM = 0.55
const MASTER = 0.8

export class Crowd {
  private ctx: AudioContext
  private master: GainNode
  private murmur: GainNode
  private roar: GainNode
  private sources: AudioScheduledSourceNode[] = []
  private noise: AudioBuffer
  private excitement = 0.5
  running = false

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.noise = pinkNoise(ctx, 4)
    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(destination)
    this.murmur = ctx.createGain()
    this.murmur.gain.value = 0
    this.murmur.connect(this.master)
    this.roar = ctx.createGain()
    this.roar.gain.value = 0
    this.roar.connect(this.master)
  }

  /** Fade the crowd in. */
  start() {
    if (this.running) return
    this.running = true
    const now = this.ctx.currentTime
    // Murmur: many voices talking, centred on speech frequencies, swelling slowly and unevenly.
    this.loop(this.murmur, [bandpass(this.ctx, 700, 0.6), lowpass(this.ctx, 2600)], [0.13, 0.31, 0.57])
    // Roar: the same crowd shouting, brighter.
    this.loop(this.roar, [bandpass(this.ctx, 1400, 0.9)], [0.7, 1.1])
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setTargetAtTime(MASTER, now, 0.6)
    this.setExcitement(this.excitement)
  }

  /** Fade the crowd out. */
  stop() {
    if (!this.running) return
    this.running = false
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setTargetAtTime(0, now, 0.4)
    const sources = this.sources
    this.sources = []
    for (const s of sources) s.stop(now + 2.5)
  }

  /** 0..1, from the crowd meter: how loud and lively the crowd is. */
  setExcitement(v: number) {
    this.excitement = v
    if (!this.running) return
    const now = this.ctx.currentTime
    this.murmur.gain.setTargetAtTime(MURMUR_MIN + (MURMUR_MAX - MURMUR_MIN) * v * v, now, 0.8)
    this.roar.gain.setTargetAtTime(Math.max(0, (v - ROAR_FROM) / (1 - ROAR_FROM)) * 0.09, now, 0.8)
  }

  /** A cheer, 0..1: a rush of voices plus a few "woo"s. */
  cheer(strength: number) {
    if (!this.running) return
    const now = this.ctx.currentTime
    const level = 0.05 + 0.2 * strength
    const src = this.oneShot([bandpass(this.ctx, 1300, 0.8)], (g) => {
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(level, now + 0.12)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2 + strength)
    })
    src.stop(now + 2.4)
    const voices = Math.round(1 + strength * 3)
    for (let i = 0; i < voices; i++) this.woo(now + Math.random() * 0.25, level * 0.25)
  }

  /** Applause, 0..1: claps for a few seconds, longer and louder for a better show. */
  applause(strength: number) {
    if (!this.running) return
    const now = this.ctx.currentTime
    const seconds = 2.5 + strength * 3
    const src = this.ctx.createBufferSource()
    src.buffer = claps(this.ctx, seconds, 30 + strength * 50)
    const g = this.ctx.createGain()
    g.gain.value = 0.25 + strength * 0.35
    src.connect(bandpass(this.ctx, 1800, 0.5)).connect(g).connect(this.master)
    src.start(now)
    if (strength > 0.5) this.cheer(strength)
  }

  /** One voice going "woo": a vowel-ish tone gliding up with a wobble. */
  private woo(when: number, level: number) {
    const osc = this.ctx.createOscillator()
    osc.type = 'sawtooth'
    const base = 380 + Math.random() * 260
    osc.frequency.setValueAtTime(base, when)
    osc.frequency.exponentialRampToValueAtTime(base * 1.5, when + 0.35)
    osc.frequency.exponentialRampToValueAtTime(base * 1.25, when + 0.9)
    const vibrato = this.ctx.createOscillator()
    vibrato.frequency.value = 5 + Math.random() * 2
    const depth = this.ctx.createGain()
    depth.gain.value = base * 0.02
    vibrato.connect(depth).connect(osc.frequency)
    // An "oo" vowel: most of the energy low, a little around 800 Hz.
    const formant = bandpass(this.ctx, 800, 2)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(level, when + 0.08)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.95)
    osc.connect(formant).connect(g).connect(this.master)
    osc.start(when)
    vibrato.start(when)
    osc.stop(when + 1)
    vibrato.stop(when + 1)
  }

  /** Loop the noise through `filters` into `out`, its level wobbling at each of `rates` Hz. */
  private loop(out: GainNode, filters: BiquadFilterNode[], rates: number[]) {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    src.loopStart = Math.random() * 2
    const swell = this.ctx.createGain()
    swell.gain.value = 1
    for (const rate of rates) {
      const lfo = this.ctx.createOscillator()
      lfo.frequency.value = rate
      const depth = this.ctx.createGain()
      depth.gain.value = 0.25 / rates.length
      lfo.connect(depth).connect(swell.gain)
      lfo.start()
      this.sources.push(lfo)
    }
    let node: AudioNode = src
    for (const f of filters) node = node.connect(f)
    node.connect(swell).connect(out)
    src.start(this.ctx.currentTime, Math.random() * 3)
    this.sources.push(src)
  }

  private oneShot(filters: BiquadFilterNode[], envelope: (g: GainNode) => void) {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const g = this.ctx.createGain()
    envelope(g)
    let node: AudioNode = src
    for (const f of filters) node = node.connect(f)
    node.connect(g).connect(this.master)
    src.start(this.ctx.currentTime, Math.random() * 2)
    return src
  }
}

function bandpass(ctx: AudioContext, hz: number, q: number) {
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = hz
  f.Q.value = q
  return f
}

function lowpass(ctx: AudioContext, hz: number) {
  const f = ctx.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = hz
  return f
}

/** Pink noise (Paul Kellet's filter): softer and more like a room full of people than white. */
function pinkNoise(ctx: AudioContext, seconds: number) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const out = buf.getChannelData(0)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < out.length; i++) {
    const white = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.969 * b2 + white * 0.153852
    b3 = 0.8665 * b3 + white * 0.3104856
    b4 = 0.55 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.016898
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
    b6 = white * 0.115926
  }
  return buf
}

/** Many people clapping: short noise bursts at random, thinning out toward the end. */
function claps(ctx: AudioContext, seconds: number, perSecond: number) {
  const sr = ctx.sampleRate
  const buf = ctx.createBuffer(1, Math.floor(sr * seconds), sr)
  const out = buf.getChannelData(0)
  const total = Math.round(seconds * perSecond)
  const len = Math.floor(sr * 0.012)
  for (let c = 0; c < total; c++) {
    // Skew the position so claps bunch up early and trail off.
    const at = Math.floor(Math.random() ** 1.6 * (out.length - len))
    const amp = 0.4 + Math.random() * 0.6
    for (let i = 0; i < len; i++) out[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len / 4))
  }
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.8 / peak
  return buf
}
