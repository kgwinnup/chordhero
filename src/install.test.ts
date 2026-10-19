import { beforeEach, describe, expect, it } from 'vitest'
import { installHint, SNOOZE_DAYS, snooze, snoozed } from './install'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

describe('install tip', () => {
  it('shows the right steps for each phone', () => {
    expect(installHint(IPHONE, { standalone: false })).toBe('ios')
    expect(installHint(ANDROID, { standalone: false })).toBe('android')
  })

  it('spots an iPad asking for the desktop site by its touch screen', () => {
    expect(installHint(IPAD, { standalone: false, touchMac: true })).toBe('ios')
    expect(installHint(IPAD, { standalone: false, touchMac: false })).toBeNull() // a real Mac
  })

  it('stays away on desktop and once installed', () => {
    expect(installHint(DESKTOP, { standalone: false })).toBeNull()
    expect(installHint(IPHONE, { standalone: true })).toBeNull()
    expect(installHint(ANDROID, { standalone: true })).toBeNull()
  })

  describe('dismissing', () => {
    const store = new Map<string, string>()
    beforeEach(() => {
      store.clear()
      globalThis.localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: () => null,
        length: 0,
      }
    })

    it(`snoozes it for ${SNOOZE_DAYS} days`, () => {
      const now = Date.UTC(2026, 9, 19)
      expect(snoozed(now)).toBe(false)
      snooze(now)
      expect(snoozed(now + 1000)).toBe(true)
      expect(snoozed(now + (SNOOZE_DAYS + 1) * 86_400_000)).toBe(false)
    })
  })
})
