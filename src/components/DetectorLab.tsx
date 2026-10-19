import { useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '../audio/engine'
import { heardNotes, loadModel, NOTE_ON, type NoteReading, NoteListener, stringsFromNotes } from '../audio/notes'
import { CHORDS, CHORDS_BY_ID, MAX_STRINGS, NOTE_NAMES, STRING_NAMES } from '../music/chords'

interface Props {
  engine: AudioEngine
  /** The current detector's live result for `chordId` */
  currentStrings: boolean[]
  chordId: string
  onChord: (id: string) => void
  micOn: boolean
  onClose: () => void
}

const noteName = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`

/**
 * Side-by-side comparison of the built-in string detector and the Basic Pitch neural network,
 * on the same audio, so you can see which tracks your guitar better.
 */
export function DetectorLab({ engine, currentStrings, chordId, onChord, micOn, onClose }: Props) {
  const chord = CHORDS_BY_ID[chordId]
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [reading, setReading] = useState<NoteReading | null>(null)
  const [avgMs, setAvgMs] = useState<number | null>(null)
  const [noteOn, setNoteOn] = useState(NOTE_ON)
  const listenerRef = useRef<NoteListener | null>(null)

  useEffect(() => {
    let alive = true
    const timings: number[] = []
    loadModel()
      .then(async () => {
        if (!alive) return
        setStatus('ready')
        while (alive) {
          // The engine rebuilds its audio context when the mic turns on; follow it.
          if (listenerRef.current?.context !== engine.ctx) {
            listenerRef.current?.dispose()
            listenerRef.current = new NoteListener(engine.ctx, engine.listenInput)
          }
          const r = await listenerRef.current.read()
          if (!alive) break
          timings.push(r.ms)
          if (timings.length > 10) timings.shift()
          setReading(r)
          setAvgMs(timings.reduce((a, b) => a + b, 0) / timings.length)
          await new Promise((res) => setTimeout(res, 60))
        }
      })
      .catch((err) => {
        if (!alive) return
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
      listenerRef.current?.dispose()
      listenerRef.current = null
    }
  }, [engine])

  const mlStrings = reading ? stringsFromNotes(chord, reading.activation, noteOn) : Array(MAX_STRINGS).fill(false)
  const notes = reading ? heardNotes(reading.activation, noteOn).slice(0, 8) : []
  const test = async (only?: number) => {
    await engine.resume()
    const skip = only === undefined ? [] : [0, 1, 2, 3, 4, 5].filter((s) => s !== only)
    engine.strum(chord, engine.ctx.currentTime, true, skip)
  }

  return (
    <div className="results-backdrop sheet-backdrop" role="dialog" aria-modal="true" aria-label="Detector lab" onClick={onClose}>
      <div className="sheet lab" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Detector lab</h2>
          <button className="icon ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="sheet-hint">
          Strum or pluck the chord and compare which strings each detector lights. {micOn ? '' : 'Turn the mic on to use your guitar, or use the test buttons.'}
        </p>

        <div className="lab-controls">
          <select aria-label="Chord" value={chordId} onChange={(e) => onChord(e.target.value)}>
            {CHORDS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button onClick={() => test()}>Test strum</button>
        </div>

        <table className="lab-table">
          <thead>
            <tr>
              <th />
              {STRING_NAMES.map((n, s) => (
                <th key={s}>
                  {chord.frets[s] < 0 ? (
                    <span className="lab-muted">{n}</span>
                  ) : (
                    <button className="lab-pluck" title={`Test pluck: ${n} string`} onClick={() => test(s)}>
                      {n}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Current</th>
              {currentStrings.map((on, s) => (
                <td key={s}>
                  <i className={`lab-light ${chord.frets[s] < 0 ? 'off' : on ? 'on' : ''}`} />
                </td>
              ))}
            </tr>
            <tr>
              <th>Basic Pitch</th>
              {mlStrings.map((on, s) => (
                <td key={s}>
                  <i className={`lab-light ml ${chord.frets[s] < 0 ? 'off' : on ? 'on' : ''}`} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <label className="sensitivity">
          <span>Model: strict</span>
          <input type="range" min={0.1} max={0.5} step={0.05} value={0.6 - noteOn} onChange={(e) => setNoteOn(Math.round((0.6 - Number(e.target.value)) * 100) / 100)} aria-label="Model sensitivity" />
          <span>lenient</span>
        </label>

        <div className="lab-notes">
          <span className="sheet-label">Notes the model hears</span>
          <div className="chips">
            {status === 'loading' && <span className="sheet-hint">Loading model…</span>}
            {status === 'error' && <span className="editor-error">Couldn't load the model: {error}</span>}
            {status === 'ready' && notes.length === 0 && <span className="sheet-hint">—</span>}
            {notes.map((n) => (
              <span key={n.midi} className="lab-note" style={{ opacity: 0.4 + 0.6 * n.activation }}>
                {noteName(n.midi)}
              </span>
            ))}
          </div>
        </div>
        <p className="sheet-hint">{avgMs !== null && `Model time per reading: ${Math.round(avgMs)} ms (aim: under ~150 ms)`}</p>
      </div>
    </div>
  )
}
