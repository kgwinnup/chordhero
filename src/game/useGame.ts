import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AudioEngine } from '../audio/engine'
import { type Chord, CHORDS_BY_ID } from '../music/chords'
import { applyJudgment, emptyScore, judge, type Judgment, missJudgment, type ScoreState } from './scoring'

export const newKey = () => Math.random().toString(36).slice(2, 10)

export interface SeqItem {
  key: string
  chordId: string
  beats: number
}

export interface Settings {
  bpm: number
  waitMode: boolean
  loop: boolean
  metronome: boolean
  countIn: boolean
  /** 0 (strict) … 100 (lenient) */
  sensitivity: number
  /** Feed synthesized strums to the detector instead of the mic */
  testMode: boolean
}

export type Phase = 'idle' | 'countin' | 'playing' | 'done'

export interface ChordEvent {
  /** Absolute index across loops */
  abs: number
  index: number
  start: number
  end: number
  chord: Chord
}

export interface Layout {
  items: { item: SeqItem; start: number; end: number; chord: Chord }[]
  total: number
}

/** Shared mutable state read by the highway renderer every frame. */
export interface GameView {
  phase: Phase
  pos: number
  results: Map<number, Judgment>
  targetAbs: number | null
  lastJudgment: Judgment | null
  multiplier: number
  /** The chord being listened for, and which of its strings are ringing right now */
  display: Chord | null
  ringing: boolean[]
}

export interface UiState {
  strings: boolean[]
  match: number
  level: number
  target: Chord | null
  next: Chord | null
  countdown: number | null
}

/** How early (in beats) a strum may land before a chord's start and still count. */
export const EARLY_BEATS = 0.5
/** After a chord is first recognised, keep listening this long for the rest of its strings. */
const JUDGE_SECONDS = 0.3
/** Onset detection lags the actual strum by roughly this much. */
const INPUT_LATENCY = 0.03

export function buildLayout(seq: SeqItem[]): Layout {
  let acc = 0
  const items = seq
    .filter((item) => CHORDS_BY_ID[item.chordId])
    .map((item) => {
      const start = acc
      acc += item.beats
      return { item, start, end: acc, chord: CHORDS_BY_ID[item.chordId] }
    })
  return { items, total: acc }
}

export function eventByAbs(layout: Layout, abs: number, loop: boolean): ChordEvent | null {
  const n = layout.items.length
  if (!n || abs < 0) return null
  const cycle = Math.floor(abs / n)
  if (!loop && cycle > 0) return null
  const index = abs - cycle * n
  const it = layout.items[index]
  const offset = cycle * layout.total
  return { abs, index, start: offset + it.start, end: offset + it.end, chord: it.chord }
}

export function eventAt(layout: Layout, beat: number, loop: boolean): ChordEvent | null {
  const n = layout.items.length
  if (!n) return null
  const b = Math.max(0, beat)
  const cycle = Math.floor(b / layout.total)
  if (!loop && cycle > 0) return null
  const local = b - cycle * layout.total
  const index = layout.items.findIndex((it) => local >= it.start && local < it.end)
  return eventByAbs(layout, cycle * n + Math.max(0, index), loop)
}

