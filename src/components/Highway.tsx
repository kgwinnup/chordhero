import { useEffect, useLayoutEffect, useRef } from 'react'
import { EARLY_BEATS, eventByAbs, type ChordEvent, type GameView, type Layout } from '../game/useGame'
import { GRADE_LABEL, type Grade, type Judgment } from '../game/scoring'

interface Props {
  layout: Layout
  view: React.RefObject<GameView>
  loop: boolean
  vertical: boolean
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
}

interface Ring {
  x: number
  y: number
  life: number
  color: string
}

const GRADE_VAR: Record<Grade, string> = {
  perfect: '--perfect',
  great: '--great',
  good: '--good',
  ok: '--ok',
  miss: '--miss',
}
const BURST: Record<Grade, number> = { perfect: 70, great: 45, good: 28, ok: 14, miss: 0 }
const MULTIPLIER_VAR = ['--mult-1', '--mult-1', '--mult-2', '--mult-3', '--mult-4']

/** Everything a renderer needs for one frame. */
interface Frame {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  t: number
  pos: number
  v: GameView
  lay: Layout
  looping: boolean
  playing: boolean
  color: (name: string) => string
  nowColor: string
  beatFlash: number
}

/** Where hits explode, and how far they spread. */
interface HitZone {
  x: number
  y: number
  spreadX: number
  spreadY: number
  ringSize: number
}

/**
 * The chord track. Horizontal: chords travel right → left into the "now" line.
 * Vertical: a Guitar Hero–style lane where chords rush toward a strike line at the bottom.
 */
export function Highway({ layout, view, loop, vertical }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef({ layout, loop, vertical })
  useLayoutEffect(() => {
    propsRef.current = { layout, loop, vertical }
  })

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let particles: Particle[] = []
    let rings: Ring[] = []
    let seenJudgment = 0
    let shake = 0
    let beatFlash = 0
    let lastBeat = Math.floor(view.current.pos)
    let lastT = performance.now()

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      const dt = Math.min(0.05, (t - lastT) / 1000)
      lastT = t
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }

      const css = getComputedStyle(canvas)
      const color = (name: string) => css.getPropertyValue(name).trim()
      const { layout: lay, loop: looping, vertical: vert } = propsRef.current
      const v = view.current
      const playing = v.phase === 'playing' || v.phase === 'countin'
      if (playing && Math.floor(v.pos) !== lastBeat) {
        lastBeat = Math.floor(v.pos)
        beatFlash = 1
      }
      beatFlash = Math.max(0, beatFlash - dt * 3)

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (shake > 0) {
        ctx.translate((Math.random() - 0.5) * 12 * shake, (Math.random() - 0.5) * 8 * shake)
        shake = Math.max(0, shake - dt * 4)
      }

      const f: Frame = {
        ctx,
        w,
        h,
        t,
        pos: v.pos,
        v,
        lay,
        looping,
        playing,
        color,
        nowColor: color(MULTIPLIER_VAR[Math.min(4, v.multiplier)]),
        beatFlash,
      }
      const zone = vert ? drawVertical(f) : drawHorizontal(f)

      // New judgment → particle burst + shockwave (or shake on a miss).
      const j = v.lastJudgment
      if (j && j.id !== seenJudgment) {
        seenJudgment = j.id
        const c = color(GRADE_VAR[j.grade])
        if (j.grade === 'miss') shake = 1
        for (let i = 0; i < BURST[j.grade]; i++) {
          const a = vert ? -Math.PI * (0.1 + Math.random() * 0.8) : Math.random() * Math.PI * 2
          const speed = 60 + Math.random() * (j.grade === 'perfect' ? 420 : 260)
          particles.push({
            x: zone.x + (Math.random() - 0.5) * zone.spreadX,
            y: zone.y + (Math.random() - 0.5) * zone.spreadY,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            life: 0,
            max: 0.5 + Math.random() * 0.6,
            size: 1.5 + Math.random() * 3,
            color: c,
          })
        }
        if (j.grade !== 'miss') rings.push({ x: zone.x, y: zone.y, life: 0, color: c })
      }

      rings = rings.filter((r) => (r.life += dt) < 0.45)
      for (const r of rings) {
        const k = r.life / 0.45
        ctx.strokeStyle = r.color
        ctx.globalAlpha = 1 - k
        ctx.lineWidth = 4 * (1 - k) + 1
        ctx.beginPath()
        if (vert) ctx.ellipse(r.x, r.y, 10 + k * zone.ringSize, 4 + k * zone.ringSize * 0.3, 0, 0, Math.PI * 2)
        else ctx.arc(r.x, r.y, 10 + k * zone.ringSize, 0, Math.PI * 2)
        ctx.stroke()
      }
      particles = particles.filter((p) => (p.life += dt) < p.max)
      ctx.globalCompositeOperation = 'lighter'
      for (const p of particles) {
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vx *= 0.96
        p.vy = p.vy * 0.96 + 300 * dt
        ctx.globalAlpha = 1 - p.life / p.max
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [view])

  return <canvas ref={canvasRef} className={`highway ${vertical ? 'vertical' : ''}`} />
}

