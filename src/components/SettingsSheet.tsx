import type { AudioEngine } from '../audio/engine'
import type { Settings } from '../game/useGame'
import { MicCheck } from './MicCheck'

interface Props {
  settings: Settings
  set: <K extends keyof Settings>(k: K, value: Settings[K]) => void
  running: boolean
  onDemo: (on: boolean) => void
  devices: MediaDeviceInfo[]
  deviceId: string
  onDevice: (id: string) => void
  onClose: () => void
  engine: AudioEngine
  micOn: boolean
  onOpenLab: () => void
}

export function SettingsSheet({ settings, set, running, onDemo, devices, deviceId, onDevice, onClose, engine, micOn, onOpenLab }: Props) {
  return (
    <div className="results-backdrop sheet-backdrop" role="dialog" aria-modal="true" aria-label="Settings" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Settings</h2>
          <button className="icon ghost" aria-label="Close settings" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="sheet-group">
          <span className="sheet-label">Gameplay</span>
          <Toggle label="Wait for me" hint="Pause on each chord until you play it" checked={settings.waitMode} onChange={(v) => set('waitMode', v)} />
          <Toggle
            label="Adaptive tempo"
            hint="Speeds up a little after clean chords, slows down after misses"
            checked={settings.adaptiveTempo}
            onChange={(v) => set('adaptiveTempo', v)}
          />
          <Toggle label="Loop" hint="Repeat the sequence" checked={settings.loop} onChange={(v) => set('loop', v)} disabled={running} />
          <Toggle label="Metronome" checked={settings.metronome} onChange={(v) => set('metronome', v)} />
          <Toggle label="Count-in" hint="One bar of clicks before the first chord" checked={settings.countIn} onChange={(v) => set('countIn', v)} />
        </div>

        <div className="sheet-group">
          <span className="sheet-label">Listening</span>
          <label className="sensitivity">
            <span>Strict</span>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.sensitivity}
              onChange={(e) => set('sensitivity', Number(e.target.value))}
              aria-label="Detection sensitivity"
            />
            <span>Lenient</span>
          </label>
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
          {micOn && <MicCheck engine={engine} />}
          <Toggle label="Demo mode" hint="No guitar: the app strums for you" checked={settings.testMode} onChange={onDemo} disabled={running} />
        </div>

        <div className="sheet-group">
          <span className="sheet-label">Experimental</span>
          <button onClick={onOpenLab} disabled={running}>
            Detector lab
          </button>
          <p className="sheet-hint">Compare string detection with a neural network (downloads ~2 MB).</p>
        </div>

        <button className="primary big sheet-done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle">
      <span className="toggle-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden />
    </label>
  )
}
