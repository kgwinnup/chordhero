import { CHORDS_BY_ID } from '../music/chords'
import { SCALES } from './scale'

/** Learn a chord's shape: strum it cleanly a few times with the coach listening. */
export interface ShapeStep {
  id: string
  kind: 'shape'
  chord: string
}

/** The one-minute changes drill: as many clean switches between two chords as you can in a minute. */
export interface ChangesStep {
  id: string
  kind: 'changes'
  chords: [string, string]
  /** Clean changes in a minute to pass */
  goal: number
}

/** Play a short progression in the game, in time, and earn enough stars. */
export interface SongStep {
  id: string
  kind: 'song'
  name: string
  chords: string[]
  bpm: number
  /** Stars needed to pass */
  stars: number
}

/** Learn a scale's shape: play each note, up and back down, at your own pace. */
export interface ScaleStep {
  id: string
  kind: 'scale'
  scale: string
}

/** Play a scale up and down in time with the click. */
export interface RunStep {
  id: string
  kind: 'run'
  scale: string
  bpm: number
  /** Notes per beat: 1 quarter notes, 2 eighths */
  perBeat: number
  /** Percent right and in time to pass */
  goal: number
}

/** Improvise with a scale over a backing loop: any note of the scale scores. */
export interface JamStep {
  id: string
  kind: 'jam'
  scale: string
  chords: string[]
  bpm: number
  bars: number
  /** Notes in key to pass */
  goal: number
}

export type Step = ShapeStep | ChangesStep | SongStep | ScaleStep | RunStep | JamStep

export interface Unit {
  title: string
  blurb: string
  steps: Step[]
}

/** Clean strums of a new shape needed to pass it. */
export const SHAPE_GOAL = 3
export const DRILL_SECONDS = 60

const shape = (chord: string): ShapeStep => ({ id: `shape-${chord}`, kind: 'shape', chord })
const changes = (a: string, b: string, goal: number): ChangesStep => ({ id: `changes-${a}-${b}`, kind: 'changes', chords: [a, b], goal })
const song = (id: string, name: string, chords: string[], bpm: number, stars = 3): SongStep => ({ id: `song-${id}`, kind: 'song', name, chords, bpm, stars })

/**
 * The beginner path, in the order most teachers use: two-finger E minor first, then shapes that
 * reuse it (Am and E are the same shape moved), then A, D, G and C. Each chord is learned on its
 * own, then switched to and from a chord you already know, then played in a song.
 */
export const PATH: Unit[] = [
  {
    title: 'E minor',
    blurb: 'Two fingers, every string. Your first chord.',
    steps: [shape('Em')],
  },
  {
    title: 'A minor',
    blurb: 'Three fingers, and your first chord change.',
    steps: [shape('Am'), changes('Em', 'Am', 15), song('em-am', 'Em – Am', ['Em', 'Am', 'Em', 'Am', 'Em', 'Am', 'Em', 'Am'], 60)],
  },
  {
    title: 'E major',
    blurb: 'The A minor shape, moved up one string.',
    steps: [shape('E'), changes('Am', 'E', 15), song('am-e', 'Am – E', ['Am', 'E', 'Am', 'E', 'Am', 'E', 'Am', 'E'], 60)],
  },
  {
    title: 'A major',
    blurb: 'Three fingers squeezed onto the 2nd fret.',
    steps: [shape('A'), changes('E', 'A', 15), song('e-a', 'E – A', ['E', 'A', 'E', 'A', 'E', 'A', 'E', 'A'], 65)],
  },
  {
    title: 'D major',
    blurb: 'A little triangle on the top strings. Skip any marked ✕.',
    steps: [shape('D'), changes('A', 'D', 15), song('e-a-d', 'E – A – D', ['E', 'A', 'D', 'A', 'E', 'A', 'D', 'A'], 65)],
  },
  {
    title: 'G major',
    blurb: 'A big stretch across every string.',
    steps: [shape('G'), changes('G', 'Em', 15), changes('G', 'D', 15), song('g-em-d', 'G – Em – D', ['G', 'Em', 'D', 'G', 'G', 'Em', 'D', 'G'], 65)],
  },
  {
    title: 'C major',
    blurb: 'The last of the beginner chords. Skip any string marked ✕.',
    steps: [
      shape('C'),
      changes('C', 'G', 15),
      changes('C', 'Am', 20),
      song('g-c-d', 'G – C – D', ['G', 'C', 'D', 'G', 'G', 'C', 'D', 'G'], 65),
      song('four-chords', 'Four-chord song', ['G', 'Em', 'C', 'D', 'G', 'Em', 'C', 'D'], 70),
    ],
  },
]

export const STEPS: Step[] = PATH.flatMap((u) => u.steps)

