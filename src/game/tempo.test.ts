import { describe, expect, it } from 'vitest'
import { judge, emptyScore, missJudgment } from './scoring'
import { adaptTempo, emptyTempo, MAX_ADAPTIVE_BPM, MIN_ADAPTIVE_BPM, TEMPO_DOWN, TEMPO_UP, TEMPO_UP_STREAK, type TempoState } from './tempo'

const perfect = () => judge(emptyScore(), 0, 6, 6, 0)
const good = () => judge(emptyScore(), 0, 4, 6, 0) // 0.67 → GOOD
const miss = () => missJudgment(0, 6)

function run(bpm: number, judgments: ReturnType<typeof perfect>[]) {
  let state: TempoState = emptyTempo()
  for (const j of judgments) ({ state, bpm } = adaptTempo(state, j, bpm))
  return bpm
}

describe('adaptive tempo', () => {
  it('speeds up after a run of clean chords', () => {
    expect(run(70, Array.from({ length: TEMPO_UP_STREAK - 1 }, perfect))).toBe(70)
    expect(run(70, Array.from({ length: TEMPO_UP_STREAK }, perfect))).toBe(70 + TEMPO_UP)
    expect(run(70, Array.from({ length: TEMPO_UP_STREAK * 2 }, perfect))).toBe(70 + TEMPO_UP * 2)
  })

  it('slows down after two misses in a row, but not after one', () => {
    expect(run(70, [miss()])).toBe(70)
    expect(run(70, [miss(), miss()])).toBe(70 - TEMPO_DOWN)
    expect(run(70, [miss(), perfect(), miss()])).toBe(70)
  })

  it('a so-so chord breaks a clean run without slowing down', () => {
    expect(run(70, [perfect(), perfect(), perfect(), good(), perfect()])).toBe(70)
  })

  it('stays within limits, and never pulls a tempo set outside them back across', () => {
    expect(run(MAX_ADAPTIVE_BPM - 1, Array.from({ length: TEMPO_UP_STREAK }, perfect))).toBe(MAX_ADAPTIVE_BPM)
    expect(run(180, Array.from({ length: TEMPO_UP_STREAK }, perfect))).toBe(180)
    expect(run(MIN_ADAPTIVE_BPM + 1, [miss(), miss()])).toBe(MIN_ADAPTIVE_BPM)
    expect(run(30, [miss(), miss()])).toBe(30)
  })
})
