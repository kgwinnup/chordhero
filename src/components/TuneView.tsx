import { useEffect, useMemo, useRef, useState } from 'react'
import type { AudioEngine } from '../audio/engine'
import { headstockGeometry } from '../music/headstock'
import { centsOff, type HeadstockLayout, INSTRUMENTS, INSTRUMENTS_BY_ID, IN_TUNE_CENTS, nextToTune, noteLabel, searchRange, stringNumber, tuneHint, tuneOrder } from '../music/tunings'

interface Props {
  engine: AudioEngine
  micOn: boolean
  onEnableMic: () => void
  onBack: () => void
}

/** Hold within tolerance this long before a string counts as tuned. */
const HOLD_MS = 800
/** Pause on the ✓ before moving to the next string. */
const ADVANCE_MS = 900
/** Readings averaged for a steady needle. */
const SMOOTHING = 5

function loadChoice() {
  try {
    const saved = JSON.parse(localStorage.getItem('chordlight.tuner') ?? 'null') as { instrument: string; tuning: string } | null
    if (saved && INSTRUMENTS_BY_ID[saved.instrument]?.tunings.some((t) => t.id === saved.tuning)) return saved
  } catch {
    /* fall back to the default */
  }
  return { instrument: 'acoustic', tuning: 'standard' }
}

