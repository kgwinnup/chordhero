import { useState } from 'react'

interface Props {
  micOn: boolean
  error: string
  level: number
  onEnable: () => void
  onDemo: () => void
  onReady: () => void
  devices: MediaDeviceInfo[]
  deviceId: string
  onDevice: (id: string) => void
}

/** Level that counts as "heard a strum" during the check. */
const HEARD_LEVEL = 0.02

/** Blocks the game until the mic is on and has actually heard the guitar. */
export function MicGate({ micOn, error, level, onEnable, onDemo, onReady, devices, deviceId, onDevice }: Props) {
  // Latches once a strum is heard; resets if the mic goes off.
  const [heard, setHeard] = useState(false)
  if (micOn && !heard && level > HEARD_LEVEL) setHeard(true)
  if (!micOn && heard) setHeard(false)

  const pct = Math.min(100, Math.max(0, ((20 * Math.log10(level + 1e-6) + 60) / 60) * 100))

  return (
    <div className="results-backdrop" role="dialog" aria-modal="true" aria-label="Microphone setup">
      <div className="results gate">
        <div className={`gate-icon ${micOn ? (heard ? 'heard' : 'listening') : ''}`} aria-hidden>
          {heard ? '🎸' : '🎤'}
        </div>
        {!micOn ? (
          <>
            <h2>Let ChordLight hear you</h2>
            <p>
              ChordLight listens to your guitar to light up the strings and score each chord. Allow microphone access to
              play.
            </p>
            {error && <p className="gate-error">{error}</p>}
            <button className="primary big gate-cta" onClick={onEnable}>
              Enable microphone
            </button>
            <p className="gate-fine">Audio is processed on your device. Nothing is recorded or uploaded.</p>
          </>
        ) : (
          <>
            <h2>{heard ? 'We hear you!' : 'Strum any chord'}</h2>
            <p>{heard ? 'Your guitar is coming through loud and clear.' : 'Give your guitar a strum so we can check the mic picks it up.'}</p>
            {devices.length > 1 && (
              <select aria-label="Input device" value={deviceId} onChange={(e) => onDevice(e.target.value)}>
                <option value="">Default microphone</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Microphone'}
                  </option>
                ))}
              </select>
            )}
            <div className="gate-meter" aria-label="Input level">
              <div style={{ width: `${pct}%` }} className={heard ? 'heard' : ''} />
            </div>
            <button className="primary big gate-cta" disabled={!heard} onClick={onReady}>
              {heard ? "Let's play ▶" : 'Listening…'}
            </button>
            {!heard && <p className="gate-fine">Nothing showing? Move closer to the mic, turn up its input volume, or pick a different input above.</p>}
          </>
        )}
        <button className="link" onClick={onDemo}>
          No guitar handy? Watch a demo
        </button>
      </div>
    </div>
  )
}