/** Visible chord events (across loop cycles) between two beats. */
function visibleEvents(lay: Layout, looping: boolean, from: number, to: number): ChordEvent[] {
  const n = lay.items.length
  if (!n) return []
  const out: ChordEvent[] = []
  const firstCycle = Math.max(0, Math.floor(from / lay.total))
  const lastCycle = looping ? Math.floor(to / lay.total) : 0
  for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
    for (let i = 0; i < n; i++) {
      const e = eventByAbs(lay, cycle * n + i, looping)
      if (e && e.end > from && e.start < to) out.push(e)
    }
  }
  return out
}

function blockFill(f: Frame, y0: number, y1: number, result: Judgment | undefined, active: boolean) {
  const fill = f.ctx.createLinearGradient(0, y0, 0, y1)
  if (result) {
    const c = f.color(GRADE_VAR[result.grade])
    fill.addColorStop(0, c)
    fill.addColorStop(1, shade(c))
  } else {
    fill.addColorStop(0, f.color(active ? '--active' : '--upcoming'))
    fill.addColorStop(1, f.color(active ? '--active-2' : '--upcoming-2'))
  }
  return fill
}

function resultCaption(result: Judgment) {
  return result.grade === 'miss' ? 'MISS' : `${GRADE_LABEL[result.grade].replace('!', '')} +${result.points}`
}

function drawBackground(f: Frame) {
  const { ctx, w, h, color } = f
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, color('--track-top'))
  bg.addColorStop(0.5, color('--track-bg'))
  bg.addColorStop(1, color('--track-top'))
  ctx.fillStyle = bg
  ctx.fillRect(-10, -10, w + 20, h + 20)
}

