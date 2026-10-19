import { describe, expect, it } from 'vitest'
import { CHORDS, CHORDS_BY_ID } from '../music/chords'
import { coach, isChange, isClean, shapeSteps } from './coach'

const ring = (...strings: number[]) => Array.from({ length: 6 }, (_, s) => strings.includes(s))
const all = (id: string) => ring(...CHORDS_BY_ID[id].frets.flatMap((f, s) => (f >= 0 ? [s] : [])))
const without = (id: string, ...dark: number[]) => all(id).map((on, s) => on && !dark.includes(s))

describe('the coach', () => {
  it('praises a clean strum', () => {
    const hint = coach(CHORDS_BY_ID['Em'], { ringing: all('Em'), soundsRight: true })
    expect(hint.tone).toBe('great')
  })

  it('blames the finger leaning on a muted open string', () => {
    // Em: ring finger on the D string's 2nd fret often lies on the open G.
    const hint = coach(CHORDS_BY_ID['Em'], { ringing: without('Em', 3), soundsRight: true })
    expect(hint).toMatchObject({ tone: 'fix', string: 3 })
    expect(hint.text).toMatch(/open G string/)
    expect(hint.text).toMatch(/ring finger on the D string/)
  })

  it('asks for more pressure on a dead fretted string', () => {
    // C: index finger on the B string's 1st fret.
    const hint = coach(CHORDS_BY_ID['C'], { ringing: without('C', 4), soundsRight: true })
    expect(hint.string).toBe(4)
    expect(hint.text).toMatch(/B string/)
    expect(hint.text).toMatch(/index finger, right behind the 1st fret/)
  })

  it('says where to start the strum when the lowest strings are missing', () => {
    const hint = coach(CHORDS_BY_ID['G'], { ringing: without('G', 0), soundsRight: true })
    expect(hint.text).toMatch(/Start your strum on the low E/)
    // C starts on the A string, not the low E.
    expect(coach(CHORDS_BY_ID['C'], { ringing: without('C', 1), soundsRight: true }).text).toMatch(/Start your strum on the A/)
  })

  it('names the barre when a barred string is dead', () => {
    const hint = coach(CHORDS_BY_ID['F'], { ringing: without('F', 5), soundsRight: true })
    expect(hint.text).toMatch(/barre/)
  })

  it('says when it does not sound like the chord at all', () => {
    expect(coach(CHORDS_BY_ID['G'], { ringing: ring(1), soundsRight: false }).text).toMatch(/didn't sound like G/)
    expect(coach(CHORDS_BY_ID['D'], { ringing: all('D'), soundsRight: false }).text).toMatch(/skip the low E and A strings/)
  })

  it('counts several dark strings', () => {
    expect(coach(CHORDS_BY_ID['Em'], { ringing: without('Em', 3, 5), soundsRight: true }).text).toMatch(/^2 strings didn't ring/)
  })

  it('gives a hint for every chord and every single dark string', () => {
    for (const chord of CHORDS) {
      chord.frets.forEach((f, s) => {
        if (f < 0) return
        const hint = coach(chord, { ringing: without(chord.id, s), soundsRight: true })
        expect(hint.tone, `${chord.name} ${s}`).toBe('fix')
        expect(hint.text.length).toBeGreaterThan(20)
      })
    }
  })
})

describe('clean strums and changes', () => {
  it('a clean strum needs every string and the right sound', () => {
    const em = CHORDS_BY_ID['Em']
    expect(isClean(em, { ringing: all('Em'), soundsRight: true })).toBe(true)
    expect(isClean(em, { ringing: without('Em', 3), soundsRight: true })).toBe(false)
    expect(isClean(em, { ringing: all('Em'), soundsRight: false })).toBe(false)
  })

  it('a change allows one string to miss, but not two', () => {
    const em = CHORDS_BY_ID['Em']
    expect(isChange(em, { ringing: without('Em', 3), soundsRight: true })).toBe(true)
    expect(isChange(em, { ringing: without('Em', 3, 5), soundsRight: true })).toBe(false)
    expect(isChange(CHORDS_BY_ID['D'], { ringing: without('D', 5), soundsRight: true })).toBe(false)
  })
})

describe('shape steps', () => {
  it('walks through the fingers in order', () => {
    expect(shapeSteps(CHORDS_BY_ID['C'])).toEqual([
      'Index finger on the 1st fret of the B string',
      'Middle finger on the 2nd fret of the D string',
      'Ring finger on the 3rd fret of the A string',
      "Don't strum the low E string (✕): start on the A",
    ])
    expect(shapeSteps(CHORDS_BY_ID['Em'])).toEqual(['Middle finger on the 2nd fret of the A string', 'Ring finger on the 2nd fret of the D string', 'Strum all six strings'])
  })

  it('describes the barre once', () => {
    const steps = shapeSteps(CHORDS_BY_ID['F'])
    expect(steps[0]).toMatch(/Lay your index finger flat across the 1st fret/)
    expect(steps.filter((l) => l.startsWith('Index'))).toEqual([])
  })
})
