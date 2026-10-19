# ChordHero

A Simply Guitar–style chord trainer that runs entirely in the browser. Build a chord sequence, pick a tempo, and play along. ChordHero listens through your mic, lights up each string as it hears it ring, and scores each chord as it scrolls past the "now" line.

## Features

- **Living fretboard.** A detailed neck (rosewood, frets, inlays, wound strings) shows exactly where your fingers go. Each string glows and shimmers when the mic hears it, and the next chord's shape ghosts in before you need it.
- **Chord strip.** Upcoming chords slide toward you along the top. The current card shrinks as its beats pass.
- **Guitar Hero–style scoring.** Every chord is graded on how many strings rang and how close to the beat you strummed (Perfect, Great, Good, OK, Miss), with combo multipliers, sparks, and a results screen with your best score.
- **Beginner path** (the **Learn** button). Seven units take an absolute beginner through Em, Am, E, A, D, G and C. Each chord has three stages: learn the shape, drill the changes, then play a short song. Steps unlock in order and your progress is saved.
  - **String coach.** While you learn a shape, every strum gets feedback on which string didn't ring and the likely reason (for example, a finger leaning on the next string, or not pressing hard enough behind the fret).
  - **One-minute changes.** Switch between two chords as many times as you can in 60 seconds. Only clean changes count, and your best is kept.
- **Adaptive tempo** (in ⚙, off by default). The tempo goes up a little after a run of clean chords and comes down after misses.
- **Presets.** Pick a song from the menu at the top, or choose *Build your own…* to make and save your own chord sequences. Each chord can last 1–8 beats.
- **Wait for me** mode (in ⚙) pauses on each chord until you play it. You also get a metronome, count-in, looping, and detection sensitivity.
- **Mic.** If you've allowed the mic before, it connects on its own. *Watch a demo* plays the game for you without a guitar.
- Works on phones (upright or sideways) and desktop. Settings and presets are saved in your browser.

## Install it like an app

ChordHero is an installable web app: it gets its own icon, opens full-screen, and works offline
(after the first launch).

- **iPhone / iPad:** open the site in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open it in Chrome and tap **Install app** (or menu ⋮ → **Add to Home screen**).

The app icon comes from one of the designs in `design/icons/` (see `design/icons/options.png`; the app uses option 7, soundhole play).
To switch, run `node scripts/icons.mjs <number>`.

## Develop

```bash
npm install
npm run dev
npm test   # chords and string order, scoring, timeline, presets, string detection
```

The string-detection tests feed synthetic guitar spectra (flat and phone-style mics) through the
detector and check that every single plucked string lights only itself and every full strum lights
the whole chord. Deploys only go out when the tests pass.

## Deploy (static hosting)

`npm run build` writes a fully static site to `dist/`. It uses relative paths, so it works from any host or subpath.

**GitHub Pages:** push to `main`, then in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow in `.github/workflows/deploy.yml` builds and publishes the site.

Mic access requires HTTPS. GitHub Pages provides it, and `localhost` also works during development.

## Tips for good detection

- Tune your guitar first.
- Put the phone or laptop within about 1 m of the soundhole.
- If strings won't light, slide **Detection** toward *lenient*. If wrong chords count, slide it toward *strict*.
