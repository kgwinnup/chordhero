import { describe, expect, it } from 'vitest'
import { emptyLight, FADE_SECONDS, type Frame, gradeLight, RIGHT_FRAMES, type StrumLight, updateLight, VERDICT_SECONDS } from './strumLight'

const ALL = [false, true, true, true, true, true]
const SOME = [false, true, false, true, false, false]
const NONE = [false, false, false, false, false, false]
const FRAME = 1 / 60

/** Play frames from `start` for `seconds`, all with the same reading. */
function run(l: StrumLight, start: number, seconds: number, f: Omit<Frame, 'now'>) {
  for (let now = start; now < start + seconds; now += FRAME) l = updateLight(l, { ...f, now })
  return l
}

const strum = (onset: number, strings: boolean[], soundsRight: boolean) => ({ onset, chordId: 'Am', strings, soundsRight })

describe('strum light', () => {
  it('is white while listening, then green for a strum that sounds like the chord', () => {
    let l = run(emptyLight(), 1, FRAME, strum(1, ALL, true))
    expect(l.tone).toBe('listening')
    l = run(l, 1 + FRAME, VERDICT_SECONDS, strum(1, ALL, true))
    expect(l.tone).toBe('right')
    expect(l.strings).toEqual(ALL)
  })

  it('is red for a loud wrong chord, even with every string lit', () => {
    const l = run(emptyLight(), 1, VERDICT_SECONDS + 0.1, strum(1, ALL, false))
    expect(l.tone).toBe('wrong')
  })

  it('needs more than a stray frame or two of the right sound', () => {
    const frames = Math.ceil(VERDICT_SECONDS / FRAME) + 1
    const play = (right: number) => {
      let l = emptyLight()
      for (let i = 0; i < frames; i++) l = updateLight(l, { now: 1 + i * FRAME, ...strum(1, ALL, i < right) })
      return l.tone
    }
    expect(play(RIGHT_FRAMES - 1)).toBe('wrong')
    expect(play(RIGHT_FRAMES)).toBe('right')
  })

  it('holds one color and one set of strings for the whole strum', () => {
    let l = run(emptyLight(), 1, VERDICT_SECONDS + 0.05, strum(1, ALL, true))
    // Strings flicker as the strum rings on: the light doesn't.
    for (let i = 0; i < 30; i++) {
      l = updateLight(l, { now: 1.4 + i * FRAME, ...strum(1, i % 2 ? SOME : ALL, i % 3 === 0) })
      expect(l.tone).toBe('right')
      expect(l.strings).toEqual(ALL)
    }
  })

  it('a new strum starts over', () => {
    let l = run(emptyLight(), 1, 0.5, strum(1, ALL, false))
    expect(l.tone).toBe('wrong')
    l = updateLight(l, { now: 1.6, ...strum(1.6, ALL, true) })
    expect(l.tone).toBe('listening')
    l = run(l, 1.6 + FRAME, VERDICT_SECONDS, strum(1.6, ALL, true))
    expect(l.tone).toBe('right')
  })

  it('takes the grade color once the game scores the strum', () => {
    let l = run(emptyLight(), 1, 0.5, strum(1, ALL, true))
    l = gradeLight(l, 'good')
    expect(l.tone).toBe('good')
    l = run(l, 1.5, 0.3, strum(1, SOME, true))
    expect(l.tone).toBe('good')
    // A miss isn't a strum: nothing to color.
    expect(gradeLight(emptyLight(), 'miss').tone).toBeNull()
  })

  it('goes dark once the strings stop ringing', () => {
    let l = run(emptyLight(), 1, 0.5, strum(1, ALL, true))
    l = run(l, 1.5, FADE_SECONDS + 0.05, strum(1, NONE, false))
    expect(l.tone).toBeNull()
    expect(l.strings).toEqual(NONE)
  })

  it('keeps a muted string that was hit for the whole strum, and clears it on the next', () => {
    const LOW_E = [true, false, false, false, false, false]
    let l = updateLight(emptyLight(), { now: 1, ...strum(1, ALL, true), muted: LOW_E })
    l = run(l, 1 + FRAME, 0.5, { ...strum(1, ALL, true), muted: NONE })
    expect(l.mutedHit).toEqual(LOW_E)
    expect(l.tone).toBe('right') // the chord can still be right: the red string is the strum's flaw
    l = updateLight(l, { now: 1.6, ...strum(1.6, ALL, true), muted: NONE })
    expect(l.mutedHit).toEqual(NONE)
  })

  it('forgets the old strum when the chord changes', () => {
    let l = run(emptyLight(), 1, 0.5, strum(1, ALL, true))
    l = updateLight(l, { now: 1.5, onset: 1, chordId: 'E', strings: SOME, soundsRight: false })
    expect(l.tone).toBe('listening')
    expect(l.strings).toEqual(SOME)
  })
})
