import { describe, expect, it } from 'vitest'
import { gradeStrums, parsePattern, SLOTS, strumScore } from './strum'

const slotSec = 0.5 // eighth notes at 60 BPM
const at = (bar: number, slot: number, offset = 0) => 1 + (bar * SLOTS + slot) * slotSec + offset
const campfire = parsePattern('D-DU-UDU')

describe('strumming patterns', () => {
  it('reads a pattern, anything but D or U a rest', () => {
    expect(parsePattern('D-DU x.')).toEqual(['D', '-', 'D', 'U', '-', '-', '-'])
  })

  it('scores a perfect bar', () => {
    const attacks = campfire.flatMap((s, i) => (s === '-' ? [] : [at(0, i)]))
    const g = gradeStrums(campfire, 1, 1, slotSec, attacks)
    expect(g.slots).toEqual(['hit', 'rest', 'hit', 'hit', 'rest', 'hit', 'hit', 'hit'])
    expect(strumScore(g)).toBe(100)
  })

  it('marks early, late and missed strokes', () => {
    const g = gradeStrums(campfire, 1, 1, slotSec, [at(0, 0, -0.08), at(0, 2, 0.09), at(0, 3), at(0, 6), at(0, 7)])
    expect(g.slots).toEqual(['early', 'rest', 'late', 'hit', 'rest', 'miss', 'hit', 'hit'])
    expect(g.hits).toBe(5)
    expect(g.expected).toBe(6)
    expect(strumScore(g)).toBe(83)
  })

  it('counts strums on rests, and too far off, against you', () => {
    const quarters = parsePattern('D-D-D-D-')
    const g = gradeStrums(quarters, 1, 1, slotSec, [at(0, 0), at(0, 1), at(0, 2), at(0, 4, 0.2), at(0, 6)])
    expect(g.slots).toEqual(['hit', 'extra', 'hit', 'rest', 'miss', 'rest', 'hit', 'rest'])
    expect(g.extras).toBe(2)
    expect(strumScore(g)).toBe(25)
  })

  it('leaves slots pending until their window closes, and tracks drift', () => {
    const quarters = parsePattern('D-D-D-D-')
    const g = gradeStrums(quarters, 2, 1, slotSec, [at(0, 0, 0.04), at(0, 2, 0.06)], at(0, 3))
    expect(g.slots.slice(0, 5)).toEqual(['hit', 'rest', 'late', 'pending', 'pending'])
    expect(g.expected).toBe(2)
    expect(g.drift).toBeCloseTo(0.05)
  })
})
