import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AudioEngine } from '../audio/engine'
import { type Chord, CHORDS_BY_ID } from '../music/chords'

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
export type Result = 'hit' | 'miss'

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
  results: Map<number, Result>
  targetAbs: number | null
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
const HIT_FRAMES = 3

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

  const view = useRef<GameView>({ phase: 'idle', pos: -1.5, results: new Map(), targetAbs: null })
  const internal = useRef({
    lastT: 0,
    nextClick: 0,
    nextResolve: 0,
    goodFrames: 0,
    windowOpenedAt: null as number | null,
    strummed: new Set<number>(),
  })

  const [phase, setPhase] = useState<Phase>('idle')
  const [score, setScore] = useState({ hits: 0, misses: 0, streak: 0, best: 0 })
  const [ui, setUi] = useState<UiState>({ strings: Array(6).fill(false), match: 0, level: 0, target: null, next: null, countdown: null })
  const uiKey = useRef('')

  const start = useCallback(async () => {
    if (!engine || !layoutRef.current.items.length) return
    await engine.resume()
    const v = view.current
    v.pos = settingsRef.current.countIn ? -4 : -1
    v.results = new Map()
    v.targetAbs = null
    v.phase = 'countin'
    const st = internal.current
    st.lastT = engine.ctx.currentTime
    st.nextClick = Math.ceil(v.pos)
    st.nextResolve = 0
    st.goodFrames = 0
    st.windowOpenedAt = null
    st.strummed = new Set()
    setScore({ hits: 0, misses: 0, streak: 0, best: 0 })
    setPhase('countin')
  }, [engine])

  const stop = useCallback(() => {
    view.current.phase = 'idle'
    view.current.pos = -1.5
    view.current.targetAbs = null
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
      const threshold = 30 - (s.sensitivity / 100) * 22 // 30 dB strict … 8 dB lenient
      const now = engine.ctx.currentTime

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

        // Anything that scrolled past unplayed is a miss.
        for (let e = eventByAbs(lay, st.nextResolve, s.loop); e && e.end <= pos; e = eventByAbs(lay, ++st.nextResolve, s.loop)) {
          if (!v.results.has(e.abs)) {
            v.results.set(e.abs, 'miss')
            setScore((sc) => ({ ...sc, misses: sc.misses + 1, streak: 0 }))
          }
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
          st.goodFrames = 0
        }
        analysisChord = target?.chord ?? null
        next = target ? eventByAbs(lay, target.abs + 1, s.loop)?.chord ?? null : null

        // Test mode: strum the right chord on the beat, as if a player did.
        if (s.testMode && target && !st.strummed.has(target.abs) && target.start - pos <= EARLY_BEATS) {
          st.strummed.add(target.abs)
          engine.strum(target.chord, now + Math.max(0, (target.start - pos) / bps) - 0.04, true)
        }
      }

      const a = engine.analyze(analysisChord, threshold)

      if (target && (v.phase === 'playing' || v.phase === 'countin')) {
        const inWindow = v.pos >= target.start - EARLY_BEATS && v.pos < target.end && !v.results.has(target.abs)
        if (inWindow) {
          if (st.windowOpenedAt === null) st.windowOpenedAt = now
          const expected = target.chord.frets.filter((f) => f >= 0).length
          const ringing = a.strings.filter((on, i) => on && target!.chord.frets[i] >= 0).length
          const strummedNow = a.lastOnsetAt >= st.windowOpenedAt - 0.15
          const minMatch = 0.8 - (s.sensitivity / 100) * 0.2
          const good = a.gate && strummedNow && ringing / expected >= 0.6 && a.match >= minMatch
          st.goodFrames = good ? st.goodFrames + 1 : 0
          if (st.goodFrames >= HIT_FRAMES) {
            v.results.set(target.abs, 'hit')
            setScore((sc) => ({ ...sc, hits: sc.hits + 1, streak: sc.streak + 1, best: Math.max(sc.best, sc.streak + 1) }))
          }
        }
      }

      const strings = analysisChord ? a.strings : Array(6).fill(false)
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
