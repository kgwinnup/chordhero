import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AudioEngine } from '../audio/engine'
import { type Chord, CHORDS_BY_ID, MAX_STRINGS } from '../music/chords'
import { RIVAL_LEEWAY } from '../audio/detect'
import { applyJudgment, emptyScore, judge, type Judgment, missJudgment, type ScoreState } from './scoring'
import { adaptTempo, emptyTempo } from './tempo'
import { emptyLight, gradeLight, type StrumLight, type Tone, updateLight } from './strumLight'

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
  /** Speed up after clean chords and slow down after misses */
  adaptiveTempo: boolean
  /** Which guitar is played: an id from GUITARS */
  guitar: string
  /** Show the crowd meter, and play a crowd that reacts to it */
  crowd: boolean
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
  /** The chord being listened for, the strings to light, and in what color (see `StrumLight`) */
  display: Chord | null
  ringing: boolean[]
  tone: Tone | null
  light: StrumLight
  /** The latest analysis, for the lesson screens to listen with */
  heard: Heard
}

export interface Heard {
  /** AudioContext time of this frame */
  at: number
  /** AudioContext time of the last strum's onset */
  onset: number
  /** AudioContext time of the last strum's attack, timed finely enough for rhythm */
  attack: number
  chordId: string | null
  strings: boolean[]
  /** It sounds like the chord, and more like it than any other */
  soundsRight: boolean
  /** Per string: dB its note stands above the noise */
  notes: number[]
}

export interface UiState {
  strings: boolean[]
  match: number
  level: number
  target: Chord | null
  next: Chord | null
  countdown: number | null
}

/** Shortest time between frames: caps the game loop at 60 fps (with a little slack for jitter). */
export const MIN_FRAME_MS = 1000 / 60 - 2
/** Between frames when nothing's playing or ringing: still quick enough to catch a strum. */
export const IDLE_FRAME_MS = 1000 / 15
/** How early (in beats) a strum may land before a chord's start and still count. */
export const EARLY_BEATS = 0.5
/** Share of a chord's strings that must ring before it can score at all. */
const MIN_STRINGS = 2 / 3
/** After a chord is first recognised, keep listening this long for the rest of its strings. */
const JUDGE_SECONDS = 0.3
/** Test mode, wait mode: how long the robot waits before strumming a chord that didn't count again. */
const ROBOT_RETRY_SECONDS = 1.5
/** Onset detection lags the actual strum by roughly this much. */
const INPUT_LATENCY = 0.03

/** dB a string must stand above the noise: 24 strict … 6 lenient, 15 at the default sensitivity. */
export const thresholdFor = (sensitivity: number) => 24 - (sensitivity / 100) * 18
/** How closely the sound must fit the chord's notes (and their overtones): 0.88 strict … 0.68 lenient. */
export const minMatchFor = (sensitivity: number) => 0.88 - (sensitivity / 100) * 0.2

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

/** The chord shown in free play: no preview shows the song's first chord; an empty one (a scale lesson) shows none. */
function previewChord(previewId: string | null, layout: Layout): Chord | null {
  return previewId === null ? (layout.items[0]?.chord ?? null) : (CHORDS_BY_ID[previewId] ?? null)
}

