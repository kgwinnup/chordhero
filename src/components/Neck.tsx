import { useEffect, useLayoutEffect, useRef } from 'react'
import { eventByAbs, type GameView, type Layout } from '../game/useGame'
import type { Grade } from '../game/scoring'
import { type Chord, STRING_NAMES } from '../music/chords'

interface Props {
  layout: Layout
  view: React.RefObject<GameView>
  loop: boolean
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

/** Everything about where things sit on the canvas, recomputed when it resizes. */
interface Geo {
  w: number
  h: number
  stripH: number
  neckTop: number
  neckBottom: number
  nutX: number
  boardRight: number
  labelX: number
  markerX: number
  gap: number
  fretX: (n: number) => number
  stringY: (k: number) => number
}

const GRADE_VAR: Record<Grade, string> = {
  perfect: '--perfect',
  great: '--great',
  good: '--good',
  ok: '--ok',
  miss: '--miss',
}
const BURST: Record<Grade, number> = { perfect: 16, great: 11, good: 7, ok: 4, miss: 0 }
/** The board shows the nut through a little past the 5th fret. */
const VISIBLE_FRETS = 5.6
const INLAYS = [3, 5, 7, 9]
/** String thickness in px, low E → high e. */
const GAUGE = [4.2, 3.5, 2.8, 2.1, 1.6, 1.25]
const WOUND = [true, true, true, false, false, false]

/**
 * The play area: a strip of chord cards sliding toward "now" on top, and a detailed
 * guitar neck below showing where your fingers go and which strings are ringing.
 */
export function Neck({ layout, view, loop }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef({ layout, loop })
  useLayoutEffect(() => {
    propsRef.current = { layout, loop }
  })

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let particles: Particle[] = []
    let rings: Ring[] = []
    let seenJudgment = 0
    let shake = 0
    let flash = 0
    let flashColor = ''
    let beatFlash = 0
    let lastBeat = Math.floor(view.current.pos)
    let lastT = performance.now()
    let wood: HTMLCanvasElement | null = null
    let woodKey = ''

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
      const { layout: lay, loop: looping } = propsRef.current
      const v = view.current
      const playing = v.phase === 'playing' || v.phase === 'countin'
      const g = geometry(w, h)

      if (playing && Math.floor(v.pos) !== lastBeat) {
        lastBeat = Math.floor(v.pos)
        beatFlash = 1
      }
      beatFlash = Math.max(0, beatFlash - dt * 3)
      flash = Math.max(0, flash - dt * 2.5)

      // New judgment: sparks fly off the chord's finger positions.
      const j = v.lastJudgment
      if (j && j.id !== seenJudgment) {
        seenJudgment = j.id
        const c = color(GRADE_VAR[j.grade])
        const chord = eventByAbs(lay, j.abs, looping)?.chord
        if (j.grade === 'miss') {
          shake = 1
          flash = 1
          flashColor = c
        } else if (chord) {
          flash = 1
          flashColor = c
          for (const p of fingerPoints(g, chord)) {
            rings.push({ x: p.x, y: p.y, life: 0, color: c })
            for (let i = 0; i < BURST[j.grade]; i++) {
              const a = Math.random() * Math.PI * 2
              const speed = 40 + Math.random() * (j.grade === 'perfect' ? 260 : 170)
              particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 60, life: 0, max: 0.4 + Math.random() * 0.5, size: 1.2 + Math.random() * 2.4, color: c })
            }
          }
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (shake > 0) {
        ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 6 * shake)
        shake = Math.max(0, shake - dt * 4)
      }

      drawStrip(ctx, g, v, lay, looping, playing, color)

      const key = `${w}x${h}@${dpr}`
      if (!wood || woodKey !== key) {
        wood = paintNeck(g, dpr, color)
        woodKey = key
      }
      ctx.drawImage(wood, 0, 0, w, h)

