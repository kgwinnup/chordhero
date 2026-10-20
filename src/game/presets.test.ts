import { beforeEach, describe, expect, it } from 'vitest'
import { CHORDS_BY_ID } from '../music/chords'
import { BUILT_IN_PRESETS, loadCustomPresets, randomItems, saveCustomPresets, toItems, toSeq } from './presets'

// A minimal localStorage for Node.
const store = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

beforeEach(() => store.clear())

describe('built-in presets', () => {
  it('have unique ids and real chords', () => {
    expect(new Set(BUILT_IN_PRESETS.map((p) => p.id)).size).toBe(BUILT_IN_PRESETS.length)
    for (const p of BUILT_IN_PRESETS) for (const it of p.items) expect(CHORDS_BY_ID[it.chordId]).toBeDefined()
  })
})

describe('sequences', () => {
  it('round-trip through preset items with unique keys', () => {
    const items = [
      { chordId: 'G', beats: 4 },
      { chordId: 'G', beats: 2 },
    ]
    const seq = toSeq(items)
    expect(new Set(seq.map((s) => s.key)).size).toBe(2)
    expect(toItems(seq)).toEqual(items)
  })
})

describe('custom presets', () => {
  it('start empty', () => {
    expect(loadCustomPresets()).toEqual([])
  })

  it('save and load', () => {
    saveCustomPresets([{ id: 'custom-a', name: 'Campfire', builtIn: false, items: [{ chordId: 'Am', beats: 4 }] }])
    expect(loadCustomPresets()).toEqual([{ id: 'custom-a', name: 'Campfire', builtIn: false, items: [{ chordId: 'Am', beats: 4 }] }])
  })

  it('drop unknown chords and presets left empty', () => {
    store.set(
      'chordlight.custom',
      JSON.stringify([
        { id: 'a', name: 'Mixed', items: [{ chordId: 'Q7', beats: 4 }, { chordId: 'C', beats: 2 }] },
        { id: 'b', name: 'Bad', items: [{ chordId: 'Q7', beats: 4 }] },
      ]),
    )
    const loaded = loadCustomPresets()
    expect(loaded.map((p) => p.name)).toEqual(['Mixed'])
    expect(loaded[0].items).toEqual([{ chordId: 'C', beats: 2 }])
  })

  it('migrate the single sequence older versions saved', () => {
    store.set('chordlight.seq', JSON.stringify([{ key: 'x', chordId: 'E', beats: 4 }]))
    expect(loadCustomPresets()).toMatchObject([{ name: 'My chords', items: [{ chordId: 'E', beats: 4 }] }])
  })

  it('stay deleted rather than bringing the old sequence back', () => {
    store.set('chordlight.seq', JSON.stringify([{ key: 'x', chordId: 'E', beats: 4 }]))
    saveCustomPresets([])
    expect(loadCustomPresets()).toEqual([])
  })
})

describe('random preset', () => {
  it('never plays the same chord twice in a row, even across the loop', () => {
    for (const chords of [['Em', 'Am'], ['Em', 'Am', 'E'], ['Em', 'Am', 'E', 'A', 'D']]) {
      const items = randomItems(chords, 200)
      expect(items).toHaveLength(200)
      items.forEach((it, i) => {
        expect(chords).toContain(it.chordId)
        expect(it.chordId).not.toBe(items[(i + 1) % items.length].chordId)
      })
    }
  })

  it('uses every learned chord', () => {
    const chords = ['Em', 'Am', 'E', 'A']
    expect(new Set(randomItems(chords, 200).map((it) => it.chordId))).toEqual(new Set(chords))
  })
})
