import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioEngine } from './audio/engine'
import { Neck } from './components/Neck'
import { JudgmentPopup, Results, ScoreHud } from './components/Hud'
import { MicGate } from './components/MicGate'
import { SettingsSheet } from './components/SettingsSheet'
import { PresetEditor } from './components/PresetEditor'
import { BUILT_IN_PRESETS, loadCustomPresets, type Preset, type PresetItem, saveCustomPresets, toSeq } from './game/presets'
import { newKey, type Settings, useGame } from './game/useGame'
import { CHORDS_BY_ID } from './music/chords'

const DEFAULT_SETTINGS: Settings = {
  bpm: 70,
  waitMode: false,
  loop: true,
  metronome: true,
  countIn: true,
  sensitivity: 50,
  testMode: false,
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
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
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = load('chordlight.settings', DEFAULT_SETTINGS)
    // Demo mode never survives a reload.
    return { ...saved, testMode: false }
  })
  const [prefs] = useState(() => load('chordlight.prefs', { defaultBeats: 4, preset: 'builtin-1' }))
  const [defaultBeats, setDefaultBeats] = useState(prefs.defaultBeats)
  const [customPresets, setCustomPresets] = useState<Preset[]>(loadCustomPresets)
  const [presetId, setPresetId] = useState(prefs.preset)
  /** The preset editor: open with the preset to edit, or null to build a new one. */
  const [editing, setEditing] = useState<{ preset: Preset | null } | null>(null)
  const allPresets = [...BUILT_IN_PRESETS, ...customPresets]
  const preset = allPresets.find((p) => p.id === presetId) ?? BUILT_IN_PRESETS[0]
  const seq = useMemo(() => toSeq(preset.items), [preset])
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
  useEffect(() => save('chordlight.prefs', { defaultBeats, preset: presetId }), [defaultBeats, presetId])
  useEffect(() => saveCustomPresets(customPresets), [customPresets])

  const savePreset = (name: string, items: PresetItem[]) => {
    const current = editing?.preset
    if (current && !current.builtIn) {
      setCustomPresets((list) => list.map((p) => (p.id === current.id ? { ...p, name, items } : p)))
    } else {
      const id = `custom-${newKey()}`
      setCustomPresets((list) => [...list, { id, name, builtIn: false, items }])
      setPresetId(id)
    }
    setEditing(null)
  }
  const deletePreset = (id: string) => {
    setCustomPresets((list) => list.filter((p) => p.id !== id))
    if (presetId === id) setPresetId(BUILT_IN_PRESETS[0].id)
    setEditing(null)
  }

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

  const gateOpen = !settings.testMode && !(mic === 'on' && micReady)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const changeDevice = (id: string) => {
    setDeviceId(id)
    enableMic(id)
  }

  return (
    <div className={`app ${running ? 'running' : ''}`}>
      <header className="topbar">
        <h1>
          <span className="logo" aria-hidden>
            ⚡
          </span>
          ChordHero
        </h1>
        <div className="preset-picker">
          <select
            aria-label="Song preset"
            value={preset.id}
            disabled={running}
            onChange={(e) => {
              if (e.target.value === '__new') setEditing({ preset: null })
              else setPresetId(e.target.value)
            }}
          >
            <optgroup label="Songs">
              {BUILT_IN_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            {customPresets.length > 0 && (
              <optgroup label="My presets">
                {customPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="__new">＋ Build your own…</option>
          </select>
          <button
            className="icon"
            aria-label={preset.builtIn ? 'Customize this preset' : 'Edit this preset'}
            title={preset.builtIn ? 'Customize' : 'Edit'}
            disabled={running}
            onClick={() => setEditing({ preset })}
          >
            ✎
          </button>
        </div>
        <div className="row">
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

      <section className={`stage heat-${score.multiplier}`}>
        <Neck layout={layout} view={view} loop={settings.loop} />
        {ui.countdown !== null && (
          <div className="countdown" key={ui.countdown}>
            {ui.countdown}
          </div>
        )}
        {running && <JudgmentPopup judgment={score.last} />}
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

      {editing && (
        <PresetEditor
          preset={editing.preset}
          defaultBeats={defaultBeats}
          onDefaultBeats={setDefaultBeats}
          onPreview={setPreview}
          onHear={hear}
          onSave={savePreset}
          onDelete={editing.preset && !editing.preset.builtIn ? () => deletePreset(editing.preset!.id) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