/** Tune one string at a time: pick the instrument, then follow the needle on each peg. */
export function TuneView({ engine, micOn, onEnableMic, onBack }: Props) {
  const [choice, setChoice] = useState(loadChoice)
  const instrument = INSTRUMENTS_BY_ID[choice.instrument]
  const tuning = instrument.tunings.find((t) => t.id === choice.tuning) ?? instrument.tunings[0]
  const order = useMemo(() => tuneOrder(tuning), [tuning])
  /** The string being tuned; until one is picked, the first in tuning order (the highest string). */
  const [picked, setPicked] = useState<number | null>(null)
  const current = picked ?? order[0]
  const [tuned, setTuned] = useState<Set<number>>(new Set())
  /** Latest steadied reading, tagged with the string it was for. */
  const [live, setLive] = useState<{ string: number; cents: number | null; freq: number | null; holding: number } | null>(null)
  const target = tuning.notes[current]
  const allTuned = tuned.size === tuning.notes.length

  useEffect(() => {
    try {
      localStorage.setItem('chordlight.tuner', JSON.stringify(choice))
    } catch {
      /* not saved */
    }
  }, [choice])

  // Changing instrument or tuning starts over from the first string.
  const choose = (instrumentId: string, tuningId?: string) => {
    const inst = INSTRUMENTS_BY_ID[instrumentId]
    setChoice({ instrument: instrumentId, tuning: tuningId ?? (inst.tunings.some((t) => t.id === choice.tuning) ? choice.tuning : inst.tunings[0].id) })
    setPicked(null)
    setTuned(new Set())
  }

  // Listen: steady the reading, and move on once the string has held in tune.
  const tunedRef = useRef(tuned)
  useEffect(() => {
    tunedRef.current = tuned
  }, [tuned])
  const readings = useRef<number[]>([])
  const inTuneSince = useRef<number | null>(null)
  const advancing = useRef(false)
  useEffect(() => {
    readings.current = []
    inTuneSince.current = null
    advancing.current = false
    if (!micOn) return
    const id = setInterval(() => {
      if (advancing.current) return
      const p = engine.pitch(searchRange(target))
      if (!p) {
        inTuneSince.current = null
        setLive((l) => (l?.string === current ? { ...l, holding: 0 } : null))
        return
      }
      readings.current = [...readings.current, centsOff(p.freq, target)].slice(-SMOOTHING)
      const sorted = [...readings.current].sort((a, b) => a - b)
      const c = sorted[sorted.length >> 1]
      let progress = 0
      if (Math.abs(c) <= IN_TUNE_CENTS) {
        inTuneSince.current ??= performance.now()
        progress = Math.min(1, (performance.now() - inTuneSince.current) / HOLD_MS)
        if (progress >= 1) {
          advancing.current = true
          setTuned((t) => new Set(t).add(current))
          setTimeout(() => {
            // On to the next string down, wrapping round to any skipped earlier.
            const next = nextToTune(order, current, tunedRef.current)
            if (next !== undefined) setPicked(next)
            else advancing.current = false
          }, ADVANCE_MS)
        }
      } else {
        inTuneSince.current = null
      }
      setLive({ string: current, cents: c, freq: p.freq, holding: progress })
    }, 80)
    return () => clearInterval(id)
  }, [engine, micOn, target, current, order])

  const shown = live?.string === current ? live : null
  const cents = shown?.cents ?? null
  const freq = shown?.freq ?? null
  const holding = shown?.holding ?? 0
  const hint = cents === null ? null : tuneHint(cents)
  const needle = cents === null ? 0 : Math.max(-60, Math.min(60, (cents / 50) * 60))

  return (
    <section className="tune">
      <div className="tune-head">
        <button className="ghost" onClick={onBack}>
          ← Back
        </button>
        <h2>Tune</h2>
        <span />
      </div>

      <div className="tune-pickers">
        <div className="segmented tune-instruments" role="radiogroup" aria-label="Instrument">
          {INSTRUMENTS.map((inst) => (
            <button key={inst.id} role="radio" aria-checked={inst.id === instrument.id} className={inst.id === instrument.id ? 'on' : ''} onClick={() => choose(inst.id)}>
              {inst.name}
            </button>
          ))}
        </div>
        {instrument.tunings.length > 1 && (
          <select aria-label="Tuning" value={tuning.id} onChange={(e) => choose(instrument.id, e.target.value)}>
            {instrument.tunings.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="tune-body">
        <Headstock
          layout={instrument.layout}
          notes={tuning.notes}
          current={current}
          tuned={tuned}
          onPick={(i) => {
            setPicked(i)
            setTuned((t) => {
              const n = new Set(t)
              n.delete(i)
              return n
            })
          }}
        />

        <div className="tune-gauge">
          <div className="tune-target">
            <span className="tune-note">{noteLabel(target)}</span>
            <button className="icon" aria-label={`Play ${noteLabel(target)}`} title="Hear this note" onClick={() => engine.resume().then(() => engine.pluck(target))}>
              ♪
            </button>
          </div>
          <span className="tune-string">
            String {stringNumber(tuning, current)} of {tuning.notes.length}
          </span>

          <svg viewBox="0 0 200 116" className={`tune-meter ${hint?.kind === 'in-tune' ? 'in-tune' : ''}`} aria-hidden>
            <path d="M20 100 A80 80 0 0 1 180 100" className="tune-arc" />
            <path d="M93 22 A80 80 0 0 1 107 22" className="tune-arc-zone" />
            {[-50, -25, 0, 25, 50].map((t) => {
              const a = ((t / 50) * 60 * Math.PI) / 180
              return <line key={t} x1={100 + 72 * Math.sin(a)} y1={100 - 72 * Math.cos(a)} x2={100 + 84 * Math.sin(a)} y2={100 - 84 * Math.cos(a)} className="tune-tick" />
            })}
            <line x1="100" y1="100" x2="100" y2="28" className="tune-needle" style={{ transform: `rotate(${needle}deg)`, opacity: cents === null ? 0.25 : 1 }} />
            <circle cx="100" cy="100" r="6" className="tune-hub" />
            <text x="22" y="114" className="tune-scale">
              ♭
            </text>
            <text x="178" y="114" className="tune-scale">
              ♯
            </text>
          </svg>

          <div className={`tune-hint ${hint?.kind ?? ''}`} aria-live="polite">
            {!micOn ? (
              <button className="primary" onClick={onEnableMic}>
                🎤 Turn on the mic to tune
              </button>
            ) : allTuned ? (
              'All strings in tune 🤘'
            ) : hint === null ? (
              `Pluck the ${noteLabel(target)} string`
            ) : hint.kind === 'in-tune' ? (
              tuned.has(current) ? '✓ In tune' : 'Hold it…'
            ) : (
              <>
                {hint.kind === 'up' ? '▲ Tune up' : '▼ Tune down'}
                {hint.semitones >= 1 && <small>{hint.semitones} semitone{hint.semitones > 1 ? 's' : ''} {hint.kind === 'up' ? 'low' : 'high'}</small>}
              </>
            )}
          </div>
          <div className="tune-hold" aria-hidden>
            <i style={{ width: `${holding * 100}%` }} />
          </div>
          <span className="tune-hz">{freq ? `${freq.toFixed(1)} Hz · ${cents! > 0 ? '+' : ''}${Math.round(cents!)} cents` : ' '}</span>
          {allTuned && (
            <button
              className="ghost"
              onClick={() => {
                setTuned(new Set())
                setPicked(null)
              }}
            >
              Start over
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function Headstock({
  layout,
  notes,
  current,
  tuned,
  onPick,
}: {
  layout: HeadstockLayout
  notes: number[]
  current: number
  tuned: Set<number>
  onPick: (i: number) => void
}) {
  const g = headstockGeometry(layout, notes.length)
  const nutLeft = Math.min(...g.nutX) - 6
  const nutWidth = Math.max(...g.nutX) - Math.min(...g.nutX) + 12
  return (
    <svg viewBox="0 0 320 444" className="headstock" role="img" aria-label="Headstock">
      <defs>
        <linearGradient id="hs-wood" x1="0" x2="1">
          <stop offset="0" stopColor="#0c0b0b" />
          <stop offset="0.5" stopColor="#24201e" />
          <stop offset="1" stopColor="#0c0b0b" />
        </linearGradient>
        <radialGradient id="hs-chrome" cx="35%" cy="30%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#b9b9c2" />
          <stop offset="1" stopColor="#55555e" />
        </radialGradient>
      </defs>
      {/* Neck below the nut */}
      <rect x={nutLeft - 8} y={g.nutY} width={nutWidth + 16} height={40} fill="#141110" />
      <path d={g.outline} fill="url(#hs-wood)" stroke="#3a3a42" strokeWidth="2" />
      <rect x={nutLeft - 6} y={g.nutY - 4} width={nutWidth + 12} height={8} rx="2" fill="#efe9da" />
      {g.pegs.map((p, i) => {
        const active = i === current
        const done = tuned.has(i)
        return (
          <g key={i} className={`peg ${active ? 'active' : ''} ${done ? 'done' : ''}`} onClick={() => onPick(i)} role="button" aria-label={`String ${notes.length - i}, ${noteLabel(notes[i])}`}>
            <line x1={g.nutX[i]} y1={g.nutY + 40} x2={g.nutX[i]} y2={g.nutY} className="peg-string" />
            <line x1={g.nutX[i]} y1={g.nutY} x2={p.x} y2={p.y} className="peg-string" />
            <line x1={p.x} y1={p.y} x2={p.buttonX + (p.buttonX < p.x ? 22 : -22)} y2={p.y} className="peg-shaft" />
            <circle cx={p.x} cy={p.y} r="9" fill="url(#hs-chrome)" />
            <rect x={p.buttonX - 22} y={p.y - 17} width="44" height="34" rx="14" className="peg-button" />
            <text x={p.buttonX} y={p.y + 6} className="peg-label">
              {done ? '✓' : noteLabel(notes[i]).replace(/\d+$/, '')}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
