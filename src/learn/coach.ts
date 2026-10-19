import type { Chord } from '../music/chords'

/** String names as you'd say them out loud, low → high, for the guitar being played. */
export { SPOKEN_STRING } from '../music/chords'
import { SPOKEN_STRING } from '../music/chords'
export const FINGER = ['', 'index finger', 'middle finger', 'ring finger', 'pinky']
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`

/** One strum as the coach heard it. */
export interface Strum {
  /** Which strings rang, low → high */
  ringing: boolean[]
  /** It sounded like this chord, and more like it than any other */
  soundsRight: boolean
}

export interface Hint {
  tone: 'great' | 'fix'
  text: string
  /** The string the hint is about, if any */
  string?: number
}

const chordStrings = (chord: Chord) => chord.frets.flatMap((f, s) => (f >= 0 ? [s] : []))
const mutedStrings = (chord: Chord) => chord.frets.flatMap((f, s) => (f < 0 ? [s] : []))
const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

/** How many of the chord's strings rang. */
export const stringsRinging = (chord: Chord, ringing: boolean[]) => chordStrings(chord).filter((s) => ringing[s]).length

/** Every string rang and it sounded like the chord. */
export const isClean = (chord: Chord, strum: Strum) => strum.soundsRight && stringsRinging(chord, strum.ringing) === chordStrings(chord).length

/** Good enough to count as a change in the drill: it's the chord, with at most one string missing. */
export function isChange(chord: Chord, strum: Strum) {
  const expected = chordStrings(chord).length
  return strum.soundsRight && stringsRinging(chord, strum.ringing) >= Math.ceil(expected * 0.8)
}

/** Step-by-step finger placement for a chord, in the order you'd put your fingers down. */
export function shapeSteps(chord: Chord): string[] {
  const lines: string[] = []
  if (chord.barre) {
    lines.push(`Lay your index finger flat across the ${ordinal(chord.barre.fret)} fret, from the ${SPOKEN_STRING[chord.barre.from]} to the ${SPOKEN_STRING[chord.barre.to]} string`)
  }
  const placed = chord.frets
    .map((f, s) => ({ s, f, finger: chord.fingers[s] }))
    .filter(({ f, finger }) => f > 0 && finger > 0 && !(chord.barre && finger === 1 && f === chord.barre.fret))
    .sort((a, b) => a.finger - b.finger || a.s - b.s)
  for (const { s, f, finger } of placed) {
    const word = FINGER[finger]
    lines.push(`${word[0].toUpperCase()}${word.slice(1)} on the ${ordinal(f)} fret of the ${SPOKEN_STRING[s]} string`)
  }
  const muted = mutedStrings(chord)
  if (muted.length) lines.push(`Don't strum the ${list(muted.map((s) => SPOKEN_STRING[s]))} string${muted.length > 1 ? 's' : ''} (✕): start on the ${SPOKEN_STRING[muted[muted.length - 1] + 1]}`)
  else lines.push(`Strum all ${['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'][chord.frets.length]} strings`)
  return lines
}

/**
 * What to tell a beginner after a strum: which string didn't ring and the likely reason. Fingers
 * lean onto the next thinner string, so an open string that's dead is usually muted by the finger
 * on the string just above it; a fretted string that's dead needs more pressure, closer to the fret.
 */
export function coach(chord: Chord, strum: Strum): Hint {
  const strings = chordStrings(chord)
  const dark = strings.filter((s) => !strum.ringing[s])
  const name = chord.name

  if (!dark.length) {
    if (strum.soundsRight) return { tone: 'great', text: `Clean ${name}! Every string rang.` }
    const muted = mutedStrings(chord)
    return {
      tone: 'fix',
      text: muted.length
        ? `Something sounded off. Make sure you skip the ${list(muted.map((s) => SPOKEN_STRING[s]))} string${muted.length > 1 ? 's' : ''}, and check each finger against the shape.`
        : `Something sounded off. Check each finger against the shape: is every one on the right string and fret?`,
    }
  }

  if (dark.length > strings.length / 2) {
    return { tone: 'fix', text: `That didn't sound like ${name} yet. Put each finger down one at a time, then strum through all the strings.` }
  }

  // The lowest strings missing and everything above ringing: the strum started too low on the neck.
  const missedFromLow = dark.every((s, i) => s === strings[i])
  if (missedFromLow) {
    const first = strings[0]
    return { tone: 'fix', string: first, text: `Start your strum on the ${SPOKEN_STRING[first]} string: it's part of ${name}.` }
  }

  const s = pickDark(chord, dark)
  const prefix = dark.length > 1 ? `${dark.length} strings didn't ring. Start with the ${SPOKEN_STRING[s]}: ` : ''
  return { tone: 'fix', string: s, text: prefix + stringFix(chord, s) }
}

/** Why one string of a chord isn't ringing, and how to fix it. */
export function stringFix(chord: Chord, s: number) {
  const fret = chord.frets[s]
  if (fret === 0) {
    const culprit = s > 0 && chord.frets[s - 1] > 0 ? chord.fingers[s - 1] : 0
    if (culprit) {
      return `The open ${SPOKEN_STRING[s]} string is muted. Your ${FINGER[culprit]} on the ${SPOKEN_STRING[s - 1]} string is probably touching it: arch that finger and press with its tip.`
    }
    return `The open ${SPOKEN_STRING[s]} string isn't ringing. Make sure no finger or palm is resting on it.`
  }
  if (chord.barre && chord.fingers[s] === 1 && fret === chord.barre.fret) {
    return `The barre isn't pressing the ${SPOKEN_STRING[s]} string. Roll your index finger slightly onto its bony edge and squeeze.`
  }
  return `The ${SPOKEN_STRING[s]} string is muted or buzzing. Press harder with your ${FINGER[chord.fingers[s]] || 'finger'}, right behind the ${ordinal(fret)} fret.`
}

/** The dark string most worth fixing first: an open string with a likely culprit, else the thinnest. */
function pickDark(chord: Chord, dark: number[]) {
  return dark.find((s) => chord.frets[s] === 0 && s > 0 && chord.frets[s - 1] > 0) ?? dark[dark.length - 1]
}