      // The nut glows on each beat.
      if (beatFlash > 0) {
        ctx.fillStyle = color('--accent')
        ctx.globalAlpha = beatFlash * 0.5
        ctx.shadowColor = color('--accent')
        ctx.shadowBlur = 18
        ctx.fillRect(g.nutX - 6, g.neckTop, 8, g.neckBottom - g.neckTop)
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1
      }

      const chord = v.display
      const next = playing && v.targetAbs !== null ? eventByAbs(lay, v.targetAbs + 1, looping) : null
      drawStrings(ctx, g, chord, v.ringing, t, flash, flashColor, color)
      if (next && next.chord.id !== chord?.id) {
        // Ghost of the next shape fades in over the last beat and a half.
        const fade = Math.max(0, Math.min(1, 1 - (next.start - v.pos) / 1.5))
        if (fade > 0) drawShape(ctx, g, next.chord, null, fade * 0.55, true, color)
      }
      if (chord) drawShape(ctx, g, chord, v.ringing, 1, false, color)
      drawMarkers(ctx, g, chord, v.ringing, color)

      rings = rings.filter((r) => (r.life += dt) < 0.4)
      for (const r of rings) {
        const k = r.life / 0.4
        ctx.strokeStyle = r.color
        ctx.globalAlpha = 1 - k
        ctx.lineWidth = 3 * (1 - k) + 1
        ctx.beginPath()
        ctx.arc(r.x, r.y, 8 + k * g.gap * 1.2, 0, Math.PI * 2)
        ctx.stroke()
      }
      particles = particles.filter((p) => (p.life += dt) < p.max)
      ctx.globalCompositeOperation = 'lighter'
      for (const p of particles) {
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vx *= 0.95
        p.vy = p.vy * 0.95 + 260 * dt
        ctx.globalAlpha = 1 - p.life / p.max
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    }

    // The cached neck has text on it: repaint once the web fonts arrive.
    document.fonts?.ready.then(() => {
      woodKey = ''
    })
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [view])

  return <canvas ref={canvasRef} className="neck" />
}

function geometry(w: number, h: number): Geo {
  const compact = w < 560
  // On short screens (phones held sideways) the strip gives the neck more room.
  const stripH = Math.max(46, Math.min(compact ? 64 : 78, Math.round(h * 0.2)))
  const fretNumH = 20
  const neckTop = stripH + 12
  const neckBottom = h - fretNumH
  const labelX = compact ? 10 : 16
  const markerX = labelX + (compact ? 24 : 28)
  const nutX = markerX + (compact ? 17 : 22)
  const boardRight = w
  const scale = 1 - Math.pow(2, -VISIBLE_FRETS / 12)
  const fretX = (n: number) => nutX + ((boardRight - nutX) * (1 - Math.pow(2, -n / 12))) / scale
  const edge = (neckBottom - neckTop) * 0.085
  const gap = (neckBottom - neckTop - edge * 2) / 5
  const stringY = (k: number) => neckTop + edge + (5 - k) * gap // high e on top, like tab
  return { w, h, stripH, neckTop, neckBottom, nutX, boardRight, labelX, markerX, gap, fretX, stringY }
}

/** Where a finger (or barre) lands for fret f: just behind the fret wire, like a real hand. */
const fingerX = (g: Geo, f: number) => g.fretX(f - 1) + (g.fretX(f) - g.fretX(f - 1)) * 0.62
const dotRadius = (g: Geo) => Math.min(g.gap * 0.4, (g.fretX(5) - g.fretX(4)) * 0.28)

function fingerPoints(g: Geo, chord: Chord) {
  return chord.frets.flatMap((f, k) => (f > 0 ? [{ x: fingerX(g, f), y: g.stringY(k) }] : f === 0 ? [{ x: g.markerX, y: g.stringY(k) }] : []))
}

