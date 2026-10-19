import { useEffect, useRef, useState } from 'react'
import { COMBO_STEP, GRADE_LABEL, type Grade, type Judgment, MAX_MULTIPLIER, type ScoreState, starsFor } from '../game/scoring'

/** Smoothly counts a number up to its target. */
function useCountUp(target: number) {
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const diff = target - shownRef.current
      shownRef.current = Math.abs(diff) < 1 ? target : shownRef.current + diff * 0.18
      setShown(Math.round(shownRef.current))
      if (shownRef.current !== target) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return shown
}

export function ScoreHud({ score, crowd }: { score: ScoreState; crowd: boolean }) {
  const points = useCountUp(score.points)
  const accuracy = score.judged ? Math.round((score.qualitySum / score.judged) * 100) : null
  const progress = score.multiplier >= MAX_MULTIPLIER ? 1 : (score.combo % COMBO_STEP) / COMBO_STEP
  return (
    <div className="hud">
      <div className="hud-score">
        <span className="hud-label">Score</span>
        <span className="hud-points">{points.toLocaleString()}</span>
      </div>
      <div className={`mult mult-${score.multiplier}`} key={score.multiplier}>
        <svg viewBox="0 0 44 44" aria-hidden>
          <circle cx="22" cy="22" r="19" className="mult-track" />
          <circle cx="22" cy="22" r="19" className="mult-fill" strokeDasharray={`${progress * 119.4} 119.4`} />
        </svg>
        <span>×{score.multiplier}</span>
      </div>
      <div className="hud-stat">
        <span className="hud-label">Combo</span>
        <b className={score.combo >= COMBO_STEP ? 'hot' : ''}>{score.combo}</b>
      </div>
      <div className="hud-stat hud-accuracy">
        <span className="hud-label">Accuracy</span>
        <b>{accuracy === null ? '—' : `${accuracy}%`}</b>
      </div>
      {crowd && <RockMeter value={score.rock} />}
    </div>
  )
}

/** Half-dial crowd meter: red on the left, green on the right. */
function RockMeter({ value }: { value: number }) {
  const angle = -90 + value * 180
  const mood = value < 0.3 ? 'cold' : value > 0.7 ? 'hot' : ''
  return (
    <div className={`rock ${mood}`} aria-label={`Crowd meter ${Math.round(value * 100)}%`}>
      <svg viewBox="0 0 64 38" aria-hidden>
        <path d="M6 34 A26 26 0 0 1 22.5 9.8" className="rock-red" />
        <path d="M22.5 9.8 A26 26 0 0 1 41.5 9.8" className="rock-yellow" />
        <path d="M41.5 9.8 A26 26 0 0 1 58 34" className="rock-green" />
        <line x1="32" y1="34" x2="32" y2="12" className="rock-needle" style={{ transform: `rotate(${angle}deg)` }} />
        <circle cx="32" cy="34" r="3.5" className="rock-hub" />
      </svg>
      <span className="hud-label">Crowd</span>
    </div>
  )
}

export function JudgmentPopup({ judgment }: { judgment: Judgment | null }) {
  if (!judgment) return null
  const partial = judgment.grade !== 'miss' && judgment.stringsHit < judgment.stringsExpected
  return (
    <div key={judgment.id} className={`judgment grade-${judgment.grade}`} aria-live="polite">
      <span className="judgment-grade">{GRADE_LABEL[judgment.grade]}</span>
      {judgment.grade !== 'miss' && (
        <span className="judgment-detail">
          +{judgment.points}
          {judgment.multiplier > 1 && <em> ×{judgment.multiplier}</em>}
          {judgment.timing && <i>{judgment.timing}</i>}
          {partial && (
            <i>
              {judgment.stringsHit}/{judgment.stringsExpected} strings
            </i>
          )}
        </span>
      )}
    </div>
  )
}

const GRADE_ORDER: Grade[] = ['perfect', 'great', 'good', 'ok', 'miss']

export function Results({
  score,
  best,
  isNewBest,
  note,
  onBackToPath,
  onReplay,
  onClose,
}: {
  score: ScoreState
  best: number
  isNewBest: boolean
  /** A lesson's verdict */
  note?: string
  onBackToPath?: () => void
  onReplay: () => void
  onClose: () => void
}) {
  const stars = starsFor(score)
  const accuracy = score.judged ? Math.round((score.qualitySum / score.judged) * 100) : 0
  const points = useCountUp(score.points)
  return (
    <div className="results-backdrop" role="dialog" aria-label="Results">
      <div className="results poster">
        <div className="poster-kicker">ChordHero · live tonight</div>
        <div className="stars" aria-label={`${stars} of 5 stars`}>
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={i < stars ? 'on' : ''} style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
              <i />
            </span>
          ))}
        </div>
        <div className="results-points">{points.toLocaleString()}</div>
        {isNewBest ? <div className="new-best">New best!</div> : <div className="best">Best: {best.toLocaleString()}</div>}
        <div className="results-grid">
          <div>
            <b>{accuracy}%</b>
            <span>accuracy</span>
          </div>
          <div>
            <b>{score.maxCombo}</b>
            <span>max combo</span>
          </div>
          <div>
            <b>{score.judged}</b>
            <span>chords</span>
          </div>
        </div>
        {note && <p className="results-note">{note}</p>}
        <ul className="grade-counts">
          {GRADE_ORDER.map((g) => (
            <li key={g} className={`grade-${g}`}>
              <span>{GRADE_LABEL[g].replace('!', '')}</span>
              <b>{score.counts[g]}</b>
            </li>
          ))}
        </ul>
        <div className="row results-actions">
          <button className="primary big" onClick={onReplay}>
            ↻ Play again
          </button>
          {onBackToPath ? (
            <button className="ghost" onClick={onBackToPath}>
              Back to path
            </button>
          ) : (
            <button className="ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
