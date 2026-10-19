interface Props {
  error: string
  onEnable: () => void
  onDemo: () => void
}

/** Shown until the mic is on: ChordHero has to hear the guitar to play. */
export function MicGate({ error, onEnable, onDemo }: Props) {
  return (
    <div className="results-backdrop" role="dialog" aria-modal="true" aria-label="Microphone setup">
      <div className="results gate">
        <div className="gate-icon" aria-hidden>
          🎤
        </div>
        <h2>Let ChordHero hear you</h2>
        <p>ChordHero listens to your guitar to light up the strings and score each chord. Allow microphone access to play.</p>
        {error && <p className="gate-error">{error}</p>}
        <button className="primary big gate-cta" onClick={onEnable}>
          Enable microphone
        </button>
        <p className="gate-fine">Audio is processed on your device. Nothing is recorded or uploaded.</p>
        <button className="link" onClick={onDemo}>
          No guitar handy? Watch a demo
        </button>
      </div>
    </div>
  )
}