/** Cards for each chord slide toward the "now" edge; the current card is eaten away as its beats pass. */
function drawStrip(ctx: CanvasRenderingContext2D, g: Geo, v: GameView, lay: Layout, looping: boolean, playing: boolean, color: (n: string) => string) {
  const n = lay.items.length
  if (!n) return
  const nowX = g.labelX
  const ppb = Math.max(30, Math.min(64, g.w / 13))
  const pos = v.pos
  const top = 6
  const bottom = g.stripH - 4
  const compact = g.w < 560

  const minCard = compact ? 54 : 70
  const firstCycle = Math.max(0, Math.floor(pos / lay.total))
  const lastCycle = looping ? Math.floor((pos + g.w / ppb) / lay.total) : 0
  const cards = []
  for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
    for (let i = 0; i < n; i++) {
      const e = eventByAbs(lay, cycle * n + i, looping)
      if (e) cards.push(e)
    }
  }
  // The current card is drawn last so it can sit on top of the next one while it shrinks.
  cards.sort((a, b) => Number(playing && v.targetAbs === a.abs) - Number(playing && v.targetAbs === b.abs))
  for (const e of cards) {
    const current = playing && v.targetAbs === e.abs
    let x0 = nowX + (e.start - pos) * ppb
    let x1 = nowX + (e.end - pos) * ppb - 6
    if (x0 < nowX) x0 = nowX
    // The current card is eaten away as its beats pass, but never too small to read.
    if (current) x1 = Math.max(x1, x0 + minCard)
    if (x1 <= nowX + 8 || x0 > g.w) continue
    const result = v.results.get(e.abs)

    ctx.globalAlpha = result && !current ? 0.55 : 1
    ctx.fillStyle = current ? color('--card-now') : color('--card')
    roundRect(ctx, x0, top, x1 - x0, bottom - top, 10)
    ctx.fill()
    ctx.strokeStyle = current ? color('--accent') : color('--card-edge')
    ctx.lineWidth = current ? 2 : 1
    ctx.stroke()
    if (result) {
      ctx.fillStyle = color(GRADE_VAR[result.grade])
      roundRect(ctx, x0 + 4, bottom - 7, Math.max(0, x1 - x0 - 8), 4, 2)
      ctx.fill()
    }

    ctx.save()
    ctx.beginPath()
    ctx.rect(x0, top, x1 - x0, bottom - top)
    ctx.clip()
    ctx.fillStyle = current ? color('--card-now-text') : color('--text')
    const size = Math.min(current ? (compact ? 28 : 34) : compact ? 18 : 22, (bottom - top) * (current ? 0.62 : 0.48))
    ctx.font = `800 ${size}px 'Fraunces Variable', Georgia, serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(e.chord.name, x0 + 10, (top + bottom) / 2 - 2)
    ctx.restore()
    ctx.globalAlpha = 1
  }

  // "Now" marker.
  ctx.fillStyle = color('--accent')
  ctx.beginPath()
  ctx.moveTo(nowX - 6, g.stripH + 2)
  ctx.lineTo(nowX + 6, g.stripH + 2)
  ctx.lineTo(nowX, g.stripH + 10)
  ctx.closePath()
  ctx.fill()
}

/** The static neck: rosewood with grain and pores, binding, bone nut, nickel frets, pearl inlays. Cached. */
function paintNeck(g: Geo, dpr: number, color: (n: string) => string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.round(g.w * dpr)
  c.height = Math.round(g.h * dpr)
  const ctx = c.getContext('2d')!
  ctx.scale(dpr, dpr)
  const { neckTop: top, neckBottom: bottom, nutX, boardRight: right } = g
  const rand = seeded(7)

  // Headstock stub behind the labels.
  const head = ctx.createLinearGradient(0, top, 0, bottom)
  head.addColorStop(0, '#2a1c13')
  head.addColorStop(0.5, '#3b281b')
  head.addColorStop(1, '#2a1c13')
  ctx.fillStyle = head
  roundRect(ctx, 2, top - 6, nutX, bottom - top + 12, 12)
  ctx.fill()

  // Rosewood board.
  const board = ctx.createLinearGradient(0, top, 0, bottom)
  board.addColorStop(0, '#3a2418')
  board.addColorStop(0.12, '#5a3a26')
  board.addColorStop(0.5, '#64412b')
  board.addColorStop(0.88, '#5a3a26')
  board.addColorStop(1, '#3a2418')
  ctx.fillStyle = board
  ctx.fillRect(nutX, top, right - nutX, bottom - top)

  ctx.save()
  ctx.beginPath()
  ctx.rect(nutX, top, right - nutX, bottom - top)
  ctx.clip()
  // Grain: long, gently wandering streaks, light and dark.
  for (let i = 0; i < (bottom - top) * 1.4; i++) {
    const y0 = top + rand() * (bottom - top)
    const amp = 0.6 + rand() * 2.2
    const freq = 0.004 + rand() * 0.012
    const phase = rand() * 10
    ctx.strokeStyle = rand() < 0.6 ? `rgba(20, 10, 4, ${0.06 + rand() * 0.12})` : `rgba(160, 110, 70, ${0.04 + rand() * 0.08})`
    ctx.lineWidth = 0.4 + rand() * 1.4
    ctx.beginPath()
    for (let x = nutX; x <= right; x += 6) {
      const y = y0 + Math.sin(x * freq + phase) * amp
      if (x === nutX) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // Pores.
  for (let i = 0; i < (right - nutX) * (bottom - top) * 0.004; i++) {
    ctx.fillStyle = `rgba(15, 8, 3, ${0.25 + rand() * 0.35})`
    ctx.fillRect(nutX + rand() * (right - nutX), top + rand() * (bottom - top), 1 + rand() * 2.5, 0.8)
  }
  // Wear where hands play most: a soft sheen in the first frets.
  const sheen = ctx.createRadialGradient(g.fretX(2), (top + bottom) / 2, 4, g.fretX(2), (top + bottom) / 2, (right - nutX) * 0.45)
  sheen.addColorStop(0, 'rgba(255, 220, 170, 0.07)')
  sheen.addColorStop(1, 'rgba(255, 220, 170, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(nutX, top, right - nutX, bottom - top)
  ctx.restore()

  // Pearl inlays (double dot would be at 12, off screen).
  const mid = (top + bottom) / 2
  for (const f of INLAYS) {
    const x = (g.fretX(f - 1) + g.fretX(f)) / 2
    if (x > right) continue
    const r = Math.min(g.gap * 0.28, 9)
    const pearl = ctx.createRadialGradient(x - r * 0.3, mid - r * 0.3, 1, x, mid, r)
    pearl.addColorStop(0, '#fffaf0')
    pearl.addColorStop(0.5, '#e8ddd0')
    pearl.addColorStop(0.8, '#c9d6dc')
    pearl.addColorStop(1, '#b8a99a')
    ctx.fillStyle = pearl
    ctx.beginPath()
    ctx.arc(x, mid, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Frets: nickel wire with a highlight and a shadow on the wood.
  for (let f = 1; g.fretX(f) < right + 4; f++) {
    const x = g.fretX(f)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.fillRect(x + 2, top, 3, bottom - top)
    const wire = ctx.createLinearGradient(x - 2.5, 0, x + 2.5, 0)
    wire.addColorStop(0, '#7d7a75')
    wire.addColorStop(0.35, '#f4f1ea')
    wire.addColorStop(0.6, '#b9b5ad')
    wire.addColorStop(1, '#6a6762')
    ctx.fillStyle = wire
    ctx.fillRect(x - 2.5, top - 1, 5, bottom - top + 2)
  }

  // Cream binding along both edges.
  for (const y of [top - 3, bottom]) {
    ctx.fillStyle = '#e9dcc0'
    ctx.fillRect(nutX, y, right - nutX, 3)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
    ctx.fillRect(nutX, y + 3, right - nutX, 1)
  }

  // Bone nut with string slots.
  const nut = ctx.createLinearGradient(nutX - 8, 0, nutX, 0)
  nut.addColorStop(0, '#d9ccb2')
  nut.addColorStop(0.5, '#f6efe0')
  nut.addColorStop(1, '#cbbd9f')
  ctx.fillStyle = nut
  roundRect(ctx, nutX - 8, top - 4, 9, bottom - top + 8, 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(60, 40, 20, 0.45)'
  for (let k = 0; k < 6; k++) ctx.fillRect(nutX - 8, g.stringY(k) - 1, 9, 2)

  // String posts on the headstock and string names.
  for (let k = 0; k < 6; k++) {
    const y = g.stringY(k)
    ctx.fillStyle = color('--muted')
    ctx.font = `700 ${Math.max(11, Math.min(15, g.gap * 0.45))}px 'Outfit Variable', system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(STRING_NAMES[k], g.labelX + 4, y)
  }

  // Fret numbers.
  ctx.fillStyle = color('--muted')
  ctx.font = "600 12px 'Outfit Variable', system-ui, sans-serif"
  for (let f = 1; f <= Math.floor(VISIBLE_FRETS); f++) {
    ctx.fillText(String(f), (g.fretX(f - 1) + g.fretX(f)) / 2, bottom + 13)
  }
  return c
}

