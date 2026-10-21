/** One eighth-note slot of a strumming pattern: a downstroke, an upstroke, or a rest. */
export type Stroke = 'D' | 'U' | '-'

/** Slots in a bar of 4/4, counted in eighth notes: 1 & 2 & 3 & 4 &. */
export const SLOTS = 8
export const SLOT_COUNTS = ['1', '&', '2', '&', '3', '&', '4', '&']
/** Bars a strumming drill plays, after a bar of count-in. */
export const STRUM_BARS = 4

/** A strum this close to its slot is right on time, in seconds. */
export const ON_TIME = 0.05
/** The furthest a strum may be from its slot and still count, in seconds (or less, at fast tempos). */
const MAX_WINDOW = 0.12

export const parsePattern = (pattern: string): Stroke[] => [...pattern].map((c) => (c === 'D' || c === 'U' ? c : '-'))

/**
 * How a slot went. `pending` until it's had its chance; `rest` is a rest left alone, `extra` a strum
 * where none belonged (on a rest, or a second strum on one slot).
 */
export type SlotGrade = 'pending' | 'hit' | 'early' | 'late' | 'miss' | 'rest' | 'extra'

export interface StrumGrades {
  /** One per slot, bar after bar */
  slots: SlotGrade[]
  /** Strums that landed in their slot (early, late or right on) */
  hits: number
  /** Strokes in the pattern so far */
  expected: number
  /** Strums where there shouldn't have been one */
  extras: number
  /** Average of how far off the hits were, in seconds: negative is early */
  drift: number
}

/**
 * Grades strums against a pattern played from `start` for `bars` bars, with slots `slotSec` apart.
 * Each strum belongs to the nearest slot. Slots whose window hasn't closed by `now` are pending.
 */
export function gradeStrums(pattern: Stroke[], bars: number, start: number, slotSec: number, attacks: number[], now = Infinity): StrumGrades {
  const window = Math.min(MAX_WINDOW, slotSec * 0.45)
  const n = bars * SLOTS
  const offsets: (number | null)[] = new Array(n).fill(null)
  const extraAt = new Array<boolean>(n).fill(false)
  let strays = 0
  for (const t of attacks) {
    const i = Math.round((t - start) / slotSec)
    if (i < 0 || i >= n) continue
    const dt = t - (start + i * slotSec)
    if (pattern[i % SLOTS] !== '-' && offsets[i] === null && Math.abs(dt) <= window) offsets[i] = dt
    else if (pattern[i % SLOTS] === '-') extraAt[i] = true
    else strays++
  }

  const slots: SlotGrade[] = []
  let hits = 0
  let expected = 0
  let extras = strays
  let drift = 0
  for (let i = 0; i < n; i++) {
    const closed = now > start + i * slotSec + window
    const stroke = pattern[i % SLOTS]
    const dt = offsets[i]
    if (stroke === '-') {
      if (extraAt[i]) extras++
      slots.push(extraAt[i] ? 'extra' : closed ? 'rest' : 'pending')
      continue
    }
    if (dt !== null) {
      hits++
      expected++
      drift += dt
      slots.push(Math.abs(dt) <= ON_TIME ? 'hit' : dt < 0 ? 'early' : 'late')
    } else if (closed) {
      expected++
      slots.push('miss')
    } else slots.push('pending')
  }
  return { slots, hits, expected, extras, drift: hits ? drift / hits : 0 }
}

/** Percent of the pattern played in time, less any extra strums. */
export const strumScore = (g: StrumGrades) => (g.expected ? Math.round((Math.max(0, g.hits - g.extras) / g.expected) * 100) : 0)
