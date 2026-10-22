import { beforeEach, describe, expect, it } from 'vitest'
import { CHORDS_BY_ID, PRESETS } from '../music/chords'
import { emptyProgress, isUnlocked, LEAD_STEPS, loadProgress, markDone, nextStep, PATH, recordBest, saveProgress, type Step, STEPS } from './path'

const chordsOf = (s: Step): string[] => ('chords' in s ? s.chords : 'chord' in s ? [s.chord] : [])

describe('the beginner path', () => {
  it('uses only real chords and unique step ids', () => {
    const chords = [...STEPS, ...LEAD_STEPS].flatMap(chordsOf)
    for (const id of chords) expect(CHORDS_BY_ID[id], id).toBeDefined()
    expect(new Set(STEPS.map((s) => s.id)).size).toBe(STEPS.length)
  })

  it('teaches every chord before drilling or playing it', () => {
    const learned = new Set<string>()
    for (const s of STEPS) {
      if (s.kind === 'shape') learned.add(s.chord)
      else for (const c of chordsOf(s)) expect(learned.has(c), `${s.id} uses ${c} before it's taught`).toBe(true)
    }
  })

  it('starts with E minor and covers the seven beginner chords first', () => {
    expect(STEPS[0]).toMatchObject({ kind: 'shape', chord: 'Em' })
    const shapes = (units: typeof PATH) => units.flatMap((u) => u.steps.flatMap((s) => (s.kind === 'shape' ? [s.chord] : [])))
    expect(shapes(PATH.slice(0, 7)).sort()).toEqual(['A', 'Am', 'C', 'D', 'E', 'Em', 'G'])
    expect(shapes(PATH.slice(7)).sort()).toEqual(['A7', 'B7', 'Bm', 'D7', 'Dm', 'E7', 'F', 'Fmaj7', 'G7'])
  })

  it('teaches every chord the built-in songs use', () => {
    const taught = new Set(STEPS.flatMap((s) => (s.kind === 'shape' ? [s.chord] : [])))
    for (const p of PRESETS) for (const c of p.chords) expect(taught.has(c), `${p.name} uses ${c}`).toBe(true)
  })

  it('unlocks steps in order', () => {
    let p = emptyProgress()
    expect(nextStep(p)?.id).toBe(STEPS[0].id)
    expect(isUnlocked(p, STEPS[0].id)).toBe(true)
    expect(isUnlocked(p, STEPS[1].id)).toBe(false)
    p = markDone(p, STEPS[0].id)
    expect(isUnlocked(p, STEPS[1].id)).toBe(true)
    expect(nextStep(p)?.id).toBe(STEPS[1].id)
    for (const s of STEPS) p = markDone(p, s.id)
    expect(nextStep(p)).toBeNull()
  })

  it('opens the lead path from the start, in its own order', () => {
    const p = emptyProgress()
    expect(isUnlocked(p, LEAD_STEPS[0].id)).toBe(true)
    expect(isUnlocked(p, LEAD_STEPS[1].id)).toBe(false)
    expect(isUnlocked(markDone(p, LEAD_STEPS[0].id), LEAD_STEPS[1].id)).toBe(true)
    expect(nextStep(markDone(p, LEAD_STEPS[0].id))?.id).toBe(STEPS[0].id)
  })

  it('keeps the best drill score', () => {
    let p = recordBest(emptyProgress(), 'changes-Em-Am', 12)
    p = recordBest(p, 'changes-Em-Am', 9)
    expect(p.best['changes-Em-Am']).toBe(12)
    expect(recordBest(p, 'changes-Em-Am', 18).best['changes-Em-Am']).toBe(18)
  })
})

describe('saved progress', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    }
  })

  it('round-trips, dropping steps that no longer exist', () => {
    saveProgress({ done: ['shape-Em', 'gone'], best: { 'changes-Em-Am': 7 } })
    expect(loadProgress()).toEqual({ done: ['shape-Em'], best: { 'changes-Em-Am': 7 } })
  })

  it('starts fresh with nothing saved or garbage saved', () => {
    expect(loadProgress()).toEqual(emptyProgress())
    store.set('chordhero.path', '{nope')
    expect(loadProgress()).toEqual(emptyProgress())
  })
})
