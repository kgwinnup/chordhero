import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AudioEngine } from '../audio/engine'
import { CHORDS_BY_ID } from '../music/chords'
import { buildLayout, type GameView } from '../game/useGame'
import { coach, type Hint, isChange, isClean, shapeSteps, type Strum } from '../learn/coach'
import {
  type ChangesStep,
  DRILL_SECONDS,
  isUnlocked,
  nextStep,
  PATH,
  type Progress,
  SHAPE_GOAL,
  type ShapeStep,
  type SongStep,
  type Step,
  STEPS,
  stepGoal,
  stepTitle,
} from '../learn/path'
import { Neck } from './Neck'

interface Props {
  engine: AudioEngine
  view: React.RefObject<GameView>
  progress: Progress
  onDone: (id: string) => void
  onBest: (id: string, count: number) => void
  onReset: () => void
  /** Show (and listen for) this chord on the neck */
  onChord: (chordId: string | null) => void
  onPlaySong: (step: SongStep) => void
  /** Demo mode: the app's own strums are what's heard */
  demo: boolean
}

/** The beginner path: learn each chord, drill the changes, then play it in a song. */
export function Learn(props: Props) {
  const { progress, onChord } = props
  const [openId, setOpenId] = useState<string | null>(null)
  const step = STEPS.find((s) => s.id === openId) ?? null

  useEffect(() => () => onChord(null), [onChord])

  const open = (s: Step) => {
    if (s.kind === 'song') props.onPlaySong(s)
    else setOpenId(s.id)
  }
  const finish = (id: string) => {
    props.onDone(id)
    // Straight on to the next step, unless it's a song (that's its own screen).
    const i = STEPS.findIndex((s) => s.id === id)
    const after = STEPS[i + 1]
    if (after && after.kind !== 'song') setOpenId(after.id)
    else setOpenId(null)
  }
  const back = () => {
    setOpenId(null)
    onChord(null)
  }

  if (step?.kind === 'shape') return <ShapeLesson key={step.id} {...props} step={step} onBack={back} onFinish={() => finish(step.id)} />
  if (step?.kind === 'changes') return <ChangesDrill key={step.id} {...props} step={step} onBack={back} onFinish={() => finish(step.id)} />

  const up = nextStep(progress)
  const doneCount = progress.done.length
  return (
    <section className="learn">
      <div className="learn-head">
        <h2>Beginner path</h2>
        <span className="learn-count">
          {doneCount} / {STEPS.length} steps
        </span>
      </div>
      <div className="learn-bar" aria-hidden>
        <i style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
      </div>

      {up ? (
        <button className="learn-up" onClick={() => open(up)}>
          <span className="learn-up-kicker">Up next</span>
          <span className="learn-up-title">{stepTitle(up)}</span>
          <span className="learn-up-goal">Goal: {stepGoal(up)}</span>
          <span className="learn-up-go">Start →</span>
        </button>
      ) : (
        <div className="learn-up finished">
          <span className="learn-up-kicker">Path complete</span>
          <span className="learn-up-title">You know the 7 beginner chords 🤘</span>
          <span className="learn-up-goal">Keep drilling changes, or build your own songs on the Play screen.</span>
        </div>
      )}

      <ol className="units">
        {PATH.map((unit, u) => (
          <li key={unit.title} className="unit panel">
            <div className="unit-head">
              <span className="unit-num">{u + 1}</span>
              <div>
                <h3>{unit.title}</h3>
                <p>{unit.blurb}</p>
              </div>
            </div>
            <ul className="steps">
              {unit.steps.map((s) => {
                const done = progress.done.includes(s.id)
                const unlocked = isUnlocked(progress, s.id)
                const current = up?.id === s.id
                const best = progress.best[s.id]
                return (
                  <li key={s.id}>
                    <button className={`step ${done ? 'done' : current ? 'current' : unlocked ? '' : 'locked'}`} disabled={!done && !unlocked} onClick={() => open(s)}>
                      <span className="step-mark" aria-hidden>
                        {done ? '✓' : current ? '▶' : unlocked ? '•' : '🔒'}
                      </span>
                      <span className="step-title">{stepTitle(s)}</span>
                      <span className="step-goal">
                        {stepGoal(s)}
                        {best ? ` · best ${best}` : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ol>

      {doneCount > 0 && (
        <button
          className="link learn-reset"
          onClick={() => {
            if (confirm('Start the beginner path over? Your progress will be cleared.')) props.onReset()
          }}
        >
          Reset progress
        </button>
      )}
    </section>
  )
}

/** Seconds after a strum's onset to gather its strings: octave strings can take a moment to light. */
const STRUM_WINDOW = 0.6

/** Collects the strings that ring in the moments after each strum, then reports the strum. */
function useStrums(view: React.RefObject<GameView>, chordId: string, ignoreBefore: React.RefObject<number>, onStrum: (s: Strum) => void) {
  const cb = useRef(onStrum)
  useLayoutEffect(() => {
    cb.current = onStrum
  })
  useEffect(() => {
    let raf = 0
    // Anything already ringing belongs to the chord before.
    let seen = view.current.heard.onset
    let win: { until: number; ringing: boolean[]; soundsRight: boolean } | null = null
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const h = view.current.heard
      if (h.chordId !== chordId) return
      if (h.onset < seen) seen = h.onset // the audio clock restarted
      if (!win) {
        if (h.onset > seen && h.onset >= ignoreBefore.current) {
          seen = h.onset
          win = { until: h.at + STRUM_WINDOW, ringing: [...h.strings], soundsRight: h.soundsRight }
        }
        return
      }
      h.strings.forEach((on, i) => {
        if (on) win!.ringing[i] = true
      })
      win.soundsRight ||= h.soundsRight
      if (h.at >= win.until) {
        cb.current({ ringing: win.ringing, soundsRight: win.soundsRight })
        win = null
        seen = h.onset
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [view, chordId, ignoreBefore])
}

/** Plays a chord for the player, without the coach mistaking it for their strum. */
function useHear(engine: AudioEngine, demo: boolean) {
  const ignoreBefore = useRef(0)
  const hear = async (chordId: string) => {
    await engine.resume()
    const now = engine.ctx.currentTime
    // With a real mic the speaker's strum would be heard as yours; in demo mode it *is* yours.
    if (!demo) ignoreBefore.current = now + 2.5
    engine.strum(CHORDS_BY_ID[chordId], now, demo)
  }
  return { ignoreBefore, hear }
}

interface LessonProps extends Props {
  onBack: () => void
  onFinish: () => void
}

function LessonHead({ title, goal, onBack, children }: { title: string; goal: string; onBack: () => void; children?: React.ReactNode }) {
  return (
    <div className="lesson-head">
      <button className="ghost" onClick={onBack}>
        ← Path
      </button>
      <div className="lesson-title">
        <h2>{title}</h2>
        <span>{goal}</span>
      </div>
      {children}
    </div>
  )
}

function HintBubble({ hint, idle }: { hint: Hint | null; idle: string }) {
  return (
    <p className={`coach ${hint ? `coach-${hint.tone}` : ''}`} aria-live="polite" key={hint?.text}>
      <span className="coach-icon" aria-hidden>
        {hint?.tone === 'great' ? '✓' : hint ? '!' : '🎸'}
      </span>
      {hint ? hint.text : idle}
    </p>
  )
}

function ShapeLesson({ engine, view, step, demo, onChord, onBack, onFinish }: LessonProps & { step: ShapeStep }) {
  const chord = CHORDS_BY_ID[step.chord]
  const layout = useMemo(() => buildLayout([{ key: step.chord, chordId: step.chord, beats: 4 }]), [step.chord])
  const [clean, setClean] = useState(0)
  const [hint, setHint] = useState<Hint | null>(null)
  const { ignoreBefore, hear } = useHear(engine, demo)
  const passed = clean >= SHAPE_GOAL

  useEffect(() => onChord(step.chord), [onChord, step.chord])
  useStrums(view, step.chord, ignoreBefore, (strum) => {
    if (passed) return
    setHint(coach(chord, strum))
    if (isClean(chord, strum)) setClean((n) => n + 1)
  })

  return (
    <section className="learn lesson">
      <LessonHead title={stepTitle(step)} goal={`Strum it cleanly ${SHAPE_GOAL} times`} onBack={onBack}>
        <div className="goal-dots" aria-label={`${Math.min(clean, SHAPE_GOAL)} of ${SHAPE_GOAL} clean strums`}>
          {Array.from({ length: SHAPE_GOAL }, (_, i) => (
            <i key={i} className={i < clean ? 'on' : ''} />
          ))}
        </div>
      </LessonHead>
      <div className="stage">
        <Neck layout={layout} view={view} loop={false} />
      </div>
      <div className="panel lesson-panel">
        {passed ? (
          <div className="lesson-pass">
            <h3>You've got {chord.name}! 🤘</h3>
            <p>Three clean strums. Your fingers will remember this shape faster every time you play it.</p>
            <button className="primary big" onClick={onFinish}>
              Next step →
            </button>
          </div>
        ) : (
          <>
            <HintBubble hint={hint} idle={`Make the ${chord.name} shape, then strum. Green strings rang; dark ones need fixing.`} />
            <ol className="shape-steps">
              {shapeSteps(chord).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            <div className="row lesson-actions">
              <button onClick={() => hear(step.chord)}>♪ Hear it</button>
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

function ChangesDrill({ engine, view, step, demo, progress, onChord, onBest, onBack, onFinish }: LessonProps & { step: ChangesStep }) {
  const [a, b] = step.chords
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready')
  const [target, setTarget] = useState(a)
  /** Clean chords played: the first just starts you off, every one after it is a change. */
  const [played, setPlayed] = useState(0)
  const [left, setLeft] = useState(DRILL_SECONDS)
  const [hint, setHint] = useState<Hint | null>(null)
  const { ignoreBefore, hear } = useHear(engine, demo)
  const changes = Math.max(0, played - 1)
  const best = progress.best[step.id] ?? 0
  const passed = changes >= step.goal
  // The strip shows just the chord to play now.
  const layout = useMemo(() => buildLayout([{ key: target, chordId: target, beats: 4 }]), [target])

  useEffect(() => onChord(target), [onChord, target])

  useEffect(() => {
    if (phase !== 'running') return
    const end = performance.now() + DRILL_SECONDS * 1000
    const timer = setInterval(() => {
      const s = Math.max(0, Math.ceil((end - performance.now()) / 1000))
      setLeft(s)
      if (s === 0) setPhase('done')
    }, 200)
    return () => clearInterval(timer)
  }, [phase])

  useEffect(() => {
    if (phase === 'done') onBest(step.id, changes)
    // Record once, when the minute is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useStrums(view, target, ignoreBefore, (strum) => {
    if (phase !== 'running') return
    const chord = CHORDS_BY_ID[target]
    if (isChange(chord, strum)) {
      setPlayed((n) => n + 1)
      setHint(null)
      setTarget((t) => (t === a ? b : a))
    } else {
      setHint(coach(chord, strum))
    }
  })

  const startDrill = () => {
    setPlayed(0)
    setLeft(DRILL_SECONDS)
    setTarget(a)
    setHint(null)
    setPhase('running')
  }

  return (
    <section className="learn lesson">
      <LessonHead title={stepTitle(step)} goal={`Goal: ${step.goal} clean changes in a minute${best ? ` · best ${best}` : ''}`} onBack={onBack} />
      <div className="stage">
        <Neck layout={layout} view={view} loop={false} />
        {phase === 'running' && (
          <div className="drill-hud" aria-live="off">
            <span className="drill-time">{left}s</span>
            <span className="drill-count">
              <b key={changes}>{changes}</b> / {step.goal}
            </span>
          </div>
        )}
      </div>
      <div className="panel lesson-panel">
        {phase === 'ready' && (
          <div className="drill-intro">
            <p>
              Switch between <b>{CHORDS_BY_ID[a].name}</b> and <b>{CHORDS_BY_ID[b].name}</b> as many times as you can in one minute. Strum once on each chord;
              only clean changes count, so it's fine to go slowly. Doing this for a minute a day is the fastest way to change chords in time.
            </p>
            <div className="row lesson-actions">
              <button className="primary big" onClick={startDrill}>
                Start the minute
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
              <b key={`${target}-${played}`}>{CHORDS_BY_ID[target].name}</b>
            </div>
            <HintBubble hint={hint} idle={played ? 'Nice change! Now switch back.' : `Start with ${CHORDS_BY_ID[a].name}.`} />
            <div className="row lesson-actions">
              {demo && <button onClick={() => hear(target)}>♪ Strum it for me</button>}
              <button className="ghost" onClick={() => setPhase('done')}>
                Stop
              </button>
            </div>
          </>
        )}
        {phase === 'done' && (
          <div className="lesson-pass">
            <h3>
              {changes} change{changes === 1 ? '' : 's'} {passed ? '🤘' : ''}
            </h3>
            <p>
              {passed
                ? `You beat the goal of ${step.goal}. Come back tomorrow and try to beat ${Math.max(best, changes)}.`
                : `The goal is ${step.goal}. Watch which chord slows you down and place those fingers first. Everyone gets faster with a minute a day.`}
            </p>
            <div className="row lesson-actions">
              {passed && (
                <button className="primary big" onClick={onFinish}>
                  Next step →
                </button>
              )}
              <button className={passed ? '' : 'primary big'} onClick={startDrill}>
                ↻ Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
