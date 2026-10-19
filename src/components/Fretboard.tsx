import { useEffect, useState } from 'react'
import type { Chord } from '../music/chords'
import { STRING_NAMES } from '../music/chords'

interface Props {
  chord: Chord | null
  ringing: boolean[]
}

const H = 290
const LABEL_W = 70
const NUT_X = LABEL_W + 30
const TOP = 30
const GAP = 42

function useNarrow(query = '(max-width: 640px)') {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return narrow
}

export function Fretboard({ chord, ringing }: Props) {
  // Phones get fewer, wider frets so everything stays readable.
  const narrow = useNarrow()
  const fretCount = narrow ? 4 : 5
  const FRET_W = narrow ? 104 : 128
  const W = NUT_X + fretCount * FRET_W + 16
  const played = chord ? chord.frets.filter((f) => f > 0) : []
  const firstFret = played.length && Math.max(...played) > fretCount ? Math.min(...played) : 1
  const rowY = (s: number) => TOP + (5 - s) * GAP // high e on top, like tab
  const fretX = (fret: number) => NUT_X + (fret - firstFret + 0.5) * FRET_W

  return (
    <svg className={`fretboard ${narrow ? 'narrow' : ''}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chord ? `${chord.name} chord diagram` : 'Fretboard'}>
      <defs>
        <linearGradient id="wood" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--wood-1)" />
          <stop offset="1" stopColor="var(--wood-2)" />
        </linearGradient>
        {/* userSpaceOnUse: a horizontal line has a zero-height bounding box */}
        <filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect x={NUT_X} y={TOP - 18} width={FRET_W * fretCount} height={GAP * 5 + 36} rx="6" fill="url(#wood)" />
      <rect x={NUT_X - 6} y={TOP - 18} width={firstFret === 1 ? 8 : 2} height={GAP * 5 + 36} rx="2" fill="var(--nut)" />
      {Array.from({ length: fretCount }, (_, i) => (
        <g key={i}>
          <line x1={NUT_X + (i + 1) * FRET_W} x2={NUT_X + (i + 1) * FRET_W} y1={TOP - 18} y2={TOP + GAP * 5 + 18} stroke="var(--fret)" strokeWidth="4" />
          <text x={NUT_X + (i + 0.5) * FRET_W} y={H - 8} className="fret-num">
            {firstFret + i}
          </text>
        </g>
      ))}
      {[3, 5].map((f) =>
        f >= firstFret && f < firstFret + fretCount ? <circle key={f} cx={fretX(f)} cy={TOP + GAP * 2.5} r="7" fill="var(--inlay)" /> : null,
      )}

      {STRING_NAMES.map((name, s) => {
        const fret = chord?.frets[s] ?? -1
        const muted = chord !== null && fret < 0
        const on = !muted && ringing[s]
        const y = rowY(s)
        const thickness = 1.5 + (5 - s) * 0.55
        return (
          <g key={s}>
            <text x={18} y={y + 6} className="string-name">
              {name}
            </text>
            <text x={48} y={y + 6} className={`string-mark ${muted ? 'muted' : on ? 'on' : ''}`}>
              {chord === null ? '' : muted ? '✕' : fret === 0 ? '○' : ''}
            </text>
            <line
              x1={NUT_X - 6}
              x2={NUT_X + FRET_W * fretCount}
              y1={y}
              y2={y}
              className={`string ${muted ? 'muted' : on ? 'on' : chord ? 'expected' : ''}`}
              strokeWidth={on ? thickness + 2 : thickness}
              filter={on ? 'url(#glow)' : undefined}
            />
          </g>
        )
      })}

      {chord?.barre && (
        <rect
          x={fretX(chord.barre.fret) - 16}
          y={rowY(chord.barre.to) - 18}
          width="32"
          height={rowY(chord.barre.from) - rowY(chord.barre.to) + 36}
          rx="16"
          className={`barre ${ringing.some(Boolean) ? 'on' : ''}`}
        />
      )}

      {chord?.frets.map((fret, s) => {
        if (fret <= 0) return null
        const barred = chord.barre && chord.barre.fret === fret && chord.fingers[s] === 1
        if (barred && s !== chord.barre!.from) return null
        const y = barred ? (rowY(chord.barre!.from) + rowY(chord.barre!.to)) / 2 : rowY(s)
        return (
          <g key={s} className={`finger ${ringing[s] ? 'on' : ''}`}>
            <circle cx={fretX(fret)} cy={y} r="17" />
            <text x={fretX(fret)} y={y + 6}>
              {chord.fingers[s] || ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
