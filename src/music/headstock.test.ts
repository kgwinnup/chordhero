import { describe, expect, it } from 'vitest'
import { headstockGeometry } from './headstock'
import { INSTRUMENTS_BY_ID, noteLabel } from './tunings'

const standard = (instrument: string) => INSTRUMENTS_BY_ID[instrument].tunings[0].notes
const names = (instrument: string) => standard(instrument).map((m) => noteLabel(m).replace(/\d+$/, ''))

/** String names on one side of the headstock, ordered from the nut outwards to the tip. */
function nearestFirst(instrument: string, side: 'bass' | 'treble' | 'all') {
  const inst = INSTRUMENTS_BY_ID[instrument]
  const g = headstockGeometry(inst.layout, standard(instrument).length)
  return g.pegs
    .map((p, i) => ({ ...p, name: names(instrument)[i] }))
    .filter((p) => side === 'all' || (side === 'bass' ? p.buttonX < 160 : p.buttonX > 160))
    .sort((a, b) => b.y - a.y) // larger y = nearer the nut
    .map((p) => p.name)
}

describe('tuning pegs sit where they do on real instruments', () => {
  it('acoustic (3+3): top to bottom D A E on the bass side and G B E on the treble side', () => {
    expect(nearestFirst('acoustic', 'bass')).toEqual(['E', 'A', 'D'])
    expect(nearestFirst('acoustic', 'treble')).toEqual(['E', 'B', 'G'])
  })

  it('classical (3+3): D and G nearest the nut, the E strings at the top', () => {
    expect(nearestFirst('classical', 'bass')).toEqual(['D', 'A', 'E'])
    expect(nearestFirst('classical', 'treble')).toEqual(['G', 'B', 'E'])
  })

  it('electric (6-in-line): all on the bass side, low E nearest the nut, high e at the tip', () => {
    expect(nearestFirst('electric', 'bass')).toEqual(['E', 'A', 'D', 'G', 'B', 'E'])
    expect(nearestFirst('electric', 'treble')).toEqual([])
  })

  it('bass (4-in-line): all on the bass side, E nearest the nut', () => {
    expect(nearestFirst('bass', 'all')).toEqual(['E', 'A', 'D', 'G'])
    expect(nearestFirst('bass', 'treble')).toEqual([])
  })

  it('ukulele (2+2): G and A nearest the nut, C and E above them', () => {
    expect(nearestFirst('ukulele', 'bass')).toEqual(['G', 'C'])
    expect(nearestFirst('ukulele', 'treble')).toEqual(['A', 'E'])
  })
})

/** Do segments ab and cd cross (properly intersect)? */
function cross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const side = (p: [number, number], q: [number, number], r: [number, number]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

describe('drawn strings', () => {
  it.each(['acoustic', 'electric', 'classical', 'bass', 'ukulele'])('never cross on the %s headstock', (instrument) => {
    const inst = INSTRUMENTS_BY_ID[instrument]
    const g = headstockGeometry(inst.layout, standard(instrument).length)
    const segments = g.pegs.map((p, i) => [[g.nutX[i], g.nutY], [p.x, p.y]] as [[number, number], [number, number]])
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        expect(cross(...segments[i], ...segments[j]), `${names(instrument)[i]} and ${names(instrument)[j]} strings`).toBe(false)
      }
    }
  })

  it.each(['acoustic', 'electric', 'classical', 'bass', 'ukulele'])('leave the nut in order, bass side on the left (%s)', (instrument) => {
    const g = headstockGeometry(INSTRUMENTS_BY_ID[instrument].layout, standard(instrument).length)
    for (let i = 1; i < g.nutX.length; i++) expect(g.nutX[i]).toBeGreaterThan(g.nutX[i - 1])
  })
})
