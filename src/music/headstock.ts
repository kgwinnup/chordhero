import type { HeadstockLayout } from './tunings'

/**
 * Where each string's tuning peg sits on a headstock drawing (viewBox 320 × 444), looking at its
 * face with the nut at the bottom. Strings are indexed from the bass side, as in `Tuning.notes`.
 *
 * Real layouts:
 * - 3+3 with the middle strings near the nut (classical, Les Paul style): D and G take the pegs nearest
 *   the nut and the E strings the farthest. The headstock flares outward, so the far pegs sit farther
 *   out and each outer string passes outside the inner strings' posts.
 * - 3+3 with the outer strings near the nut (acoustic): both E strings take the pegs nearest the nut,
 *   so from the top the bass side reads D A E and the treble side G B E.
 * - 6-in-line and 4-in-line (Stratocaster, P-bass): all pegs on the bass side, the low string's
 *   peg nearest the nut and the highest string's at the tip.
 * - 2+2 (ukulele): the outer strings (G, A) take the pegs nearest the nut, the inner (C, E) the far ones.
 */
export interface Peg {
  /** String post */
  x: number
  y: number
  /** Centre of the tuning button the player turns */
  buttonX: number
}

export interface HeadstockGeometry {
  outline: string
  nutY: number
  /** Where each string crosses the nut */
  nutX: number[]
  pegs: Peg[]
}

const NUT_Y = 410
const NUT_LEFT = 120
const NUT_WIDTH = 80
const LEFT_BUTTON = 46
const RIGHT_BUTTON = 274
const mirror = (x: number) => 320 - x

export function headstockGeometry(layout: HeadstockLayout, strings: number): HeadstockGeometry {
  const nutX = Array.from({ length: strings }, (_, i) => NUT_LEFT + ((i + 0.5) * NUT_WIDTH) / strings)
  switch (layout) {
    case 'three-a-side': {
      // Bass side, from the nut up: D, A, low E, each a little farther out along the flare.
      const bass = [
        { x: 98, y: 110 }, // low E
        { x: 114, y: 200 }, // A
        { x: 130, y: 290 }, // D
      ]
      const pegs = Array.from({ length: strings }, (_, i) => {
        if (i < 3) return { ...bass[i], buttonX: LEFT_BUTTON }
        const p = bass[5 - i] // G mirrors D, B mirrors A, high e mirrors low E
        return { x: mirror(p.x), y: p.y, buttonX: RIGHT_BUTTON }
      })
      return { outline: 'M108 412 L98 332 Q70 210 74 86 Q94 38 160 46 Q226 38 246 86 Q250 210 222 332 L212 412 Z', nutY: NUT_Y, nutX, pegs }
    }
    case 'three-a-side-outer-near': {
      // Bass side, from the nut up: low E, A, D; the inner strings pass inside the lower posts.
      const bass = [
        { x: 116, y: 290 }, // low E
        { x: 110, y: 200 }, // A
        { x: 104, y: 110 }, // D
      ]
      const pegs = Array.from({ length: strings }, (_, i) => {
        if (i < 3) return { ...bass[i], buttonX: LEFT_BUTTON }
        const p = bass[5 - i] // G mirrors D, B mirrors A, high e mirrors low E
        return { x: mirror(p.x), y: p.y, buttonX: RIGHT_BUTTON }
      })
      return { outline: 'M108 412 L98 332 Q70 210 74 86 Q94 38 160 46 Q226 38 246 86 Q250 210 222 332 L212 412 Z', nutY: NUT_Y, nutX, pegs }
    }
    case 'two-a-side': {
      // G (left) and A (right) nearest the nut; C and E above them.
      const near = 280
      const far = 170
      const pegs = [
        { x: 118, y: near, buttonX: LEFT_BUTTON + 6 }, // G
        { x: 118, y: far, buttonX: LEFT_BUTTON + 6 }, // C
        { x: mirror(118), y: far, buttonX: RIGHT_BUTTON - 6 }, // E
        { x: mirror(118), y: near, buttonX: RIGHT_BUTTON - 6 }, // A
      ].slice(0, strings)
      return { outline: 'M114 412 L106 340 Q88 230 96 150 Q116 104 160 108 Q204 104 224 150 Q232 230 214 340 L206 412 Z', nutY: NUT_Y, nutX, pegs }
    }
    case 'six-in-line':
    case 'four-in-line': {
      // All on the bass side; the low string's peg is nearest the nut.
      const top = layout === 'six-in-line' ? 96 : 130
      const step = (330 - top) / (strings - 1)
      const pegs = Array.from({ length: strings }, (_, i) => ({ x: 120, y: 330 - i * step, buttonX: LEFT_BUTTON }))
      const outline =
        layout === 'six-in-line'
          ? 'M110 412 L104 372 Q74 334 80 270 L86 112 Q92 62 140 56 Q206 50 232 86 Q244 108 218 128 Q182 150 194 206 L212 412 Z'
          : 'M110 412 L104 370 Q76 330 82 262 L88 140 Q94 92 140 86 Q200 82 222 112 Q232 132 210 150 Q184 172 194 220 L212 412 Z'
      return { outline, nutY: NUT_Y, nutX, pegs }
    }
  }
}
