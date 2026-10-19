import { useEffect, useState } from 'react'
import { canPrompt, installHint, isStandalone, onPromptChange, promptInstall, snooze, snoozed } from '../install'

/** Seconds after launch before the tip slides in, so it doesn't pile onto the mic popup. */
const DELAY_MS = 4000

/** On a phone, in the browser: suggest installing to the home screen (full screen, works offline). */
export function InstallToast({ hidden }: { hidden: boolean }) {
  const [hint] = useState(() =>
    snoozed() ? null : installHint(navigator.userAgent, { standalone: isStandalone(), touchMac: navigator.maxTouchPoints > 1 }),
  )
  const [ready, setReady] = useState(false)
  const [closed, setClosed] = useState(false)
  const [prompt, setPrompt] = useState(canPrompt)

  useEffect(() => {
    if (!hint) return
    const timer = setTimeout(() => setReady(true), DELAY_MS)
    const off = onPromptChange(() => setPrompt(canPrompt()))
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [hint])

  // Chrome only offers to install when it isn't installed yet, so on Android that offer is the cue.
  // Safari can't tell whether it's on the home screen, so on iPhone the tip says what to do if it is.
  if (!hint || !ready || closed || hidden || (hint === 'android' && !prompt)) return null
  const close = () => {
    snooze()
    setClosed(true)
  }

  return (
    <div className="install-toast" role="status">
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="install-icon" />
      <div className="install-text">
        <b>Install ChordHero</b>
        {hint === 'ios' ? (
          <span>
            Tap <ShareIcon /> <b>Share</b>, then <b>Add to Home Screen</b>. It opens full screen, like an app. Already added? Open it from your home
            screen.
          </span>
        ) : (
          <span>Add it to your home screen: full screen, and it works offline.</span>
        )}
      </div>
      {hint === 'android' && (
        <button
          className="primary"
          onClick={async () => {
            if (await promptInstall()) setClosed(true)
          }}
        >
          Install
        </button>
      )}
      <button className="icon ghost" aria-label="Dismiss" onClick={close}>
        ✕
      </button>
    </div>
  )
}

/** The iOS share icon: a box with an arrow out of the top. */
function ShareIcon() {
  return (
    <svg className="share-icon" viewBox="0 0 16 20" aria-hidden>
      <path d="M8 1v11M4.5 4.5 8 1l3.5 3.5M5 8H2.5v10.5h11V8H11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