export function useGame(
  engine: AudioEngine | null,
  seq: SeqItem[],
  settings: Settings,
  previewChordId: string | null,
  /** Adaptive tempo changed the BPM */
  onTempo?: (bpm: number, from: number) => void,
) {
  const layout = useMemo(() => buildLayout(seq), [seq])
  const layoutRef = useRef(layout)
  const settingsRef = useRef(settings)
  const previewRef = useRef(previewChordId)
  const onTempoRef = useRef(onTempo)
  useLayoutEffect(() => {
    layoutRef.current = layout
    settingsRef.current = settings
    previewRef.current = previewChordId
    onTempoRef.current = onTempo
  })

  const view = useRef<GameView>({ phase: 'idle', pos: -1.5, results: new Map(), targetAbs: null, lastJudgment: null, multiplier: 1, display: null, ringing: Array(MAX_STRINGS).fill(false), tone: null, light: emptyLight(), heard: { at: 0, onset: 0, attack: -Infinity, chordId: null, strings: Array(MAX_STRINGS).fill(false), soundsRight: false, notes: Array(MAX_STRINGS).fill(0) } })
  const internal = useRef({
    lastT: 0,
    nextClick: 0,
    nextResolve: 0,
    windowOpenedAt: null as number | null,
    /** AudioContext time the target chord's beat lands (or when we arrived at it, in wait mode) */
    targetStartTime: 0,
    judging: null as { abs: number; until: number; best: number; onset: number } | null,
    /** Test mode: when the robot last strummed each chord */
    strummed: new Map<number, number>(),
    tempo: emptyTempo(),
  })

  const [phase, setPhase] = useState<Phase>('idle')
  const [score, setScore] = useState<ScoreState>(emptyScore)
  const scoreRef = useRef<ScoreState>(emptyScore())
  const [ui, setUi] = useState<UiState>({ strings: Array(MAX_STRINGS).fill(false), match: 0, level: 0, target: null, next: null, countdown: null })
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
    st.strummed = new Map()
    st.tempo = emptyTempo()
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
    let lastFrame = -Infinity

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const v = view.current
      const live = v.phase === 'playing' || v.phase === 'countin'
      // Save power: at most 60 frames a second (120 Hz screens gain nothing for audio), only a few
      // while idle and quiet, and none while the audio is asleep with no song to run.
      if (!live && !engine.awake) {
        // Still show the previewed chord's shape, so a lesson's neck isn't blank until a sound.
        if (v.phase === 'idle' || v.phase === 'done') v.display = previewChord(previewRef.current, layoutRef.current)
        return
      }
      const quiet = !live && !v.light.tone && !v.ringing.some(Boolean)
      if (t - lastFrame < (quiet ? IDLE_FRAME_MS : MIN_FRAME_MS)) return
      lastFrame = t
      const st = internal.current
      const s = settingsRef.current
      const lay = layoutRef.current
      const threshold = thresholdFor(s.sensitivity)
      const now = engine.ctx.currentTime
      const minMatch = minMatchFor(s.sensitivity)

      const record = (j: Judgment) => {
        v.results.set(j.abs, j)
        scoreRef.current = applyJudgment(scoreRef.current, j)
        v.lastJudgment = j
        v.light = gradeLight(v.light, j.grade)
        v.multiplier = scoreRef.current.multiplier
        setScore(scoreRef.current)
        if (s.adaptiveTempo && v.phase === 'playing') {
          const t = adaptTempo(st.tempo, j, settingsRef.current.bpm)
          st.tempo = t.state
          const from = settingsRef.current.bpm
          if (t.bpm !== from) {
            // Takes effect on the next frame, before React gets round to it.
            settingsRef.current = { ...settingsRef.current, bpm: t.bpm }
            onTempoRef.current?.(t.bpm, from)
          }
        }
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
        analysisChord = previewChord(previewRef.current, lay)
        next = lay.items[1]?.chord ?? null
      } else {
        const bps = s.bpm / 60
        if (now < st.lastT) {
          // The audio clock restarted (turning the mic on or switching input rebuilds it), so
          // times taken on the old clock are meaningless: forget them rather than stall.
          st.windowOpenedAt = null
          st.judging = null
          st.nextClick = Math.ceil(v.pos)
        }
        const dt = Math.max(0, Math.min(now - st.lastT, 0.1))
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
        // In wait mode the song holds until the chord is played, so it tries again, cleanly.
        const last = target ? st.strummed.get(target.abs) : undefined
        if (s.testMode && target && last !== undefined && s.waitMode && !v.results.has(target.abs) && now - last > ROBOT_RETRY_SECONDS) {
          st.strummed.set(target.abs, now)
          engine.strum(target.chord, now, true)
        } else if (s.testMode && target && last === undefined && target.start - pos <= EARLY_BEATS) {
          st.strummed.set(target.abs, now)
          const r = Math.random()
          const jitter = r < 0.55 ? 0 : (Math.random() - 0.5) * 0.4
          const played = target.chord.frets.flatMap((f, i) => (f >= 0 ? [i] : []))
          const drop = r > 0.8 ? played.slice(0, 1 + Math.floor(Math.random() * 2)) : []
          engine.strum(target.chord, now + Math.max(0, (target.start - pos) / bps) + jitter, true, drop)
        }
      }

      const a = engine.analyze(analysisChord, threshold)
      // It has to sound like this chord, and more like it than like any other chord.
      const soundsRight = a.gate && a.match >= minMatch && a.match >= a.rival - RIVAL_LEEWAY
      v.heard = { at: now, onset: a.lastOnsetAt, attack: a.lastAttackAt, chordId: analysisChord?.id ?? null, strings: a.strings, soundsRight, notes: a.notes }

      if (target && (v.phase === 'playing' || v.phase === 'countin')) {
        const inWindow = v.pos >= target.start - EARLY_BEATS && v.pos < target.end && !v.results.has(target.abs)
        if (inWindow) {
          if (st.windowOpenedAt === null) st.windowOpenedAt = now
          const expected = expectedStrings(target)
          // Each muted string hit by mistake costs one of the strings that rang.
          const ringing = Math.max(0, a.strings.filter((on, i) => on && target!.chord.frets[i] >= 0).length - a.muted.filter(Boolean).length)
          const strummedNow = a.lastOnsetAt >= st.windowOpenedAt - 0.15
          // Start judging once enough of the chord is recognised, then take the best string count.
          if (!st.judging && strummedNow && soundsRight && ringing / expected >= MIN_STRINGS) {
            st.judging = { abs: target.abs, until: now + JUDGE_SECONDS, best: ringing, onset: a.lastOnsetAt }
          }
          if (st.judging?.abs === target.abs) {
            if (soundsRight) st.judging.best = Math.max(st.judging.best, ringing)
            if (now >= st.judging.until || st.judging.best === expected) finalize(target)
          }
        }
      }

      const strings = analysisChord ? a.strings : Array(MAX_STRINGS).fill(false)
      v.display = analysisChord
      v.light = updateLight(v.light, { now, onset: a.lastOnsetAt, chordId: analysisChord?.id ?? null, strings, soundsRight, muted: a.muted })
      v.ringing = v.light.strings
      v.tone = v.light.tone
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