/** Strings: wound bronze basses and plain steel trebles. Ringing strings glow and shimmer. */
function drawStrings(
  ctx: CanvasRenderingContext2D,
  g: Geo,
  chord: Chord | null,
  ringing: boolean[],
  t: number,
  flash: number,
  flashColor: string,
  color: (n: string) => string,
) {
  for (let k = 0; k < 6; k++) {
    const y = g.stringY(k)
    const thick = GAUGE[k] * Math.min(1.15, Math.max(0.75, g.gap / 40))
    const muted = !!chord && chord.frets[k] < 0
    const lit = !!chord && !muted && ringing[k]
    const from = g.nutX - 6
    const to = g.boardRight
    const amp = lit ? Math.min(2.2, thick * 0.6) : 0

    // Shadow on the wood.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.lineWidth = thick
    ctx.beginPath()
    ctx.moveTo(from, y + thick + 1.5)
    ctx.lineTo(to, y + thick + 1.5)
    ctx.stroke()

    const metal = ctx.createLinearGradient(0, y - thick / 2, 0, y + thick / 2)
    if (WOUND[k]) {
      metal.addColorStop(0, '#8a6a3c')
      metal.addColorStop(0.4, '#f1d29a')
      metal.addColorStop(1, '#6f532c')
    } else {
      metal.addColorStop(0, '#8d9198')
      metal.addColorStop(0.4, '#f7f8fa')
      metal.addColorStop(1, '#787c83')
    }
    ctx.globalAlpha = muted ? 0.45 : 1
    if (lit) {
      ctx.shadowColor = color('--ring')
      ctx.shadowBlur = 16
    }
    ctx.strokeStyle = lit ? color('--ring') : metal
    ctx.lineWidth = lit ? thick + 1 : thick
    ctx.beginPath()
    for (let x = from; x <= to; x += 4) {
      // A standing wave between nut and the board's end.
      const u = (x - from) / (to - from)
      const yy = y + Math.sin(u * Math.PI) * amp * Math.sin(t / 22 + k)
      if (x === from) ctx.moveTo(x, yy)
      else ctx.lineTo(x, yy)
    }
    ctx.stroke()
    ctx.shadowBlur = 0

    // Winding texture on the bass strings.
    if (WOUND[k] && !lit && thick > 2) {
      ctx.strokeStyle = 'rgba(70, 45, 15, 0.35)'
      ctx.lineWidth = 0.6
      ctx.beginPath()
      for (let x = from; x <= to; x += 2.2) {
        ctx.moveTo(x, y - thick / 2)
        ctx.lineTo(x + 1.2, y + thick / 2)
      }
      ctx.stroke()
    }

    if (flash > 0 && flashColor) {
      ctx.strokeStyle = flashColor
      ctx.globalAlpha = flash * 0.6
      ctx.lineWidth = thick + 2
      ctx.beginPath()
      ctx.moveTo(from, y)
      ctx.lineTo(to, y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
}

/** Finger dots (and barre) for a chord. Ghost mode draws hollow outlines for the next chord. */
function drawShape(
  ctx: CanvasRenderingContext2D,
  g: Geo,
  chord: Chord,
  ringing: boolean[] | null,
  alpha: number,
  ghost: boolean,
  color: (n: string) => string,
) {
  const r = dotRadius(g)
  ctx.globalAlpha = alpha
  if (chord.barre) {
    const x = fingerX(g, chord.barre.fret)
    const yTop = g.stringY(chord.barre.to)
    const yBot = g.stringY(chord.barre.from)
    if (ghost) {
      ctx.strokeStyle = color('--text')
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      roundRect(ctx, x - r * 0.8, yTop - r * 0.8, r * 1.6, yBot - yTop + r * 1.6, r * 0.8)
      ctx.stroke()
      ctx.setLineDash([])
    } else {
      ctx.fillStyle = color('--finger')
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
      ctx.shadowBlur = 8
      ctx.shadowOffsetY = 3
      roundRect(ctx, x - r * 0.75, yTop - r * 0.75, r * 1.5, yBot - yTop + r * 1.5, r * 0.75)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
    }
  }
  chord.frets.forEach((fret, k) => {
    if (fret <= 0) return
    const barred = chord.barre && chord.barre.fret === fret && chord.fingers[k] === 1
    if (barred) return
    const x = fingerX(g, fret)
    const y = g.stringY(k)
    if (ghost) {
      ctx.strokeStyle = color('--text')
      ctx.lineWidth = 2
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.arc(x, y, r * 0.9, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      return
    }
    const on = ringing?.[k]
    const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r)
    body.addColorStop(0, on ? '#d8ffe4' : '#ffe2a8')
    body.addColorStop(0.45, on ? color('--ring') : color('--finger'))
    body.addColorStop(1, on ? '#2f7d4a' : '#9a5a14')
    ctx.fillStyle = body
    ctx.shadowColor = on ? color('--ring') : 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = on ? 18 : 8
    ctx.shadowOffsetY = on ? 0 : 3
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
    ctx.fillStyle = '#2a1608'
    ctx.font = `800 ${r * 1.05}px 'Outfit Variable', system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(chord.fingers[k] || ''), x, y + 1)
  })
  ctx.globalAlpha = 1
}

/** Open (○) and muted (✕) markers left of the nut. */
function drawMarkers(ctx: CanvasRenderingContext2D, g: Geo, chord: Chord | null, ringing: boolean[], color: (n: string) => string) {
  if (!chord) return
  const r = Math.min(g.gap * 0.28, 9)
  chord.frets.forEach((fret, k) => {
    const x = g.markerX
    const y = g.stringY(k)
    if (fret < 0) {
      ctx.strokeStyle = color('--miss')
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(x - r * 0.7, y - r * 0.7)
      ctx.lineTo(x + r * 0.7, y + r * 0.7)
      ctx.moveTo(x + r * 0.7, y - r * 0.7)
      ctx.lineTo(x - r * 0.7, y + r * 0.7)
      ctx.stroke()
    } else if (fret === 0) {
      const on = ringing[k]
      ctx.strokeStyle = on ? color('--ring') : color('--text')
      ctx.lineWidth = 2.5
      if (on) {
        ctx.shadowColor = color('--ring')
        ctx.shadowBlur = 12
      }
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  })
}

/** Small deterministic RNG so the wood grain is the same every time. */
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.roundRect(x, y, Math.max(0, w), h, rr)
}
