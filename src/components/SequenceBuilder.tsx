import { type ChordGroup, CHORDS, CHORDS_BY_ID, PRESETS } from '../music/chords'
import { newKey, type SeqItem } from '../game/useGame'

interface Props {
  seq: SeqItem[]
  onChange: (seq: SeqItem[]) => void
  defaultBeats: number
  onDefaultBeats: (beats: number) => void
  onPreview: (chordId: string) => void
  onHear: (chordId: string) => void
  disabled: boolean
}

const GROUPS: ChordGroup[] = ['Major', 'Minor', '7th', 'Other']
const BEAT_OPTIONS = [1, 2, 3, 4, 6, 8]

export function SequenceBuilder({ seq, onChange, defaultBeats, onDefaultBeats, onPreview, onHear, disabled }: Props) {
  const update = (i: number, patch: Partial<SeqItem>) => onChange(seq.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= seq.length) return
    const copy = [...seq]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    onChange(copy)
  }

  return (
    <section className="panel builder">
      <div className="panel-head">
        <h2>Your chords</h2>
        <div className="row">
          <select
            aria-label="Load a preset"
            value=""
            disabled={disabled}
            onChange={(e) => {
              const p = PRESETS.find((p) => p.name === e.target.value)
              if (p) onChange(p.chords.map((chordId) => ({ key: newKey(), chordId, beats: defaultBeats })))
            }}
          >
            <option value="">Presets…</option>
            {PRESETS.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </select>
          <button className="ghost" disabled={disabled || !seq.length} onClick={() => onChange([])}>
            Clear
          </button>
        </div>
      </div>

      <ol className="sequence">
        {seq.length === 0 && <li className="empty">Tap chords below to add them in order.</li>}
        {seq.map((it, i) => (
          <li key={it.key} className="seq-item">
            <button className="seq-name" onClick={() => onPreview(it.chordId)} title="Show on fretboard">
              {CHORDS_BY_ID[it.chordId]?.name ?? it.chordId}
            </button>
            <select
              aria-label="Beats"
              value={it.beats}
              disabled={disabled}
              onChange={(e) => update(i, { beats: Number(e.target.value) })}
            >
              {BEAT_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b} beat{b > 1 ? 's' : ''}
                </option>
              ))}
            </select>
            <div className="seq-actions">
              <button className="icon" aria-label="Move earlier" disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                ‹
              </button>
              <button className="icon" aria-label="Move later" disabled={disabled || i === seq.length - 1} onClick={() => move(i, 1)}>
                ›
              </button>
              <button className="icon" aria-label="Remove" disabled={disabled} onClick={() => onChange(seq.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          </li>
        ))}
      </ol>

      <div className="palette-head">
        <h3>Add chord</h3>
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
                  disabled={disabled}
                  onClick={() => {
                    onChange([...seq, { key: newKey(), chordId: ch.id, beats: defaultBeats }])
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
    </section>
  )
}
