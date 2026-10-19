/** Nudging phone players to install ChordHero to their home screen. */

export type InstallHint = 'ios' | 'android' | null

/** How long a dismissed install tip stays away. */
export const SNOOZE_DAYS = 14
const KEY = 'chordhero.installTip'

/**
 * Which install tip to show: iPhone/iPad (Share → Add to Home Screen) or Android (an Install
 * button, shown only once the browser offers to install, which it doesn't once it's installed), or
 * none on desktop and when running as the installed app.
 */
export function installHint(ua: string, opts: { standalone: boolean; touchMac?: boolean }): InstallHint {
  if (opts.standalone) return null
  // iPadOS asks for the desktop site and reports itself as a Mac: spot it by its touch screen.
  if (/iPhone|iPad|iPod/.test(ua) || (opts.touchMac && /Macintosh/.test(ua))) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return null
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export function snoozed(now = Date.now()) {
  try {
    const until = Number(localStorage.getItem(KEY) ?? 0)
    return now < until
  } catch {
    return false
  }
}

export function snooze(now = Date.now()) {
  try {
    localStorage.setItem(KEY, String(now + SNOOZE_DAYS * 24 * 60 * 60 * 1000))
  } catch {
    /* storage unavailable: the tip comes back next visit */
  }
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Chrome on Android offers its own install dialog through this event, which can fire before the
 * app has rendered, so it's caught as soon as this module loads.
 */
let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // we show our own tip instead of the browser's mini-infobar
    deferred = e as InstallPromptEvent
    listeners.forEach((fn) => fn())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((fn) => fn())
  })
}

export const canPrompt = () => deferred !== null

export function onPromptChange(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Show the browser's install dialog. Resolves true if the player installed. */
export async function promptInstall() {
  const e = deferred
  if (!e) return false
  deferred = null
  await e.prompt()
  return (await e.userChoice).outcome === 'accepted'
}
