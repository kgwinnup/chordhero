import { describe, expect, it } from 'vitest'
import { applyJudgment, COMBO_STEP, emptyScore, gradeFor, judge, MAX_MULTIPLIER, missJudgment, multiplierFor, starsFor, timingFactor } from './scoring'

describe('timing', () => {
  it('rewards strums closer to the beat', () => {
    expect(timingFactor(0)).toBe(1)
    expect(timingFactor(0.06)).toBe(1)
    expect(timingFactor(0.08)).toBe(0.85)
    expect(timingFactor(-0.12)).toBe(0.85)
    expect(timingFactor(0.18)).toBe(0.7)
    expect(timingFactor(0.25)).toBe(0.35)
    expect(timingFactor(0.6)).toBe(0.35)
  })
})

describe('grades', () => {
  it('map quality to grades', () => {
    expect(gradeFor(1)).toBe('perfect')
    expect(gradeFor(0.85)).toBe('great')
    expect(gradeFor(0.84)).toBe('good')
    expect(gradeFor(0.7)).toBe('good')
    expect(gradeFor(0.69)).toBe('ok')
  })

  it('a chord missing one of six strings, right on the beat, is GOOD, not GREAT', () => {
    expect(judge(emptyScore(), 0, 5, 6, 0).grade).toBe('good')
    expect(judge(emptyScore(), 0, 4, 6, 0).grade).toBe('ok')
  })
})

describe('judge', () => {
  it('gives full points for every string on the beat', () => {
    const j = judge(emptyScore(), 0, 6, 6, 0.01)
    expect(j.grade).toBe('perfect')
    expect(j.points).toBe(100)
    expect(j.timing).toBeNull()
  })

  it('gives fewer points for missing strings', () => {
    const j = judge(emptyScore(), 0, 3, 6, 0)
    expect(j.quality).toBeCloseTo(0.5)
    expect(j.points).toBe(50)
    expect(j.grade).toBe('ok')
  })

  it('labels early and late strums', () => {
    expect(judge(emptyScore(), 0, 6, 6, -0.2).timing).toBe('early')
    expect(judge(emptyScore(), 0, 6, 6, 0.2).timing).toBe('late')
  })
})

describe('combo and multiplier', () => {
  it(`step up every ${COMBO_STEP} chords, capped at ×${MAX_MULTIPLIER}`, () => {
    expect(multiplierFor(0)).toBe(1)
    expect(multiplierFor(COMBO_STEP)).toBe(2)
    expect(multiplierFor(COMBO_STEP * 10)).toBe(MAX_MULTIPLIER)
  })

  it('multiplies points once the combo builds, and a miss resets it', () => {
    let score = emptyScore()
    for (let i = 0; i < COMBO_STEP; i++) score = applyJudgment(score, judge(score, i, 6, 6, 0))
    expect(score.combo).toBe(COMBO_STEP)
    expect(score.multiplier).toBe(2)
    const doubled = judge(score, COMBO_STEP, 6, 6, 0)
    expect(doubled.points).toBe(200)
    score = applyJudgment(score, missJudgment(COMBO_STEP + 1, 6))
    expect(score.combo).toBe(0)
    expect(score.multiplier).toBe(1)
    expect(score.maxCombo).toBe(COMBO_STEP)
    expect(score.counts.miss).toBe(1)
  })

  it('keeps the crowd meter between 0 and 1', () => {
    let score = emptyScore()
    for (let i = 0; i < 50; i++) score = applyJudgment(score, missJudgment(i, 6))
    expect(score.rock).toBe(0)
    for (let i = 0; i < 50; i++) score = applyJudgment(score, judge(score, i, 6, 6, 0))
    expect(score.rock).toBe(1)
  })
})

describe('stars', () => {
  it('reflect average accuracy', () => {
    expect(starsFor(emptyScore())).toBe(0)
    let score = emptyScore()
    for (let i = 0; i < 4; i++) score = applyJudgment(score, judge(score, i, 6, 6, 0))
    expect(starsFor(score)).toBe(5)
    score = applyJudgment(score, missJudgment(5, 6))
    score = applyJudgment(score, missJudgment(6, 6))
    expect(starsFor(score)).toBe(2) // 4 perfect + 2 misses = 67% accuracy
  })
})
