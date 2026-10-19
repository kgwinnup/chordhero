import { describe, expect, it } from 'vitest'
import { buildLayout, eventAt, eventByAbs, type SeqItem } from './useGame'

const seq = (...items: [string, number][]): SeqItem[] => items.map(([chordId, beats], i) => ({ key: String(i), chordId, beats }))

describe('buildLayout', () => {
  it('places chords back to back', () => {
    const lay = buildLayout(seq(['G', 4], ['C', 2], ['D', 1]))
    expect(lay.items.map((it) => [it.chord.id, it.start, it.end])).toEqual([
      ['G', 0, 4],
      ['C', 4, 6],
      ['D', 6, 7],
    ])
    expect(lay.total).toBe(7)
  })

  it('skips unknown chords', () => {
    expect(buildLayout(seq(['G', 4], ['H#', 4], ['C', 4])).items.map((it) => it.chord.id)).toEqual(['G', 'C'])
  })
})

describe('eventAt', () => {
  const lay = buildLayout(seq(['G', 4], ['C', 2]))

  it('finds the chord under a beat, switching exactly at boundaries', () => {
    expect(eventAt(lay, 0, false)?.chord.id).toBe('G')
    expect(eventAt(lay, 3.99, false)?.chord.id).toBe('G')
    expect(eventAt(lay, 4, false)?.chord.id).toBe('C')
  })

  it('treats the count-in as the first chord', () => {
    expect(eventAt(lay, -2, false)?.abs).toBe(0)
  })

  it('ends after the last chord without looping', () => {
    expect(eventAt(lay, 6, false)).toBeNull()
  })

  it('keeps counting through loops', () => {
    const e = eventAt(lay, 6 + 4.5, true)!
    expect(e.chord.id).toBe('C')
    expect(e.abs).toBe(3)
    expect([e.start, e.end]).toEqual([10, 12])
  })
})

describe('eventByAbs', () => {
  const lay = buildLayout(seq(['G', 4], ['C', 2]))

  it('maps absolute indexes into later loops', () => {
    expect(eventByAbs(lay, 2, true)).toMatchObject({ index: 0, start: 6, end: 10 })
    expect(eventByAbs(lay, 2, false)).toBeNull()
    expect(eventByAbs(lay, -1, true)).toBeNull()
  })
})
