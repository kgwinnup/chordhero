/**
 * Keep the screen on while the player is busy with the guitar (playing a song or tuning).
 *
 * Uses the Screen Wake Lock API where it works. iOS home-screen apps before iOS 18.4 accept a
 * wake lock request but don't honour it, so on iOS (and wherever the request fails) a tiny
 * silent, muted, looping video plays as well, which iOS does treat as "in use".
 * The video (public/keep-awake.mp4) is from NoSleep.js by Rich Tibbett, MIT licence.
 */

const isIOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

let wanted = false
let lock: WakeLockSentinel | null = null
let video: HTMLVideoElement | null = null

function startVideo() {
  if (!video) {
    video = document.createElement('video')
    video.src = `${import.meta.env.BASE_URL}keep-awake.mp4`
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.setAttribute('aria-hidden', 'true')
    Object.assign(video.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none', left: '0', top: '0' })
    // Keep it "playing" without reaching the end, as NoSleep.js does.
    video.addEventListener('timeupdate', () => {
      if (video && video.currentTime > 0.5) video.currentTime = Math.random() * 0.4
    })
    document.body.appendChild(video)
  }
  video.play().catch(() => {
    /* needs a tap first; the next call from a tap will start it */
  })
}

async function acquire() {
  try {
    lock = (await navigator.wakeLock?.request('screen')) ?? null
    lock?.addEventListener('release', () => (lock = null))
  } catch {
    lock = null
  }
  if (isIOS || !lock) startVideo()
}

/** Ask for the screen to stay on (true) or let it sleep normally again (false). */
export function keepAwake(on: boolean) {
  if (on === wanted) return
  wanted = on
  if (on) {
    void acquire()
  } else {
    void lock?.release().catch(() => {})
    lock = null
    video?.pause()
  }
}

// Browsers drop wake locks when the app is hidden; take it back when the player returns.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') void acquire()
  })
}