export function useGame(engine: AudioEngine | null, seq: SeqItem[], settings: Settings, previewChordId: string | null) {
  const layout = useMemo(() => buildLayout(seq), [seq])
  const layoutRef = useRef(layout)
  const settingsRef = useRef(settings)
  const previewRef = useRef(previewChordId)
  useLayoutEffect(() => {
    layoutRef.current = layout
    settingsRef.current = settings
    previewRef.current = previewChordId
  })

  const view = useRef<GameView>({ phase: 'idle', pos: -1.5, results: new Map(), targetAbs: null, lastJudgment: null, multiplier: 1, display: null, ringing: Array(6).fill(false) })
  const internal = useRef({
    lastT: 0,
    nextClick: 0,
    nextResolve: 0,
    windowOpenedAt: null as number | null,
    /** AudioContext time the target chord's beat lands (or when we arrived at it, in wait mode) */
    targetStartTime: 0,
    judging: null as { abs: number; until: number; best: number; onset: number } | null,
    strummed: new Set<number>(),
  })

  const [phase, setPhase] = useState<Phase>('idle')
  const [score, setScore] = useState<ScoreState>(emptyScore)
  const scoreRef = useRef<ScoreState>(emptyScore())
  const [ui, setUi] = useState<UiState>({ strings: Array(6).fill(false), match: 0, level: 0, target: null, next: null, countdown: null })
  const uiKey = useRef('')

  const start = useCallback(async () => {
    if (!engine || !layoutRef.current.items.length) return
    await engine.resume()
    const v = view.current
    v.pos = settingsRef.current.countIn ? -4 : -1
    v.results = new Map()
    v.targetAbs = null
    v.lastJudgment = null
    v.multiplier = 1
    v.phase = 'countin'
    const st = internal.current
    st.lastT = engine.ctx.currentTime
    st.nextClick = Math.ceil(v.pos)
    st.nextResolve = 0
    st.windowOpenedAt = null
    st.judging = null
    st.strummed = new Set()
    scoreRef.current = emptyScore()
    setScore(scoreRef.current)
    setPhase('countin')
  }, [engine])

  const stop = useCallback(() => {
    view.current.phase = 'idle'
    view.current.pos = -1.5
    view.current.targetAbs = null
    view.current.results = new Map()
    view.current.multiplier = 1
    setPhase('idle')
  }, [])

  useEffect(() => {
    if (!engine) return
    let raf = 0

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const v = view.current
      const st = internal.current
      const s = settingsRef.current
      const lay = layoutRef.current
      const threshold = 24 - (s.sensitivity / 100) * 18 // 24 dB strict … 6 dB lenient, 15 by default
      const now = engine.ctx.currentTime
      const minMatch = 0.8 - (s.sensitivity / 100) * 0.2

      const record = (j: Judgment) => {
        v.results.set(j.abs, j)
        scoreRef.current = applyJudgment(scoreRef.current, j)
        v.lastJudgment = j
        v.multiplier = scoreRef.current.multiplier
        setScore(scoreRef.current)
      }
      const expectedStrings = (e: ChordEvent) => e.chord.frets.filter((f) => f >= 0).length
      const finalize = (e: ChordEvent) => {
        const jg = st.judging!
        st.judging = null
        record(judge(scoreRef.current, e.abs, jg.best, expectedStrings(e), jg.onset - INPUT_LATENCY - st.targetStartTime))
      }

      let target: ChordEvent | null = null
      let next: Chord | null = null
      let countdown: number | null = null
      let analysisChord: Chord | null

      if (v.phase === 'idle' || v.phase === 'done') {
        // Free play: light up strings for the chord being previewed.
        analysisChord = (previewRef.current && CHORDS_BY_ID[previewRef.current]) || lay.items[0]?.chord || null
        next = lay.items[1]?.chord ?? null
      } else {
        const bps = s.bpm / 60
        const dt = Math.min(now - st.lastT, 0.1)
        st.lastT = now
        let pos = v.pos + dt * bps

        if (s.waitMode && pos >= 0) {
          // Hold at the start of a chord until it's been played.
          const e = eventAt(lay, pos, s.loop)
          if (e && !v.results.has(e.abs)) pos = e.start
        }

        if (!s.loop && pos >= lay.total) {
          for (let e = eventByAbs(lay, st.nextResolve, false); e; e = eventByAbs(lay, ++st.nextResolve, false)) {
            if (v.results.has(e.abs)) continue
            if (st.judging?.abs === e.abs) finalize(e)
            else record(missJudgment(e.abs, expectedStrings(e)))
          }
          v.phase = 'done'
          v.pos = lay.total
          setPhase('done')
          return
        }
        v.pos = pos
        if (pos >= 0 && v.phase === 'countin') {
          v.phase = 'playing'
          setPhase('playing')
        }
        if (pos < 0) countdown = Math.ceil(-pos)

        // Metronome, scheduled slightly ahead on the audio clock for tight timing.
        while (st.nextClick <= pos + 0.12 * bps) {
          if (s.metronome || st.nextClick < 0) {
            engine.click(now + (st.nextClick - pos) / bps, ((st.nextClick % 4) + 4) % 4 === 0)
          }
          st.nextClick++
        }

        // Anything that scrolled past unplayed is a miss (unless we were mid-judgement).
        for (let e = eventByAbs(lay, st.nextResolve, s.loop); e && e.end <= pos; e = eventByAbs(lay, ++st.nextResolve, s.loop)) {
          if (v.results.has(e.abs)) continue
          if (st.judging?.abs === e.abs) finalize(e)
          else record(missJudgment(e.abs, expectedStrings(e)))
        }

        const cur = eventAt(lay, pos, s.loop)
        target = cur
        if (cur && v.results.has(cur.abs)) {
          const after = eventByAbs(lay, cur.abs + 1, s.loop)
          if (after && pos >= after.start - EARLY_BEATS) target = after
        }
        if (target && target.abs !== v.targetAbs) {
          v.targetAbs = target.abs
          st.windowOpenedAt = null
        }
        // In wait mode the clock freezes on the chord, so its "beat" is when we arrived.
        if (target && (!s.waitMode || pos < target.start)) st.targetStartTime = now + (target.start - pos) / bps
        analysisChord = target?.chord ?? null
        next = target ? eventByAbs(lay, target.abs + 1, s.loop)?.chord ?? null : null

        // Test mode: a slightly sloppy robot strums along so every grade shows up.
        if (s.testMode && target && !st.strummed.has(target.abs) && target.start - pos <= EARLY_BEATS) {
          st.strummed.add(target.abs)
          const r = Math.random()
          const jitter = r < 0.55 ? 0 : (Math.random() - 0.5) * 0.4
          const played = target.chord.frets.flatMap((f, i) => (f >= 0 ? [i] : []))
          const drop = r > 0.8 ? played.slice(0, 1 + Math.floor(Math.random() * 2)) : []
          engine.strum(target.chord, now + Math.max(0, (target.start - pos) / bps) + jitter, true, drop)
        }
      }

      const a = engine.analyze(analysisChord, threshold)

      if (target && (v.phase === 'playing' || v.phase === 'countin')) {
        const inWindow = v.pos >= target.start - EARLY_BEATS && v.pos < target.end && !v.results.has(target.abs)
        if (inWindow) {
          if (st.windowOpenedAt === null) st.windowOpenedAt = now
          const expected = expectedStrings(target)
          const ringing = a.strings.filter((on, i) => on && target!.chord.frets[i] >= 0).length
          const strummedNow = a.lastOnsetAt >= st.windowOpenedAt - 0.15
          const soundsRight = a.gate && a.match >= minMatch - 0.1
          // Start judging once enough of the chord is recognised, then take the best string count.
          if (!st.judging && strummedNow && soundsRight && ringing / expected >= 0.34) {
            st.judging = { abs: target.abs, until: now + JUDGE_SECONDS, best: ringing, onset: a.lastOnsetAt }
          }
          if (st.judging?.abs === target.abs) {
            if (soundsRight) st.judging.best = Math.max(st.judging.best, ringing)
            if (now >= st.judging.until || st.judging.best === expected) finalize(target)
          }
        }
      }

      const strings = analysisChord ? a.strings : Array(6).fill(false)
      v.display = analysisChord
      v.ringing = strings
      const key = [strings.join(), a.match.toFixed(2), a.level.toFixed(3), analysisChord?.id, next?.id, countdown].join('|')
      if (key !== uiKey.current) {
        uiKey.current = key
        setUi({ strings, match: a.match, level: a.level, target: analysisChord, next, countdown })
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  return { layout, view, phase, score, ui, start, stop }
}
