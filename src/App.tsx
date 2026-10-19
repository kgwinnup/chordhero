import { useEffect, useState } from 'react'
import { AudioEngine } from './audio/engine'
import { Fretboard } from './components/Fretboard'
import { Highway } from './components/Highway'
import { SequenceBuilder } from './components/SequenceBuilder'
import { newKey, type SeqItem, type Settings, useGame } from './game/useGame'
import { CHORDS_BY_ID } from './music/chords'

const DEFAULT_SETTINGS: Settings = {
  bpm: 70,
  waitMode: true,
  loop: true,
  metronome: true,
  countIn: true,
  sensitivity: 50,
  testMode: false,
}

const DEFAULT_SEQ: SeqItem[] = ['G', 'C', 'D', 'G'].map((chordId) => ({ key: newKey(), chordId, beats: 4 }))

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function loadSeq(): SeqItem[] {
  try {
    const raw = localStorage.getItem('chordlight.seq')
    const parsed = raw ? (JSON.parse(raw) as SeqItem[]) : null
    return Array.isArray(parsed) ? parsed.filter((it) => CHORDS_BY_ID[it.chordId]) : DEFAULT_SEQ
  } catch {
    return DEFAULT_SEQ
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

export default function App() {
  const [engine] = useState(() => new AudioEngine())
  const [settings, setSettings] = useState<Settings>(() => load('chordlight.settings', DEFAULT_SETTINGS))
  const [seq, setSeq] = useState<SeqItem[]>(loadSeq)
  const [defaultBeats, setDefaultBeats] = useState(() => load('chordlight.prefs', { defaultBeats: 4 }).defaultBeats)
  const [preview, setPreview] = useState<string | null>(null)
  const [mic, setMic] = useState<'off' | 'on' | 'error'>('off')
  const [micError, setMicError] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')

  const { layout, view, phase, score, ui, start, stop } = useGame(engine, seq, settings, preview)
  const running = phase === 'countin' || phase === 'playing'

  useEffect(() => save('chordlight.settings', settings), [settings])
  useEffect(() => save('chordlight.seq', seq), [seq])
  useEffect(() => save('chordlight.prefs', { defaultBeats }), [defaultBeats])

  const set = <K extends keyof Settings>(k: K, value: Settings[K]) => setSettings((s) => ({ ...s, [k]: value }))

  const enableMic = async (id = deviceId) => {
    try {
      await engine.enableMic(id || undefined)
      setMic('on')
      setMicError('')
      set('testMode', false)
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((d) => d.kind === 'audioinput'))
    } catch (err) {
      setMic('error')
      setMicError(
        !window.isSecureContext
          ? 'Microphone needs HTTPS (or localhost).'
          : err instanceof Error && err.name === 'NotAllowedError'
            ? 'Microphone permission was denied. Allow it in your browser settings and try again.'
            : `Couldn't open the microphone (${err instanceof Error ? err.message : String(err)}).`,
      )
    }
  }

  const toggleTestMode = (on: boolean) => {
    set('testMode', on)
    if (on) {
      engine.disableMic()
      setMic('off')
    }
  }

  const hear = async (chordId: string) => {
    await engine.resume()
    setPreview(chordId)
    engine.strum(CHORDS_BY_ID[chordId], engine.ctx.currentTime, settings.testMode)
  }

  const total = score.hits + score.misses
  const listening = mic === 'on' || settings.testMode

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <span className="logo" aria-hidden>
            ◉
          </span>{' '}
          ChordLight
        </h1>
        <div className="row">
          <Meter level={ui.level} active={listening} />
          {mic === 'on' ? (
            <>
              {devices.length > 1 && (
                <select
                  aria-label="Input device"
                  value={deviceId}
                  onChange={(e) => {
                    setDeviceId(e.target.value)
                    enableMic(e.target.value)
                  }}
                >
                  <option value="">Default mic</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || 'Microphone'}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="ghost"
                onClick={() => {
                  engine.disableMic()
                  setMic('off')
                }}
              >
                Mic on
              </button>
            </>
          ) : (
            <button className="primary" onClick={() => enableMic()}>
              🎤 Enable mic
            </button>
          )}
        </div>
      </header>

      {micError && <p className="notice error">{micError}</p>}
      {!listening && !micError && (
        <p className="notice">Enable your mic so the app can hear your guitar, or turn on Test mode to try it without one.</p>
      )}

      <section className="stage">
        <Highway layout={layout} view={view} loop={settings.loop} />
        {ui.countdown !== null && <div className="countdown">{ui.countdown}</div>}
        {phase === 'done' && (
          <div className="countdown result">
            {score.hits}/{total}
          </div>
        )}
      </section>

      <section className="now">
        <div className="now-chord">
          <span className="label">{running ? 'Play' : 'Practice'}</span>
          <span className="name">{ui.target?.name ?? '—'}</span>
          {ui.next && running && <span className="next">next: {ui.next.name}</span>}
        </div>
        <div className="now-stats">
          <MatchBar value={ui.match} />
          <div className="score">
            <span>
              <b>{score.hits}</b> hit
            </span>
            <span>
              <b>{score.misses}</b> missed
            </span>
            <span>
              <b>{score.streak}</b> streak
            </span>
          </div>
        </div>
      </section>

      <section className="panel board">
        <Fretboard chord={ui.target} ringing={ui.strings} />
      </section>

      <section className="panel transport">
        <button className={`play ${running ? 'stop' : ''}`} disabled={!layout.items.length} onClick={() => (running ? stop() : start())}>
          {running ? '■ Stop' : '▶ Play'}
        </button>

        <div className="tempo">
          <button className="icon" aria-label="Slower" onClick={() => set('bpm', Math.max(30, settings.bpm - 5))}>
            −
          </button>
          <label>
            <span className="bpm">
              <b>{settings.bpm}</b> BPM
            </span>
            <input
              type="range"
              min={30}
              max={200}
              value={settings.bpm}
              onChange={(e) => set('bpm', Number(e.target.value))}
              aria-label="Tempo"
            />
          </label>
          <button className="icon" aria-label="Faster" onClick={() => set('bpm', Math.min(200, settings.bpm + 5))}>
            +
          </button>
        </div>

        <div className="toggles">
          <Toggle label="Wait for me" hint="Pauses on each chord until you play it" checked={settings.waitMode} onChange={(v) => set('waitMode', v)} />
          <Toggle label="Loop" checked={settings.loop} onChange={(v) => set('loop', v)} disabled={running} />
          <Toggle label="Metronome" checked={settings.metronome} onChange={(v) => set('metronome', v)} />
          <Toggle label="Count-in" checked={settings.countIn} onChange={(v) => set('countIn', v)} />
          <Toggle label="Test mode" hint="No mic: the app strums for you" checked={settings.testMode} onChange={toggleTestMode} />
        </div>

        <label className="sensitivity">
          <span>Detection: strict</span>
          <input type="range" min={0} max={100} value={settings.sensitivity} onChange={(e) => set('sensitivity', Number(e.target.value))} />
          <span>lenient</span>
        </label>
      </section>

      <SequenceBuilder
        seq={seq}
        onChange={setSeq}
        defaultBeats={defaultBeats}
        onDefaultBeats={setDefaultBeats}
        onPreview={setPreview}
        onHear={hear}
        disabled={running}
      />
    </div>
  )
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden />
      {label}
    </label>
  )
}

function Meter({ level, active }: { level: number; active: boolean }) {
  const pct = active ? Math.min(100, Math.max(0, ((20 * Math.log10(level + 1e-6) + 60) / 60) * 100)) : 0
  return (
    <div className="meter" title="Input level" aria-label="Input level">
      <div style={{ width: `${pct}%` }} />
    </div>
  )
}

function MatchBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <div className="match">
      <span>Chord match</span>
      <div className="bar">
        <div style={{ width: `${pct}%` }} className={pct >= 70 ? 'good' : ''} />
      </div>
      <span className="pct">{pct}%</span>
    </div>
  )
}
