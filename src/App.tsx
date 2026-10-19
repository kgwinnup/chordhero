import { useEffect, useRef, useState } from 'react'
import { AudioEngine } from './audio/engine'
import { Fretboard } from './components/Fretboard'
import { Highway } from './components/Highway'
import { JudgmentPopup, Results, ScoreHud } from './components/Hud'
import { MicGate } from './components/MicGate'
import { SettingsSheet } from './components/SettingsSheet'
import { useMediaQuery } from './hooks/useMediaQuery'
import { SequenceBuilder } from './components/SequenceBuilder'
import { newKey, type SeqItem, type Settings, useGame } from './game/useGame'
import { CHORDS_BY_ID } from './music/chords'

const DEFAULT_SETTINGS: Settings = {
  bpm: 70,
  waitMode: false,
  loop: true,
  metronome: true,
  countIn: true,
  sensitivity: 50,
  testMode: false,
  highway: 'auto',
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
  const [settings, setSettings] = useState<Settings>(() => ({ ...load('chordlight.settings', DEFAULT_SETTINGS), testMode: false }))
  const [seq, setSeq] = useState<SeqItem[]>(loadSeq)
  const [defaultBeats, setDefaultBeats] = useState(() => load('chordlight.prefs', { defaultBeats: 4 }).defaultBeats)
  const [preview, setPreview] = useState<string | null>(null)
  const [mic, setMic] = useState<'off' | 'on' | 'error'>('off')
  const [micError, setMicError] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  /** The mic has heard the guitar during the setup check. */
  const [micReady, setMicReady] = useState(false)

  const { layout, view, phase, score, ui, start, stop } = useGame(engine, seq, settings, preview)
  const running = phase === 'countin' || phase === 'playing'
  const [results, setResults] = useState<{ best: number; isNewBest: boolean } | null>(null)
  const prevPhase = useRef(phase)

  // Show results when a song finishes, or when it's stopped after playing something.
  const showResults = () => {
    if (!score.judged) return
    const key = `${seq.map((it) => `${it.chordId}:${it.beats}`).join(',')}@${settings.bpm}${settings.waitMode ? 'w' : ''}`
    const bests = load<Record<string, number>>('chordlight.best', {})
    const prev = bests[key] ?? 0
    if (score.points > prev) save('chordlight.best', { ...bests, [key]: score.points })
    setResults({ best: Math.max(prev, score.points), isNewBest: score.points > prev && score.points > 0 })
  }
  useEffect(() => {
    if (phase === 'done' && prevPhase.current !== 'done') showResults()
    prevPhase.current = phase
  })

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

  const listening = mic === 'on' || settings.testMode
  const gateOpen = !settings.testMode && !(mic === 'on' && micReady)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const portraitPhone = useMediaQuery('(orientation: portrait) and (max-width: 640px)')
  const vertical = settings.highway === 'vertical' || (settings.highway === 'auto' && portraitPhone)
  const changeDevice = (id: string) => {
    setDeviceId(id)
    enableMic(id)
  }

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
            <button
              className="ghost mic-on"
              title="Turn the microphone off"
              onClick={() => {
                stop()
                engine.disableMic()
                setMic('off')
                setMicReady(false)
              }}
            >
              <span className="live-dot" aria-hidden /> Mic
            </button>
          ) : (
            <button className="primary" onClick={() => enableMic()} disabled={running}>
              🎤 {settings.testMode ? 'Use mic' : 'Enable mic'}
            </button>
          )}
          <button className="icon settings-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
        </div>
      </header>

      {gateOpen && (
        <MicGate
          micOn={mic === 'on'}
          error={micError}
          level={ui.level}
          onEnable={() => enableMic()}
          onDemo={() => toggleTestMode(true)}
          onReady={() => setMicReady(true)}
          devices={devices}
          deviceId={deviceId}
          onDevice={changeDevice}
        />
      )}
      {settingsOpen && (
        <SettingsSheet
          settings={settings}
          set={set}
          running={running}
          onDemo={(on) => {
            toggleTestMode(on)
            if (!on) setSettingsOpen(false) // the mic popup takes over
          }}
          devices={mic === 'on' ? devices : []}
          deviceId={deviceId}
          onDevice={changeDevice}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <ScoreHud score={score} />

      <section className={`stage ${vertical ? 'vertical' : ''} ${score.multiplier >= 4 ? 'on-fire' : ''}`}>
        <Highway layout={layout} view={view} loop={settings.loop} vertical={vertical} />
        {ui.countdown !== null && (
          <div className="countdown" key={ui.countdown}>
            {ui.countdown}
          </div>
        )}
        {running && <JudgmentPopup judgment={score.last} />}
      </section>

      <section className="now">
        <div className="now-chord">
          <span className="label">{running ? 'Play' : 'Practice'}</span>
          <span className="name">{ui.target?.name ?? '—'}</span>
          {ui.next && running && <span className="next">next: {ui.next.name}</span>}
        </div>
        <div className="now-stats">
          <MatchBar value={ui.match} />
        </div>
      </section>

      <section className="panel transport">
        <button className={`play ${running ? 'stop' : ''}`} disabled={!layout.items.length} onClick={() => {
            if (running) {
              stop()
              showResults()
            } else {
              setResults(null)
              start()
            }
          }}>
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

      </section>

      <section className="panel board">
        <Fretboard chord={ui.target} ringing={ui.strings} />
      </section>


      {results && (
        <Results
          score={score}
          best={results.best}
          isNewBest={results.isNewBest}
          onReplay={() => {
            setResults(null)
            start()
          }}
          onClose={() => setResults(null)}
        />
      )}

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
