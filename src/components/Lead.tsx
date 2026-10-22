import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AudioEngine } from '../audio/engine'
import { CHORDS_BY_ID, guitar, NOTE_NAMES } from '../music/chords'
import { buildLayout, type GameView } from '../game/useGame'
import { type Hint, SPOKEN_STRING } from '../learn/coach'
import type { JamStep, RunStep, ScaleStep } from '../learn/path'
import { stepTitle } from '../learn/path'
import { gradeNotes, type HeardNote, inScale, newNoteScores, noteName, type Pick, playedNotes, runScore, SCALES, type ScaleNote, scaleNotes, upAndDown } from '../learn/scale'
import { HintBubble, LessonHead, type LessonProps } from './Learn'
import { Neck, type NeckMark } from './Neck'

/** Mic input reaches the analyser about this long after the pick. */
const MIC_LATENCY = 0.03
/** Clicks, the band and demo notes are scheduled this far ahead, in seconds. */
const LOOKAHEAD = 0.25
/** Compare the spectrum this long after a pick with the one just before it. */
const LISTEN_AFTER = 0.2
/** Keep a spectrum about this often, in ms. */
const FRAME_MS = 25
/** New sound quieter than this (power, about −70 dB) isn't a pick. */
const NEW_SOUND_FLOOR = 1e-7

const NO_STRIP = buildLayout([])
const ORDINAL = ['open', '1st', '2nd', '3rd', '4th', '5th']

const where = (n: ScaleNote) => `${n.fret === 0 ? 'open' : `${ORDINAL[n.fret]} fret,`} ${SPOKEN_STRING[n.string]} string`

/** The scale's notes on the chosen guitar, and every semitone around them to listen for. */
function useScale(id: string) {
  const scale = SCALES[id]
  const notes = useMemo(() => scaleNotes(scale, guitar.open), [scale])
  const candidates = useMemo(() => {
    const lo = notes[0].midi - 2
    return Array.from({ length: notes[notes.length - 1].midi + 3 - lo }, (_, i) => lo + i)
  }, [notes])
  return { scale, notes, candidates }
}

/**
 * Calls `onPick` for each note picked, with the notes it played (strongest first). The spectrum
 * just before each pick is kept, to tell what the pick added from what was already ringing.
 */
