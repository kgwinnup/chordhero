/**
 * Polyphonic note detection with Spotify's Basic Pitch (Apache 2.0), a small neural network that
 * turns audio into the notes being played. Experimental: loaded only by the Detector lab.
 */
import type { BasicPitch } from '@spotify/basic-pitch'
import { type Chord, stringMidi } from '../music/chords'

const MODEL_SAMPLE_RATE = 22050
/** Audio fed to the model on each reading. */
const LISTEN_SECONDS = 1.5
/** The reading reflects the model's frames over this much of the most recent audio. */
const RECENT_SECONDS = 0.46
/** Model frames per second (22050 / 256 hop). */
const FRAMES_PER_SECOND = MODEL_SAMPLE_RATE / 256
/** Lowest MIDI note the model reports (A0); it reports 88 notes. */
const LOWEST_MIDI = 21
/**
 * A note counts as sounding at or above this activation (0..1). Defaults to the lab's strictest
 * setting: fewer invented strings, at the cost of missing quiet ones (0.2 balanced the two best
 * on synthetic strums).
 */
export const NOTE_ON = 0.5

export interface NoteReading {
  /** Activation (0..1) per MIDI note, index = MIDI number */
  activation: Float32Array
  /** Milliseconds the reading took (resampling + model) */
  ms: number
}

let modelPromise: Promise<BasicPitch> | null = null

/** Load TensorFlow.js and the model once, on first use. */
export function loadModel(): Promise<BasicPitch> {
  modelPromise ??= import('@spotify/basic-pitch').then(({ BasicPitch }) => new BasicPitch(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`))
  return modelPromise
}

/** Keeps the last few seconds of an audio node's output and reads the notes in it on demand. */
export class NoteListener {
  private ctx: AudioContext
  private ring: Float32Array
  private write = 0
  private tap: ScriptProcessorNode
  private silent: GainNode

  constructor(ctx: AudioContext, source: AudioNode) {
    this.ctx = ctx
    this.ring = new Float32Array(Math.ceil(ctx.sampleRate * LISTEN_SECONDS))
    // ScriptProcessor is deprecated but universally supported (including iOS Safari) and needs
    // no separate worklet file; this is a lab feature, so simplicity wins.
    this.tap = ctx.createScriptProcessor(2048, 1, 1)
    this.tap.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0)
      for (let i = 0; i < input.length; i++) {
        this.ring[this.write] = input[i]
        this.write = (this.write + 1) % this.ring.length
      }
    }
    // A processor only runs while connected to the destination; keep it silent.
    this.silent = ctx.createGain()
    this.silent.gain.value = 0
    source.connect(this.tap)
    this.tap.connect(this.silent).connect(ctx.destination)
  }

  get context() {
    return this.ctx
  }

  dispose() {
    this.tap.disconnect()
    this.silent.disconnect()
    this.tap.onaudioprocess = null
  }

  async read(): Promise<NoteReading> {
    const started = performance.now()
    const model = await loadModel()
    const audio = await resample(this.snapshot(), this.ctx.sampleRate, MODEL_SAMPLE_RATE)
    const frames: number[][] = []
    await model.evaluateModel(audio, (f) => frames.push(...f), () => {})
    const activation = new Float32Array(128)
    const recent = Math.max(1, Math.round(RECENT_SECONDS * FRAMES_PER_SECOND))
    for (const frame of frames.slice(-recent)) {
      frame.forEach((v, i) => {
        const midi = LOWEST_MIDI + i
        if (v > activation[midi]) activation[midi] = v
      })
    }
    return { activation, ms: performance.now() - started }
  }

  /** The ring buffer, oldest sample first. */
  private snapshot() {
    const out = new Float32Array(this.ring.length)
    out.set(this.ring.subarray(this.write))
    out.set(this.ring.subarray(0, this.write), this.ring.length - this.write)
    return out
  }
}

/** Resample with an OfflineAudioContext (band-limited), falling back to linear interpolation. */
async function resample(input: Float32Array, from: number, to: number): Promise<Float32Array> {
  if (from === to) return input
  try {
    const length = Math.round((input.length * to) / from)
    const offline = new OfflineAudioContext(1, length, to)
    const buf = offline.createBuffer(1, input.length, from)
    buf.copyToChannel(input as Float32Array<ArrayBuffer>, 0)
    const src = offline.createBufferSource()
    src.buffer = buf
    src.connect(offline.destination)
    src.start()
    return (await offline.startRendering()).getChannelData(0)
  } catch {
    const out = new Float32Array(Math.round((input.length * to) / from))
    for (let i = 0; i < out.length; i++) {
      const x = (i * from) / to
      const j = Math.floor(x)
      out[i] = input[j] + (input[Math.min(j + 1, input.length - 1)] - input[j]) * (x - j)
    }
    return out
  }
}

/**
 * Which of a chord's strings are sounding, from note activations. Each string plays a distinct
 * note in every voicing, so a note maps straight back to its string.
 */
export function stringsFromNotes(chord: Chord, activation: ArrayLike<number>, threshold = NOTE_ON): boolean[] {
  return chord.frets.map((_, s) => {
    const midi = stringMidi(chord, s)
    return midi !== null && activation[midi] >= threshold
  })
}

/** The notes above threshold, loudest first, for display. */
export function heardNotes(activation: ArrayLike<number>, threshold = NOTE_ON) {
  const notes: { midi: number; activation: number }[] = []
  for (let m = 0; m < activation.length; m++) if (activation[m] >= threshold) notes.push({ midi: m, activation: activation[m] })
  return notes.sort((a, b) => b.activation - a.activation)
}
