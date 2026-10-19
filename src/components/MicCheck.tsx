import { useEffect, useState } from 'react'
import type { AudioEngine, MicInfo, Pitch } from '../audio/engine'

const kHz = (rate: number | null) => (rate ? `${(rate / 1000).toFixed(1)} kHz` : 'unknown')
const onOff = (v: boolean | string | null) => (v === null ? 'unknown' : v === false ? 'off' : 'on')

/**
 * A live tuner and what the browser actually gave us. Plucking the open low E should read
 * "E2 · 82 Hz"; if it reads a different note, the audio is running at the wrong rate.
 */
export function MicCheck({ engine }: { engine: AudioEngine }) {
  const [pitch, setPitch] = useState<Pitch | null>(null)
  const [info, setInfo] = useState<MicInfo>(() => engine.micInfo())

  useEffect(() => {
    const id = setInterval(() => {
      // Hold the last reading briefly so it doesn't vanish between plucks.
      const p = engine.pitch()
      if (p) setPitch(p)
      setInfo(engine.micInfo())
    }, 120)
    return () => clearInterval(id)
  }, [engine])

  const mismatch = info.micRate !== null && info.micRate !== info.contextRate
  const processing = [info.echoCancellation, info.autoGainControl, info.noiseSuppression].some((v) => v !== false && v !== null)

  return (
    <div className="mic-check">
      <div className="tuner" aria-live="polite">
        <span className="tuner-note">{pitch?.note ?? '—'}</span>
        <span className="tuner-hz">{pitch ? `${Math.round(pitch.freq)} Hz` : 'Pluck a string'}</span>
        <div className="tuner-scale" aria-hidden>
          <i style={{ left: `${50 + (pitch?.cents ?? 0)}%` }} className={pitch && Math.abs(pitch.cents) <= 8 ? 'in-tune' : ''} />
        </div>
      </div>
      <p className="sheet-hint">Pluck your open low E: it should read E2 · 82 Hz.</p>
      <dl className="mic-facts">
        <dt>Audio rate</dt>
        <dd className={mismatch ? 'warn' : ''}>
          {kHz(info.contextRate)} {info.micRate !== null && `(mic ${kHz(info.micRate)})`}
        </dd>
        <dt>Voice processing</dt>
        <dd className={processing ? 'warn' : ''}>
          echo {onOff(info.echoCancellation)} · gain {onOff(info.autoGainControl)} · noise {onOff(info.noiseSuppression)}
        </dd>
      </dl>
    </div>
  )
}
