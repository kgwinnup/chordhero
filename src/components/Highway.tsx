import { useEffect, useLayoutEffect, useRef } from 'react'
import { EARLY_BEATS, eventByAbs, type GameView, type Layout } from '../game/useGame'

interface Props {
  layout: Layout
  view: React.RefObject<GameView>
  loop: boolean
}

/** Scrolling chord track: chords travel right → left into the "now" line. */
export function Highway({ layout, view, loop }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef({ layout, loop })
  useLayoutEffect(() => {
    propsRef.current = { layout, loop }
  })

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const css = getComputedStyle(canvas)
      const color = (name: string) => css.getPropertyValue(name).trim()
      const { layout: lay, loop: looping } = propsRef.current
      const v = view.current
      const pos = v.pos

      const compact = w < 560
      const ppb = compact ? 64 : 96 // pixels per beat
      const nowX = compact ? 56 : 120
      const x = (beat: number) => nowX + (beat - pos) * ppb
      const top = h * 0.18
      const bottom = h * 0.82

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = color('--track-bg')
      ctx.fillRect(0, 0, w, h)

      // Beat and bar lines.
      const firstBeat = Math.floor(pos - nowX / ppb)
      const lastBeat = Math.ceil(pos + (w - nowX) / ppb)
      for (let b = firstBeat; b <= lastBeat; b++) {
        const bar = ((b % 4) + 4) % 4 === 0
        ctx.strokeStyle = color(bar ? '--track-bar' : '--track-beat')
        ctx.lineWidth = bar ? 2 : 1
        ctx.beginPath()
        ctx.moveTo(x(b), top - 10)
        ctx.lineTo(x(b), bottom + 10)
        ctx.stroke()
      }

      // Chord blocks.
      const n = lay.items.length
      if (n) {
        const firstCycle = Math.max(0, Math.floor((pos - nowX / ppb) / lay.total))
        const lastCycle = looping ? Math.floor((pos + w / ppb) / lay.total) : 0
        for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
          for (let i = 0; i < n; i++) {
            const e = eventByAbs(lay, cycle * n + i, looping)
            if (!e) continue
            const x0 = x(e.start) + 3
            const x1 = x(e.end) - 3
            if (x1 < 0 || x0 > w) continue
            const result = v.results.get(e.abs)
            const active = v.targetAbs === e.abs && (v.phase === 'playing' || v.phase === 'countin')
            const fill = result === 'hit' ? '--hit' : result === 'miss' ? '--miss' : active ? '--active' : '--upcoming'
            ctx.globalAlpha = x1 < nowX && !active ? 0.45 : 1
            ctx.fillStyle = color(fill)
            roundRect(ctx, x0, top, x1 - x0, bottom - top, 14)
            ctx.fill()
            if (active && !result) {
              ctx.strokeStyle = color('--active-ring')
              ctx.lineWidth = 3
              ctx.stroke()
            }
            // Hit window shading just before the chord.
            if (active && !result) {
              ctx.fillStyle = color('--window')
              ctx.fillRect(x(e.start - EARLY_BEATS), top, EARLY_BEATS * ppb, bottom - top)
            }
            ctx.fillStyle = color('--block-text')
            ctx.font = `700 ${compact ? 24 : 34}px system-ui, sans-serif`
            ctx.textBaseline = 'middle'
            ctx.textAlign = 'left'
            const label = e.chord.name
            const tx = Math.max(x0 + 12, Math.min(nowX + 8, x1 - ctx.measureText(label).width - 12))
            ctx.save()
            ctx.beginPath()
            ctx.rect(x0, top, x1 - x0, bottom - top)
            ctx.clip()
            ctx.fillText(label, tx, (top + bottom) / 2)
            ctx.restore()
            ctx.globalAlpha = 1
          }
        }
      }

      // The "now" line.
      ctx.strokeStyle = color('--now')
      ctx.lineWidth = 4
      ctx.shadowColor = color('--now')
      ctx.shadowBlur = 14
      ctx.beginPath()
      ctx.moveTo(nowX, 6)
      ctx.lineTo(nowX, h - 6)
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [view])

  return <canvas ref={canvasRef} className="highway" />
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.roundRect(x, y, Math.max(0, w), h, rr)
}