function drawHorizontal(f: Frame): HitZone {
  const { ctx, w, h, t, pos, v, color } = f
  const compact = w < 560
  const ppb = compact ? 64 : 96 // pixels per beat
  const nowX = compact ? 56 : 120
  const x = (beat: number) => nowX + (beat - pos) * ppb
  const top = h * 0.16
  const bottom = h * 0.84
  const mid = (top + bottom) / 2

  drawBackground(f)

  for (let b = Math.floor(pos - nowX / ppb); b <= Math.ceil(pos + (w - nowX) / ppb); b++) {
    const bar = ((b % 4) + 4) % 4 === 0
    ctx.strokeStyle = color(bar ? '--track-bar' : '--track-beat')
    ctx.lineWidth = bar ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(x(b), top - 12)
    ctx.lineTo(x(b), bottom + 12)
    ctx.stroke()
  }
  ctx.strokeStyle = color('--track-bar')
  ctx.lineWidth = 1
  for (const y of [top - 12, bottom + 12]) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  for (const e of visibleEvents(f.lay, f.looping, pos - nowX / ppb, pos + w / ppb)) {
    const x0 = x(e.start) + 3
    const x1 = x(e.end) - 3
    const result = v.results.get(e.abs)
    const active = f.playing && v.targetAbs === e.abs && !result

    if (active) {
      ctx.fillStyle = color('--window')
      ctx.fillRect(x(e.start - EARLY_BEATS), top, EARLY_BEATS * ppb, bottom - top)
    }
    ctx.globalAlpha = x1 < nowX && !active ? 0.55 : 1
    ctx.shadowColor = result ? color(GRADE_VAR[result.grade]) : color('--active')
    ctx.shadowBlur = active ? 24 + 10 * Math.sin(t / 120) : result && result.grade !== 'miss' ? 16 : 8
    ctx.fillStyle = blockFill(f, top, bottom, result, active)
    roundRect(ctx, x0, top, x1 - x0, bottom - top, 14)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    roundRect(ctx, x0 + 3, top + 3, x1 - x0 - 6, (bottom - top) * 0.35, 11)
    ctx.fill()
    if (active) {
      ctx.strokeStyle = color('--active-ring')
      ctx.lineWidth = 3
      roundRect(ctx, x0, top, x1 - x0, bottom - top, 14)
      ctx.stroke()
    }

    ctx.save()
    ctx.beginPath()
    ctx.rect(x0, top, x1 - x0, bottom - top)
    ctx.clip()
    ctx.fillStyle = result?.grade === 'perfect' ? '#2a1a00' : color('--block-text')
    ctx.font = `800 ${compact ? 26 : 36}px system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    const label = e.chord.name
    const tx = Math.max(x0 + 12, Math.min(nowX + 8, x1 - ctx.measureText(label).width - 12))
    ctx.fillText(label, tx, result ? mid - 8 : mid)
    if (result) {
      ctx.font = `700 ${compact ? 11 : 13}px system-ui, sans-serif`
      ctx.fillText(resultCaption(result), tx, mid + (compact ? 16 : 22))
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }

  // The "now" line pulses on every beat and takes the multiplier's colour.
  const { nowColor, beatFlash } = f
  ctx.strokeStyle = nowColor
  ctx.lineWidth = 4 + beatFlash * 4
  ctx.shadowColor = nowColor
  ctx.shadowBlur = 14 + beatFlash * 26
  ctx.beginPath()
  ctx.moveTo(nowX, 4)
  ctx.lineTo(nowX, h - 4)
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = nowColor
  for (const y of [6, h - 6]) {
    ctx.beginPath()
    ctx.arc(nowX, y, 6 + beatFlash * 3, 0, Math.PI * 2)
    ctx.fill()
  }

  return { x: nowX, y: mid, spreadX: 0, spreadY: (bottom - top) * 0.6, ringSize: bottom - top }
}

/** Beats ahead at which the lane has shrunk to half its near width. */
const HALF_DEPTH = 2.4
/** How far below the strike line (in beats) the lane is drawn. */
const BEHIND = 0.45

function drawVertical(f: Frame): HitZone {
  const { ctx, w, h, t, pos, v, color, nowColor, beatFlash } = f
  const cx = w / 2
  const strikeY = h * 0.84
  const horizonY = h * 0.03
  const nearHalf = Math.min(w * 0.44, 300)
  // Perspective: s = 1 at the strike line, → 0 toward the horizon.
  const scale = (d: number) => 1 / (1 + Math.max(d, -BEHIND) / HALF_DEPTH)
  const y = (d: number) => horizonY + (strikeY - horizonY) * scale(d)
  const half = (d: number) => nearHalf * scale(d)

  drawBackground(f)

  // The neck: a glowing trapezoid fading into the distance.
  const dNear = -BEHIND
  const dFar = 40
  const neck = ctx.createLinearGradient(0, horizonY, 0, h)
  neck.addColorStop(0, 'rgba(23, 15, 51, 0)')
  neck.addColorStop(0.35, color('--track-top'))
  neck.addColorStop(1, '#1d1240')
  ctx.fillStyle = neck
  quad(ctx, cx, y(dNear), half(dNear), y(dFar), half(dFar))
  ctx.fill()
  ctx.strokeStyle = color('--active')
  ctx.shadowColor = color('--active')
  ctx.shadowBlur = 12
  ctx.lineWidth = 2
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(cx + side * half(dNear), y(dNear))
    ctx.lineTo(cx + side * half(dFar), y(dFar))
    ctx.stroke()
  }
  ctx.shadowBlur = 0

  // Six strings converging into the distance.
  for (let s = 0; s < 6; s++) {
    const k = (s - 2.5) / 3
    ctx.strokeStyle = 'rgba(214, 219, 232, 0.16)'
    ctx.lineWidth = 1 + (5 - s) * 0.3
    ctx.beginPath()
    ctx.moveTo(cx + k * half(dNear), y(dNear))
    ctx.lineTo(cx + k * half(dFar), y(dFar))
    ctx.stroke()
  }

  // Beat lines, scrolling toward you.
  for (let b = Math.ceil(pos - BEHIND); b <= pos + dFar; b++) {
    const d = b - pos
    const s = scale(d)
    if (s < 0.06) break
    const bar = ((b % 4) + 4) % 4 === 0
    ctx.globalAlpha = Math.min(1, s * 2.5)
    ctx.strokeStyle = color(bar ? '--track-bar' : '--track-beat')
    ctx.lineWidth = (bar ? 3 : 1.5) * s
    ctx.beginPath()
    ctx.moveTo(cx - half(d), y(d))
    ctx.lineTo(cx + half(d), y(d))
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // Hit zone glow around the strike line.
  const zone = ctx.createLinearGradient(0, y(EARLY_BEATS), 0, y(-0.2))
  zone.addColorStop(0, 'rgba(255, 61, 184, 0)')
  zone.addColorStop(1, color('--window'))
  ctx.fillStyle = zone
  quad(ctx, cx, y(-0.2), half(-0.2), y(EARLY_BEATS), half(EARLY_BEATS))
  ctx.fill()

  // Chord blocks, far to near so nearer ones draw on top.
  const events = visibleEvents(f.lay, f.looping, pos - BEHIND, pos + dFar).reverse()
  for (const e of events) {
    const d0 = Math.max(e.start - pos, -BEHIND) + 0.04
    const d1 = e.end - pos - 0.04
    if (d1 <= d0 || scale(d1) < 0.05) continue
    const result = v.results.get(e.abs)
    const active = f.playing && v.targetAbs === e.abs && !result
    const yN = y(d0)
    const yF = y(d1)
    const hN = half(d0) * 0.9
    const hF = half(d1) * 0.9
    const passed = e.end - pos < 0 && !active

    ctx.globalAlpha = passed ? 0.5 : Math.min(1, scale(d0) * 2.5)
    ctx.shadowColor = result ? color(GRADE_VAR[result.grade]) : color('--active')
    ctx.shadowBlur = active ? 26 + 12 * Math.sin(t / 120) : result && result.grade !== 'miss' ? 18 : 8
    ctx.fillStyle = blockFill(f, yF, yN, result, active)
    quad(ctx, cx, yN, hN, yF, hF, 10 * scale(d0))
    ctx.fill()
    ctx.shadowBlur = 0
    // Glassy front edge.
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    const lip = Math.min(yN - yF, 14 * scale(d0))
    quad(ctx, cx, yN, hN, yN - lip, hN - (hN - hF) * (lip / Math.max(1, yN - yF)))
    ctx.fill()
    if (active) {
      ctx.strokeStyle = color('--active-ring')
      ctx.lineWidth = 3
      quad(ctx, cx, yN, hN, yF, hF, 10 * scale(d0))
      ctx.stroke()
    }

    // Label rides the near edge, but stays above the strike line while it's being played.
    const s = scale(Math.max(d0, 0))
    const size = Math.max(12, (w < 560 ? 34 : 44) * s)
    const labelY = Math.max(yF + size * 0.7, Math.min(yN, strikeY) - size * 0.55 - (result ? size * 0.35 : 0))
    if (yN - yF > size * 0.6) {
      ctx.fillStyle = result?.grade === 'perfect' ? '#2a1a00' : color('--block-text')
      ctx.font = `900 ${size}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(e.chord.name, cx, labelY)
      if (result && yN - yF > size * 1.2) {
        ctx.font = `800 ${Math.max(10, size * 0.32)}px system-ui, sans-serif`
        ctx.fillText(resultCaption(result), cx, labelY + size * 0.62)
      }
    }
    ctx.globalAlpha = 1
  }

  // Strike line, with glowing pads at each end.
  const sh = half(0)
  ctx.strokeStyle = nowColor
  ctx.lineWidth = 5 + beatFlash * 4
  ctx.shadowColor = nowColor
  ctx.shadowBlur = 16 + beatFlash * 28
  ctx.beginPath()
  ctx.moveTo(cx - sh - 6, strikeY)
  ctx.lineTo(cx + sh + 6, strikeY)
  ctx.stroke()
  ctx.fillStyle = nowColor
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(cx + side * (sh + 6), strikeY, 8 + beatFlash * 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.shadowBlur = 0

  return { x: cx, y: strikeY, spreadX: sh * 1.6, spreadY: 6, ringSize: sh }
}

