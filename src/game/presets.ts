import { CHORDS_BY_ID, PRESETS } from '../music/chords'
import { newKey, type SeqItem } from './useGame'

export interface PresetItem {
  chordId: string
  beats: number
}

export interface Preset {
  id: string
  name: string
  builtIn: boolean
  items: PresetItem[]
}

const CUSTOM_KEY = 'chordlight.custom'

export const BUILT_IN_PRESETS: Preset[] = PRESETS.map((p, i) => ({
  id: `builtin-${i}`,
  name: p.name,
  builtIn: true,
  items: p.chords.map((chordId) => ({ chordId, beats: 4 })),
}))

export const toSeq = (items: PresetItem[]): SeqItem[] => items.map((it) => ({ ...it, key: newKey() }))
export const toItems = (seq: SeqItem[]): PresetItem[] => seq.map(({ chordId, beats }) => ({ chordId, beats }))

export function loadCustomPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    // Nothing saved yet: fall through to the sequence older versions kept.
    const parsed = raw === null ? null : (JSON.parse(raw) as Preset[])
    if (Array.isArray(parsed)) {
      return parsed
        .map((p) => ({ ...p, builtIn: false, items: (p.items ?? []).filter((it) => CHORDS_BY_ID[it.chordId]) }))
        .filter((p) => p.items.length)
    }
  } catch {
    /* fall through to the legacy sequence */
  }
  // Earlier versions saved a single sequence; keep it as the first custom preset.
  try {
    const legacy = JSON.parse(localStorage.getItem('chordlight.seq') ?? 'null') as PresetItem[] | null
    const items = Array.isArray(legacy) ? legacy.filter((it) => CHORDS_BY_ID[it.chordId]).map(({ chordId, beats }) => ({ chordId, beats })) : []
    if (items.length) return [{ id: `custom-${newKey()}`, name: 'My chords', builtIn: false, items }]
  } catch {
    /* no legacy data */
  }
  return []
}

export function saveCustomPresets(presets: Preset[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(presets.map(({ id, name, items }) => ({ id, name, items }))))
  } catch {
    /* storage unavailable: presets last for this session only */
  }
}
