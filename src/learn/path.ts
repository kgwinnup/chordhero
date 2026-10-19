import { CHORDS_BY_ID } from '../music/chords'

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

export type Step = ShapeStep | ChangesStep | SongStep

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
    blurb: 'Two fingers, all six strings. Your first chord.',
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
    blurb: 'A little triangle on the top strings. Skip the two thick ones.',
    steps: [shape('D'), changes('A', 'D', 15), song('e-a-d', 'E – A – D', ['E', 'A', 'D', 'A', 'E', 'A', 'D', 'A'], 65)],
  },
  {
    title: 'G major',
    blurb: 'A big stretch across all six strings.',
    steps: [shape('G'), changes('G', 'Em', 15), changes('G', 'D', 15), song('g-em-d', 'G – Em – D', ['G', 'Em', 'D', 'G', 'G', 'Em', 'D', 'G'], 65)],
  },
  {
    title: 'C major',
    blurb: 'The last of the beginner chords. Skip the low E.',
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

export function stepTitle(step: Step) {
  if (step.kind === 'shape') return `Learn ${CHORDS_BY_ID[step.chord].name}`
  if (step.kind === 'changes') return `${step.chords.join(' ↔ ')} changes`
  return `Play “${step.name}”`
}

export function stepGoal(step: Step) {
  if (step.kind === 'shape') return `${SHAPE_GOAL} clean strums`
  if (step.kind === 'changes') return `${step.goal} changes in a minute`
  return `${step.stars}★ at ${step.bpm} BPM`
}

export interface Progress {
  /** Steps passed (or skipped) */
  done: string[]
  /** Best changes-per-minute for each drill */
  best: Record<string, number>
}

const KEY = 'chordhero.path'

export const emptyProgress = (): Progress => ({ done: [], best: {} })

export function loadProgress(): Progress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Progress> | null
    if (!raw) return emptyProgress()
    const ids = new Set(STEPS.map((s) => s.id))
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

export const markDone = (p: Progress, id: string): Progress => (p.done.includes(id) ? p : { ...p, done: [...p.done, id] })

export const recordBest = (p: Progress, id: string, count: number): Progress =>
  count > (p.best[id] ?? 0) ? { ...p, best: { ...p.best, [id]: count } } : p

/** The step to do next: the first one not yet done, or null once the path is finished. */
export const nextStep = (p: Progress): Step | null => STEPS.find((s) => !p.done.includes(s.id)) ?? null

/** A step is open once every step before it is done. */
export function isUnlocked(p: Progress, id: string) {
  const i = STEPS.findIndex((s) => s.id === id)
  return i >= 0 && STEPS.slice(0, i).every((s) => p.done.includes(s.id))
}