/** The lead guitar path: scales, learned like chords (shape, drill, then play), open from the start. */
export const LEAD_PATH: Unit[] = [
  {
    title: 'E minor pentatonic',
    blurb: 'The five-note scale behind most rock and blues solos, in open position.',
    steps: [
      { id: 'scale-em-pent', kind: 'scale', scale: 'em-pent' },
      { id: 'run-em-pent-60', kind: 'run', scale: 'em-pent', bpm: 60, perBeat: 1, goal: 80 },
      { id: 'run-em-pent-eighths', kind: 'run', scale: 'em-pent', bpm: 60, perBeat: 2, goal: 80 },
      { id: 'jam-em-pent', kind: 'jam', scale: 'em-pent', chords: ['Em', 'C', 'G', 'D'], bpm: 70, bars: 8, goal: 24 },
    ],
  },
  {
    title: 'A minor pentatonic',
    blurb: 'The same five-note sound from A, still in open position: the key of countless rock solos.',
    steps: [
      { id: 'scale-am-pent', kind: 'scale', scale: 'am-pent' },
      { id: 'run-am-pent-60', kind: 'run', scale: 'am-pent', bpm: 60, perBeat: 1, goal: 80 },
      { id: 'run-am-pent-eighths', kind: 'run', scale: 'am-pent', bpm: 60, perBeat: 2, goal: 80 },
      { id: 'jam-am-pent', kind: 'jam', scale: 'am-pent', chords: ['Am', 'F', 'C', 'G'], bpm: 70, bars: 8, goal: 24 },
    ],
  },
]

export const LEAD_STEPS: Step[] = LEAD_PATH.flatMap((u) => u.steps)
export const ALL_STEPS: Step[] = [...STEPS, ...LEAD_STEPS]

/** The path a step belongs to. */
export const pathOf = (id: string): Step[] => (LEAD_STEPS.some((s) => s.id === id) ? LEAD_STEPS : STEPS)

export function stepTitle(step: Step) {
  if (step.kind === 'shape') return `Learn ${CHORDS_BY_ID[step.chord].name}`
  if (step.kind === 'changes') return `${step.chords.join(' ↔ ')} changes`
  if (step.kind === 'scale') return `Learn ${SCALES[step.scale].name}`
  if (step.kind === 'run') return step.perBeat === 1 ? 'Up and down, in time' : 'Up and down in eighth notes'
  if (step.kind === 'jam') return `Jam over ${step.chords.join(' – ')}`
  return `Play “${step.name}”`
}

export function stepGoal(step: Step) {
  if (step.kind === 'shape') return `${SHAPE_GOAL} clean strums`
  if (step.kind === 'changes') return `${step.goal} changes in a minute`
  if (step.kind === 'scale') return 'Every note, up and back down'
  if (step.kind === 'run') return `${step.goal}% at ${step.bpm} BPM`
  if (step.kind === 'jam') return `${step.goal} notes in key`
  return `${step.stars}★ at ${step.bpm} BPM`
}

export interface Progress {
  /** Steps passed (or skipped) */
  done: string[]
  /** Best score for each drill: changes per minute, top tempo for a scale run, notes in key for a jam */
  best: Record<string, number>
}

const KEY = 'chordhero.path'

export const emptyProgress = (): Progress => ({ done: [], best: {} })

export function loadProgress(): Progress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Progress> | null
    if (!raw) return emptyProgress()
    const ids = new Set(ALL_STEPS.map((s) => s.id))
    return {
      done: Array.isArray(raw.done) ? raw.done.filter((id) => ids.has(id)) : [],
      best: raw.best && typeof raw.best === 'object' ? raw.best : {},
    }
  } catch {
    return emptyProgress()
  }
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

/** Chords whose shape lesson is done, in path order. */
export const learnedChords = (p: Progress): string[] => STEPS.flatMap((s) => (s.kind === 'shape' && p.done.includes(s.id) ? [s.chord] : []))

export const markDone = (p: Progress, id: string): Progress => (p.done.includes(id) ? p : { ...p, done: [...p.done, id] })

export const recordBest = (p: Progress, id: string, count: number): Progress =>
  count > (p.best[id] ?? 0) ? { ...p, best: { ...p.best, [id]: count } } : p

/** The step to do next: the first one not yet done, or null once the path is finished. */
export const nextStep = (p: Progress): Step | null => STEPS.find((s) => !p.done.includes(s.id)) ?? null

/** A step is open once every step before it on its path is done. */
export function isUnlocked(p: Progress, id: string) {
  const steps = pathOf(id)
  const i = steps.findIndex((s) => s.id === id)
  return i >= 0 && steps.slice(0, i).every((s) => p.done.includes(s.id))
}
