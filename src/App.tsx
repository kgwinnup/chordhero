import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioEngine } from './audio/engine'
import { Neck } from './components/Neck'
import { JudgmentPopup, Results, ScoreHud } from './components/Hud'
import { MicGate } from './components/MicGate'
import { SettingsSheet } from './components/SettingsSheet'
import { PresetEditor } from './components/PresetEditor'
import { DetectorLab } from './components/DetectorLab'
import { TuneView } from './components/TuneView'
import { Learn } from './components/Learn'
import { InstallToast } from './components/InstallToast'
import { BUILT_IN_PRESETS, loadCustomPresets, type Preset, type PresetItem, saveCustomPresets, toSeq } from './game/presets'
import { newKey, type Settings, useGame } from './game/useGame'
import { starsFor } from './game/scoring'
import { emptyProgress, loadProgress, markDone, recordBest, saveProgress, type SongStep } from './learn/path'
import { CHORDS_BY_ID } from './music/chords'
import { keepAwake } from './wakeLock'

const DEFAULT_SETTINGS: Settings = {
  bpm: 70,
  waitMode: false,
  loop: true,
  metronome: true,
  countIn: true,
  sensitivity: 50,
  testMode: false,
  adaptiveTempo: false,
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

/** Whether the mic was on when the app was last used. */
const MIC_KEY = 'chordhero.mic'

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
  /** A song from the beginner path, played in place of the chosen preset. */
  const [lesson, setLesson] = useState<SongStep | null>(null)
  const [progress, setProgress] = useState(loadProgress)
  const seq = useMemo(() => toSeq(lesson ? lesson.chords.map((chordId) => ({ chordId, beats: 4 })) : preset.items), [preset, lesson])
  const [preview, setPreview] = useState<string | null>(null)
  /** 'checking' while we ask the browser whether mic access was already granted, so the popup doesn't flash. */
  const [mic, setMic] = useState<'checking' | 'off' | 'on' | 'error'>('checking')
  const [micError, setMicError] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')

  // Lesson songs play through once, so they can be graded.
  const gameSettings = useMemo(() => (lesson ? { ...settings, loop: false } : settings), [settings, lesson])
  const [tempoNote, setTempoNote] = useState<{ bpm: number; up: boolean } | null>(null)
  const onTempo = useCallback((bpm: number, from: number) => {
    setSettings((s) => ({ ...s, bpm }))
    setTempoNote({ bpm, up: bpm > from })
  }, [])
  const { layout, view, phase, score, ui, start, stop } = useGame(engine, seq, gameSettings, preview, onTempo)
  const running = phase === 'countin' || phase === 'playing'
  const [results, setResults] = useState<{ best: number; isNewBest: boolean; note?: string } | null>(null)
  const prevPhase = useRef(phase)

  // Show results when a song finishes, or when it's stopped after playing something.
  const showResults = () => {
    if (!score.judged) return
    const key = `${seq.map((it) => `${it.chordId}:${it.beats}`).join(',')}@${settings.bpm}${settings.waitMode ? 'w' : ''}`
    const bests = load<Record<string, number>>('chordlight.best', {})
    const prev = bests[key] ?? 0
    if (score.points > prev) save('chordlight.best', { ...bests, [key]: score.points })
    let note: string | undefined
    if (lesson) {
      const passed = phase === 'done' && starsFor(score) >= lesson.stars
      if (passed) setProgress((p) => markDone(p, lesson.id))
      note = passed
        ? `Lesson passed! On to the next step.`
        : phase === 'done'
          ? `Earn ${lesson.stars}★ to pass. Try a slower tempo, or turn on “Wait for me” in settings.`
          : `Play it all the way through to pass the lesson.`
    }
    setResults({ best: Math.max(prev, score.points), isNewBest: score.points > prev && score.points > 0, note })
  }
  useEffect(() => {
    if (phase === 'done' && prevPhase.current !== 'done') showResults()
    prevPhase.current = phase
  })

  useEffect(() => save('chordlight.settings', settings), [settings])
  useEffect(() => save('chordlight.prefs', { defaultBeats, preset: presetId }), [defaultBeats, presetId])
  useEffect(() => saveCustomPresets(customPresets), [customPresets])
  useEffect(() => saveProgress(progress), [progress])

  // Practice mode shows the chord you last heard or added in the editor; once the editor
  // closes or you pick another song, go back to that song's first chord.
  const closeEditor = () => {
    setEditing(null)
    setPreview(null)
  }
  const choosePreset = (id: string) => {
    setPresetId(id)
    setPreview(null)
  }

  const savePreset = (name: string, items: PresetItem[]) => {
    const current = editing?.preset
    if (current && !current.builtIn) {
      setCustomPresets((list) => list.map((p) => (p.id === current.id ? { ...p, name, items } : p)))
    } else {
      const id = `custom-${newKey()}`
      setCustomPresets((list) => [...list, { id, name, builtIn: false, items }])
      setPresetId(id)
    }
    closeEditor()
  }
  const deletePreset = (id: string) => {
    setCustomPresets((list) => list.filter((p) => p.id !== id))
    if (presetId === id) setPresetId(BUILT_IN_PRESETS[0].id)
    closeEditor()
  }

  // Mobile browsers only let audio start from a tap; resume on any tap in case the
  // engine was rebuilt (after the mic opened) outside one.
  useEffect(() => {
    const unlock = () => void engine.resume().catch(() => {})
    document.addEventListener('pointerdown', unlock)
    return () => document.removeEventListener('pointerdown', unlock)
  }, [engine])

  const set = <K extends keyof Settings>(k: K, value: Settings[K]) => setSettings((s) => ({ ...s, [k]: value }))

  const enableMic = async (id = deviceId) => {
    try {
      await engine.enableMic(id || undefined)
      save(MIC_KEY, { on: true })
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

  const gateOpen = !settings.testMode && (mic === 'off' || mic === 'error')

  // If mic access was granted before, connect straight away: no popup, no tap. Home-screen apps
  // on iPhone forget the grant every launch, so if the mic was on last time, ask for it directly:
  // the system's Allow prompt is then the only thing to tap, not our popup and then that.
  useEffect(() => {
    if (load<{ on: boolean }>(MIC_KEY, { on: false }).on) {
      void enableMic()
      return
    }
    let settled = false
    const done = (granted: boolean) => {
      if (settled) return
      settled = true
      if (granted) void enableMic()
      else setMic((m) => (m === 'checking' ? 'off' : m))
    }
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((p) => done(p.state === 'granted'))
      .catch(() => done(false))
    // Some browsers have no permissions query (or never answer it): ask the player.
    const timer = setTimeout(() => done(false), 1000)
    if (!navigator.permissions) done(false)
    return () => clearTimeout(timer)
    // Runs once on launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [labOpen, setLabOpen] = useState(false)
  const [screen, setScreen] = useState<'play' | 'tune' | 'learn'>('play')
  // Your hands are on the guitar, not the phone: keep the screen on while playing, tuning or learning.
  useEffect(() => keepAwake(running || screen !== 'play'), [running, screen])
  const goTo = (to: 'play' | 'tune' | 'learn') => {
    if (screen === to) return
    stop()
    setResults(null)
    setPreview(null)
    setLesson(null)
    setScreen(to)
  }
  const playSong = (step: SongStep) => {
    setPreview(null)
    setLesson(step)
    set('bpm', step.bpm)
    setScreen('play')
  }
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
        {screen === 'play' && lesson && (
          <div className="lesson-banner">
            <span className="lesson-banner-kicker">Lesson</span>
            <b>{lesson.name}</b>
            <span className="lesson-banner-goal">earn {lesson.stars}★</span>
            <button className="icon ghost" aria-label="Back to the beginner path" title="Back to the path" disabled={running} onClick={() => goTo('learn')}>
              ✕
            </button>
          </div>
        )}
        {screen === 'play' && !lesson && (
          <div className="preset-picker">
            <select
              aria-label="Song preset"
              value={preset.id}
              disabled={running}
              onChange={(e) => {
                if (e.target.value === '__new') setEditing({ preset: null })
                else choosePreset(e.target.value)
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
        )}
        <div className="row">
          {mic === 'on' ? (
            <button
              className="ghost mic-on"
              title="Turn the microphone off"
              onClick={() => {
                stop()
                engine.disableMic()
                save(MIC_KEY, { on: false })
                setMic('off')
              }}
            >
              <span className="live-dot" aria-hidden /> Mic
            </button>
          ) : (
            <button className="primary" onClick={() => enableMic()} disabled={running}>
              🎤 <span className="wide-only">{settings.testMode ? 'Use ' : 'Enable '}</span>mic
            </button>
          )}
          <nav className="screens" aria-label="Screens">
            {(['play', 'learn', 'tune'] as const).map((to) => (
              <button key={to} className={screen === to ? 'on' : ''} aria-current={screen === to ? 'page' : undefined} onClick={() => goTo(to)}>
                {to === 'play' ? 'Play' : to === 'learn' ? 'Learn' : 'Tune'}
              </button>
            ))}
          </nav>
          <button className="icon settings-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
        </div>
      </header>

      <InstallToast hidden={gateOpen || running || !!results || !!editing || settingsOpen || labOpen} />
      {gateOpen && <MicGate error={micError} onEnable={() => enableMic()} onDemo={() => toggleTestMode(true)} />}
      {settingsOpen && (
        <SettingsSheet
          settings={settings}
          set={set}
          running={running}
          onDemo={(on) => {
            toggleTestMode(on)
            if (!on) setSettingsOpen(false) // the mic popup takes over
          }}
          devices={mic === 'on' && !running ? devices : []}
          deviceId={deviceId}
          onDevice={changeDevice}
          onClose={() => setSettingsOpen(false)}
          engine={engine}
          micOn={mic === 'on'}
          onOpenLab={() => {
            setSettingsOpen(false)
            setPreview(preview ?? seq[0]?.chordId ?? 'G')
            setLabOpen(true)
          }}
        />
      )}
      {labOpen && (
        <DetectorLab
          engine={engine}
          currentStrings={ui.strings}
          chordId={ui.target?.id ?? preview ?? 'G'}
          onChord={setPreview}
          micOn={mic === 'on'}
          onClose={() => {
            setLabOpen(false)
            setPreview(null)
          }}
        />
      )}

      {screen === 'tune' ? (
        <TuneView engine={engine} micOn={mic === 'on'} onEnableMic={() => enableMic()} onBack={() => goTo('play')} />
      ) : screen === 'learn' ? (
        <Learn
          engine={engine}
          view={view}
          progress={progress}
          onDone={(id) => setProgress((p) => markDone(p, id))}
          onBest={(id, count) => setProgress((p) => recordBest(p, id, count))}
          onReset={() => setProgress(emptyProgress())}
          onChord={setPreview}
          onPlaySong={playSong}
          demo={settings.testMode}
          sensitivity={settings.sensitivity}
        />
      ) : (
        <>
          <ScoreHud score={score} />

          <section className={`stage heat-${score.multiplier}`}>
            <Neck layout={layout} view={view} loop={settings.loop} />
            {ui.countdown !== null && (
              <div className="countdown" key={ui.countdown}>
                {ui.countdown}
              </div>
            )}
            {running && <JudgmentPopup judgment={score.last} />}
            {running && settings.adaptiveTempo && tempoNote && (
              <div className={`tempo-note ${tempoNote.up ? 'up' : 'down'}`} key={`${tempoNote.bpm}-${tempoNote.up}`}>
                {tempoNote.up ? '▲ Faster' : '▼ Slower'} · {tempoNote.bpm} BPM
              </div>
            )}
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
        </>
      )}



      {results && (
        <Results
          score={score}
          best={results.best}
          isNewBest={results.isNewBest}
          note={results.note}
          onBackToPath={lesson ? () => goTo('learn') : undefined}
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
          onClose={closeEditor}
        />
      )}
    </div>
  )
}
