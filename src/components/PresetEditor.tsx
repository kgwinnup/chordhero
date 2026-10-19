import { useState } from 'react'
import { type ChordGroup, CHORDS, CHORDS_BY_ID } from '../music/chords'
import { newKey, type SeqItem } from '../game/useGame'
import { type Preset, type PresetItem, toItems, toSeq } from '../game/presets'

interface Props {
  /** The preset being edited; built-ins are saved as a new custom copy. Null = start from scratch. */
  preset: Preset | null
  defaultBeats: number
  onDefaultBeats: (beats: number) => void
  onPreview: (chordId: string) => void
  onHear: (chordId: string) => void
  onSave: (name: string, items: PresetItem[]) => void
  onDelete?: () => void
  onClose: () => void
}

const GROUPS: ChordGroup[] = ['Major', 'Minor', '7th', 'Other']
const BEAT_OPTIONS = [1, 2, 3, 4, 6, 8]

/** Modal for building a chord sequence and saving it as a custom preset. */
export function PresetEditor({ preset, defaultBeats, onDefaultBeats, onPreview, onHear, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(() => (!preset ? '' : preset.builtIn ? `${preset.name} (mine)` : preset.name))
  const [seq, setSeq] = useState<SeqItem[]>(() => (preset ? toSeq(preset.items) : []))
  const [error, setError] = useState('')

  const update = (i: number, patch: Partial<SeqItem>) => setSeq(seq.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= seq.length) return
    const copy = [...seq]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    setSeq(copy)
  }
  const save = () => {
    if (!name.trim()) return setError('Give your preset a name.')
    if (!seq.length) return setError('Add at least one chord.')
    onSave(name.trim(), toItems(seq))
  }

  return (
    <div className="results-backdrop sheet-backdrop" role="dialog" aria-modal="true" aria-label="Build a preset" onClick={onClose}>
      <div className="sheet editor" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{!preset ? 'Build your own' : preset.builtIn ? 'Customize preset' : 'Edit preset'}</h2>
          <button className="icon ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <label className="editor-name">
          <span className="sheet-label">Name</span>
          <input
            type="text"
            value={name}
            placeholder="Campfire song"
            maxLength={40}
            onChange={(e) => {
              setName(e.target.value)
              setError('')
            }}
          />
        </label>

        <span className="sheet-label">Chords in order</span>
        <ol className="sequence">
          {seq.length === 0 && <li className="empty">Tap chords below to add them in order.</li>}
          {seq.map((it, i) => (
            <li key={it.key} className="seq-item">
              <button className="seq-name" onClick={() => onPreview(it.chordId)} title="Show on the fretboard">
                {CHORDS_BY_ID[it.chordId]?.name ?? it.chordId}
              </button>
              <select aria-label="Beats" value={it.beats} onChange={(e) => update(i, { beats: Number(e.target.value) })}>
                {BEAT_OPTIONS.map((b) => (
                  <option key={b} value={b}>
                    {b} beat{b > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
              <div className="seq-actions">
                <button className="icon" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                  ‹
                </button>
                <button className="icon" aria-label="Move later" disabled={i === seq.length - 1} onClick={() => move(i, 1)}>
                  ›
                </button>
                <button className="icon" aria-label="Remove" onClick={() => setSeq(seq.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>

        <div className="palette-head">
          <span className="sheet-label">Add chord</span>
          <label className="inline">
            length
            <select value={defaultBeats} onChange={(e) => onDefaultBeats(Number(e.target.value))}>
              {BEAT_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b} beat{b > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        {GROUPS.map((g) => (
          <div key={g} className="palette-group">
            <span className="group-label">{g}</span>
            <div className="chips">
              {CHORDS.filter((ch) => ch.group === g).map((ch) => (
                <span key={ch.id} className="chip">
                  <button
                    className="chip-add"
                    onClick={() => {
                      setSeq([...seq, { key: newKey(), chordId: ch.id, beats: defaultBeats }])
                      setError('')
                      onPreview(ch.id)
                    }}
                  >
                    {ch.name}
                  </button>
                  <button className="chip-hear" aria-label={`Hear ${ch.name}`} onClick={() => onHear(ch.id)}>
                    ♪
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}

        {error && <p className="editor-error">{error}</p>}
        <div className="editor-actions">
          {onDelete && (
            <button className="ghost danger" onClick={onDelete}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={save}>
            {preset?.builtIn ? 'Save as mine' : 'Save preset'}
          </button>
        </div>
      </div>
    </div>
  )
}