function usePicks(engine: AudioEngine, view: React.RefObject<GameView>, candidates: number[], on: boolean, demo: boolean, onPick: (p: Pick) => void) {
  const cb = useRef(onPick)
  useLayoutEffect(() => {
    cb.current = onPick
  })
  useEffect(() => {
    if (!on) return
    let raf = 0
    let lastRead = 0
    let seen = view.current.heard.attack
    const frames: { t: number; db: Float32Array; binHz: number }[] = []
    const pending: number[] = []
    const latency = demo ? 0 : MIC_LATENCY
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick)
      if (ms - lastRead < FRAME_MS || !engine.awake) return
      lastRead = ms
      const t = engine.ctx.currentTime
      frames.push({ t, ...engine.spectrum() })
      while (frames.length && frames[0].t < t - 1) frames.shift()
      const h = view.current.heard
      if (h.attack > seen) {
        seen = h.attack
        pending.push(h.attack)
      }
      // Decide a pick a moment after it, or just before the next one if that comes sooner.
      while (pending.length) {
        const at = pending[0]
        const until = Math.min(at + LISTEN_AFTER, (pending[1] ?? Infinity) - 0.01)
        if (t < until) break
        pending.shift()
        const before = frames.filter((f) => f.t <= at).at(-1)
        const after = frames.filter((f) => f.t <= until).at(-1)
        const played = before && after && after !== before ? playedNotes(newNoteScores(before.db, after.db, after.binHz, candidates), candidates, NEW_SOUND_FLOOR) : []
        cb.current({ at: at - latency, rang: played })
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [on, engine, view, candidates, demo])
}

/**
 * The note a pick played: the lowest of those it sounded. A note's overtones land on higher notes
 * (and can even outscore it), but nothing it plays sounds below it.
 */
const lowest = (p: Pick) => (p.rang.length ? Math.min(...p.rang) : null)

/** No chord on the neck while a scale is up. */
function useNoChord(onChord: (id: string | null) => void) {
  useEffect(() => onChord(''), [onChord])
}

/** Learn the shape: play each note of the scale up and back down, at your own pace. */
export function ScaleLesson({ engine, view, step, demo, onChord, onBack, onFinish }: LessonProps & { step: ScaleStep }) {
  const { scale, notes, candidates } = useScale(step.scale)
  const order = useMemo(() => upAndDown(notes), [notes])
  const [idx, setIdx] = useState(0)
  const [hint, setHint] = useState<Hint | null>(null)
  const target = order[idx] ?? null
  const passed = idx >= order.length
  /** Audio time until which the app is playing the scale itself: not you. */
  const quietUntil = useRef(0)
  useNoChord(onChord)

  // A pick counts when the note to play is one it made ring.
  usePicks(engine, view, candidates, !passed, demo, (p) => {
    if (!target || p.at < quietUntil.current) return
    if (p.rang.includes(target.midi)) {
      setIdx((i) => i + 1)
      setHint(null)
    } else if (p.rang.length) {
      setHint({ tone: 'fix', text: `That's ${noteName(lowest(p)!)}. Play ${noteName(target.midi)}: ${where(target)}.` })
    }
  })

  const goingDown = idx >= notes.length
  const played = goingDown ? order.slice(notes.length - 1, idx) : order.slice(0, idx)
  const marks: NeckMark[] = notes.map((n) => ({ string: n.string, fret: n.fret, label: noteName(n.midi), root: n.root, state: n === target ? 'target' : played.includes(n) ? 'hit' : 'idle' }))

  const hearScale = async () => {
    await engine.resume()
    const t0 = engine.ctx.currentTime + 0.1
    order.forEach((n, i) => engine.pluck(n.midi, t0 + i * 0.35))
    quietUntil.current = t0 + order.length * 0.35 + 1.5
  }
  const pickIt = async () => {
    if (!target) return
    await engine.resume()
    engine.pluck(target.midi, engine.ctx.currentTime, true)
  }

  return (
    <section className="learn lesson">
      <LessonHead title={stepTitle(step)} goal={passed ? 'Done!' : `Note ${Math.min(idx + 1, order.length)} of ${order.length} · ${goingDown ? 'back down' : 'going up'}`} onBack={onBack} />
      <div className="stage">
        <Neck layout={NO_STRIP} view={view} loop={false} marks={marks} />
      </div>
      <div className="panel lesson-panel">
        {passed ? (
          <div className="lesson-pass">
            <h3>You played the whole scale! 🤘</h3>
            <p>
              Up and back down, every note of {scale.name}. The ringed notes are {NOTE_NAMES[scale.root]}, the root: solos love to start and end there. Next, play it in time with the
              click.
            </p>
            <button className="primary big" onClick={onFinish}>
              Next step →
            </button>
          </div>
        ) : (
          <>
            <HintBubble
              hint={hint}
              idle={
                idx === 0
                  ? `Pick one note at a time, low to high, then back down. Start with ${noteName(target!.midi)}: ${where(target!)}.`
                  : `Now ${noteName(target!.midi)}: ${where(target!)}.`
              }
            />
            <div className="row lesson-actions">
              {demo ? <button onClick={pickIt}>♪ Play it for me</button> : <button onClick={hearScale}>♪ Hear the scale</button>}
              <button className="link" onClick={onFinish}>
                I know this one: skip
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/** Mark the note to play now, and how the one before it went. */
function runMarks(notes: ScaleNote[], target: ScaleNote | null, prev: ScaleNote | null, prevGood: boolean | null): NeckMark[] {
  return notes.map((n) => ({
    string: n.string,
    fret: n.fret,
    label: noteName(n.midi),
    root: n.root,
    state: n === target ? 'target' : n === prev && prevGood !== null ? (prevGood ? 'hit' : 'wrong') : 'idle',
  }))
}

/** Play the scale up and down in time with the click; pass, then try it faster. */
export function RunDrill({ engine, view, step, demo, progress, onChord, onBest, onBack, onFinish }: LessonProps & { step: RunStep }) {
  const { notes, candidates } = useScale(step.scale)
  const order = useMemo(() => upAndDown(notes), [notes])
  const expected = useMemo(() => order.map((n) => n.midi), [order])
  const [bpm, setBpm] = useState(step.bpm)
  const beat = 60 / bpm
  const stepSec = beat / step.perBeat
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready')
  const [start, setStart] = useState(0)
  const [heard, setHeard] = useState<HeardNote[]>([])
  const [now, setNow] = useState(0)
  const best = progress.best[step.id] ?? 0
  useNoChord(onChord)

  const begin = async (at = bpm) => {
    await engine.resume()
    setBpm(at)
    setHeard([])
    setStart(engine.ctx.currentTime + 0.3 + 4 * (60 / at))
    setNow(engine.ctx.currentTime)
    setPhase('running')
  }

  // The note due at that moment if the pick made it ring, or else whatever rang most.
  const dueAt = (at: number) => expected[Math.max(0, Math.min(expected.length - 1, Math.round((at - start) / stepSec)))]
  usePicks(engine, view, candidates, phase === 'running', demo, (p) => {
    const due = dueAt(p.at)
    if (p.at >= start - stepSec) setHeard((list) => [...list, { at: p.at, midi: p.rang.includes(due) ? due : lowest(p) }])
  })

  useEffect(() => {
    if (phase !== 'running') return
    let raf = 0
    let shown = -Infinity
    const beats = Math.ceil(order.length / step.perBeat)
    const end = start + order.length * stepSec
    let nextClick = -4
    let nextNote = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const t = engine.ctx.currentTime
      for (; nextClick < beats && start + nextClick * beat < t + LOOKAHEAD; nextClick++) engine.click(start + nextClick * beat, ((nextClick % 4) + 4) % 4 === 0)
      for (; demo && nextNote < order.length && start + nextNote * stepSec < t + LOOKAHEAD; nextNote++) {
        // Mostly right and in time; now and then a slip, so every grade shows up.
        const r = Math.random()
        const midi = r < 0.05 ? order[nextNote].midi + 1 : order[nextNote].midi
        const off = r < 0.85 ? (Math.random() - 0.5) * 0.04 : (Math.random() - 0.5) * 0.2
        engine.pluck(midi, start + nextNote * stepSec + off, true)
      }
      const i = Math.floor((t - start) / stepSec + 0.5)
      if (i !== shown) {
        shown = i
        setNow(t)
      }
      if (t > end + 0.3) {
        setNow(t)
        setPhase('done')
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, start, beat, stepSec, demo, engine, order, step.perBeat])

  const grades = gradeNotes(expected, start, stepSec, heard, phase === 'done' ? Infinity : now)
  const score = runScore(grades, order.length)
  const passed = phase === 'done' && score >= step.goal

  useEffect(() => {
    if (passed) onBest(step.id, bpm)
    // Record once, when the run ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const cur = Math.max(0, Math.min(order.length - 1, Math.floor((now - start) / stepSec + 0.5)))
  const counting = now < start - stepSec / 2
  const prevGrade = cur > 0 ? grades.slots[cur - 1] : 'pending'
  const marks =
    phase === 'running'
      ? runMarks(notes, counting ? order[0] : order[cur], counting ? null : order[cur - 1] ?? null, prevGrade === 'pending' ? null : prevGrade === 'hit' || prevGrade === 'early' || prevGrade === 'late')
      : runMarks(notes, null, null, null)
  const tip =
    grades.drift < -0.04
      ? "You're rushing ahead of the click. Let each note land on it."
      : grades.drift > 0.04
        ? "You're behind the click. Look one note ahead so your finger is ready."
        : grades.slots.includes('wrong')
          ? 'Some notes were wrong: say each note name as you play it.'
          : 'Keep your fingers close to the strings between notes.'

  return (
    <section className="learn lesson">
      <LessonHead title={stepTitle(step)} goal={`Goal: ${step.goal}% at ${step.bpm} BPM${best ? ` · best ${best} BPM` : ''}`} onBack={onBack} />
      <div className="stage">
        <Neck layout={NO_STRIP} view={view} loop={false} marks={marks} />
        {phase === 'running' && (
          <div className="drill-hud" aria-live="off">
            <span className="drill-time">{counting ? Math.ceil((start - now) / beat) : `${bpm} BPM`}</span>
            <span className="drill-count">
              <b key={grades.hits}>{grades.hits}</b> / {order.length}
            </span>
          </div>
        )}
      </div>
      <div className="panel lesson-panel">
        {phase === 'ready' && (
          <div className="drill-intro">
            <p>
              Play the scale up and back down, {step.perBeat === 1 ? 'one note on each click' : 'two notes to each click'}. The glowing dot is the note to play
              now. After a bar of count-in, off you go.
            </p>
            <div className="row lesson-actions">
              <button className="primary big" onClick={() => begin()}>
                Start
              </button>
              <button className="link" onClick={onFinish}>
                Skip
              </button>
            </div>
          </div>
        )}
        {phase === 'running' && (
          <>
            <div className="drill-now">
              <span>Play</span>
              <b key={cur}>{noteName(order[cur].midi)}</b>
              {order[cur + 1] && <span>then {noteName(order[cur + 1].midi)}</span>}
            </div>
            <div className="row lesson-actions">
              <button className="ghost" onClick={() => setPhase('done')}>
                Stop
              </button>
            </div>
          </>
        )}
        {phase === 'done' && (
          <div className="lesson-pass">
            <h3>
              {score}% at {bpm} BPM {passed ? '🤘' : ''}
            </h3>
            <p>
              {grades.hits} of {order.length} notes right and in time
              {grades.extras ? `, ${grades.extras} extra` : ''}. {passed ? `You beat the goal of ${step.goal}%.` : `The goal is ${step.goal}%.`} {tip}
            </p>
            <div className="row lesson-actions">
              {passed && (
                <button className="primary big" onClick={onFinish}>
                  Next step →
                </button>
              )}
              {passed && <button onClick={() => begin(bpm + 10)}>Faster: {bpm + 10} BPM ⚡</button>}
              <button className={passed ? '' : 'primary big'} onClick={() => begin()}>
                ↻ Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/** Combo multiplier: up one every 8 notes in key in a row, to ×4. */
const jamMultiplier = (combo: number) => Math.min(4, 1 + Math.floor(combo / 8))
/** With a real mic, a note starting this soon after a backing strum may be the speaker: ignore it. */
const BLEED_SECONDS = 0.12

/** Improvise over a backing loop: every note of the scale scores, and notes in a row build a combo. */
export function JamLesson({ engine, view, step, demo, progress, onChord, onBest, onBack, onFinish }: LessonProps & { step: JamStep }) {
  const { scale, notes, candidates } = useScale(step.scale)
  const beat = 60 / step.bpm
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready')
  const [start, setStart] = useState(0)
  const [now, setNow] = useState(0)
  const [jam, setJam] = useState({ inKey: 0, outKey: 0, combo: 0, points: 0, last: null as { midi: number; at: number; good: boolean } | null })
  const [hint, setHint] = useState<Hint | null>(null)
  const backing = useRef<number[]>([])
  const best = progress.best[step.id] ?? 0
  useNoChord(onChord)

  const begin = async () => {
    await engine.resume()
    backing.current = []
    setJam({ inKey: 0, outKey: 0, combo: 0, points: 0, last: null })
    setHint(null)
    setStart(engine.ctx.currentTime + 0.3 + 4 * beat)
    setNow(engine.ctx.currentTime)
    setPhase('running')
  }

  usePicks(engine, view, candidates, phase === 'running', demo, (p) => {
    const end = start + step.bars * 4 * beat
    const n = { at: p.at, midi: lowest(p) }
    if (n.midi === null || n.at < start - 0.15 || n.at > end) return
    if (!demo && backing.current.some((b) => n.at - b >= -0.02 && n.at - b < BLEED_SECONDS)) return
    const good = inScale(scale, n.midi)
    const last = { midi: n.midi, at: n.at, good }
    setJam((j) =>
      good
        ? { ...j, inKey: j.inKey + 1, combo: j.combo + 1, points: j.points + 10 * jamMultiplier(j.combo + 1), last }
        : { ...j, outKey: j.outKey + 1, combo: 0, last },
    )
    setHint(good ? null : { tone: 'fix', text: `${noteName(n.midi)} isn't in ${scale.name}. Stay on the dots.` })
  })

  useEffect(() => {
    if (phase !== 'running') return
    let raf = 0
    let shownBeat = -Infinity
    const beats = step.bars * 4
    const end = start + beats * beat
    let nextBeat = -4
    let nextEighth = 0
    let walk = Math.floor(notes.length / 3)
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const t = engine.ctx.currentTime
      for (; nextBeat < beats && start + nextBeat * beat < t + LOOKAHEAD; nextBeat++) {
        const at = start + nextBeat * beat
        const inBar = ((nextBeat % 4) + 4) % 4
        engine.click(at, inBar === 0)
        // The band: the progression strummed on beats 1 and 3, a chord a bar.
        if (nextBeat >= 0 && (inBar === 0 || inBar === 2)) {
          engine.strum(CHORDS_BY_ID[step.chords[Math.floor(nextBeat / 4) % step.chords.length]], at)
          backing.current.push(at)
        }
      }
      // Demo mode: a robot noodles up and down the scale, now and then off it.
      for (; demo && nextEighth < beats * 2 && start + (nextEighth * beat) / 2 < t + LOOKAHEAD; nextEighth++) {
        if (Math.random() < 0.3) continue
        walk = Math.max(0, Math.min(notes.length - 1, walk + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.7 ? 1 : 2)))
        const midi = Math.random() < 0.06 ? notes[walk].midi + 1 : notes[walk].midi
        engine.pluck(midi, start + (nextEighth * beat) / 2 + (Math.random() - 0.5) * 0.03, true)
      }
      const b = Math.floor((t - start) / beat)
      if (b !== shownBeat) {
        shownBeat = b
        setNow(t)
      }
      if (t > end + 0.3) {
        setNow(t)
        setPhase('done')
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, start, beat, demo, engine, notes, step.bars, step.chords])

  const total = jam.inKey + jam.outKey
  const inKeyShare = total ? jam.inKey / total : 0
  const passed = phase === 'done' && jam.inKey >= step.goal && inKeyShare >= 0.8

  useEffect(() => {
    if (phase === 'done') onBest(step.id, jam.inKey)
    // Record once, when the jam ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const bar = Math.max(0, Math.floor((now - start) / beat / 4))
  const chordNow = step.chords[bar % step.chords.length]
  const chordNext = step.chords[(bar + 1) % step.chords.length]
  const fresh = jam.last && now - jam.last.at < 0.6 ? jam.last : null
  const marks: NeckMark[] = notes.map((n) => ({
    string: n.string,
    fret: n.fret,
    label: noteName(n.midi),
    root: n.root,
    state: fresh && fresh.good && fresh.midi === n.midi ? 'hit' : 'idle',
  }))

  return (
    <section className="learn lesson">
      <LessonHead title={stepTitle(step)} goal={`Goal: ${step.goal} notes in key${best ? ` · best ${best}` : ''}`} onBack={onBack} />
      <div className="stage">
        <Neck layout={NO_STRIP} view={view} loop={false} marks={marks} />
        {phase === 'running' && (
          <div className="drill-hud" aria-live="off">
            <span className="drill-time">{now < start ? Math.ceil((start - now) / beat) : `Bar ${Math.min(bar + 1, step.bars)}/${step.bars}`}</span>
            <span className="drill-count">
              <b key={jam.points}>{jam.points}</b> ×{jamMultiplier(jam.combo)}
            </span>
          </div>
        )}
      </div>
      <div className="panel lesson-panel">
        {phase === 'ready' && (
          <div className="drill-intro">
            <p>
              The band plays {step.chords.join(' – ')} for {step.bars} bars. Make up your own melody from the dots: every note of {scale.name} sounds good over it.
              Notes in a row build your multiplier; one off the scale resets it. Try ending on a ringed {NOTE_NAMES[scale.root]}. Headphones help, so the band isn't heard as you.
            </p>
            <div className="row lesson-actions">
              <button className="primary big" onClick={begin}>
                Start jamming
              </button>
              <button className="link" onClick={onFinish}>
                Skip
              </button>
            </div>
          </div>
        )}
        {phase === 'running' && (
          <>
            <div className="drill-now">
              <span>Band</span>
              <b key={bar}>{chordNow}</b>
              <span>then {chordNext}</span>
            </div>
            <HintBubble hint={hint} idle={`${jam.inKey} notes in key${jam.combo >= 4 ? ` · ${jam.combo} in a row 🔥` : ''}`} />
            <div className="row lesson-actions">
              <button className="ghost" onClick={() => setPhase('done')}>
                Stop
              </button>
            </div>
          </>
        )}
        {phase === 'done' && (
          <div className="lesson-pass">
            <h3>
              {jam.points} points {passed ? '🤘' : ''}
            </h3>
            <p>
              {jam.inKey} notes in key{jam.outKey ? `, ${jam.outKey} off the scale` : ''} ({Math.round(inKeyShare * 100)}%).{' '}
              {passed
                ? 'That was a solo. Play it again and try a different melody.'
                : jam.inKey < step.goal
                  ? `Aim for ${step.goal} notes in key: keep picking, two notes to a click is plenty.`
                  : 'Stay on the dots: at least 80% of your notes should be in the scale.'}
            </p>
            <div className="row lesson-actions">
              {passed && (
                <button className="primary big" onClick={onFinish}>
                  Next step →
                </button>
              )}
              <button className={passed ? '' : 'primary big'} onClick={begin}>
                ↻ Jam again
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