/** Trapezoid centred on cx, from a near (bottom) edge to a far (top) edge. */
function quad(ctx: CanvasRenderingContext2D, cx: number, yNear: number, halfNear: number, yFar: number, halfFar: number, r = 0) {
  ctx.beginPath()
  if (r <= 0.5) {
    ctx.moveTo(cx - halfNear, yNear)
    ctx.lineTo(cx + halfNear, yNear)
    ctx.lineTo(cx + halfFar, yFar)
    ctx.lineTo(cx - halfFar, yFar)
    ctx.closePath()
    return
  }
  const rr = Math.min(r, (yNear - yFar) / 2, halfFar)
  const pts: [number, number][] = [
    [cx - halfNear, yNear],
    [cx + halfNear, yNear],
    [cx + halfFar, yFar],
    [cx - halfFar, yFar],
  ]
  ctx.moveTo((pts[0][0] + pts[1][0]) / 2, yNear)
  for (let i = 1; i <= 4; i++) {
    const [px, py] = pts[i % 4]
    const [nx, ny] = pts[(i + 1) % 4]
    ctx.arcTo(px, py, nx, ny, rr)
  }
  ctx.closePath()
}

/** Darken a #rrggbb colour for gradient bottoms. */
function shade(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const k = (c: number) => Math.round(c * 0.55)
  return `rgb(${k(n >> 16)}, ${k((n >> 8) & 255)}, ${k(n & 255)})`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.roundRect(x, y, Math.max(0, w), h, rr)
}
