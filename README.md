# ChordHero

A Simply Guitar–style chord trainer that runs entirely in the browser. Build a chord sequence, pick a tempo, and play along. ChordHero listens through your mic, lights up each string as it hears it ring, and scores each chord as it scrolls past the "now" line.

## Features

- **Living fretboard.** A detailed neck (rosewood, frets, inlays, wound strings) shows exactly where your fingers go. Each string glows and shimmers when the mic hears it, and the next chord's shape ghosts in before you need it.
- **Chord strip.** Upcoming chords slide toward you along the top. The current card shrinks as its beats pass.
- **Guitar Hero–style scoring.** Every chord is graded on how many strings rang and how close to the beat you strummed (Perfect, Great, Good, OK, Miss), with combo multipliers, sparks, and a results screen with your best score.
- **Presets.** Pick a song from the menu at the top, or choose *Build your own…* to make and save your own chord sequences. Each chord can last 1–8 beats.
- **Wait for me** mode (in ⚙) pauses on each chord until you play it. You also get a metronome, count-in, looping, and detection sensitivity.
- **Mic check.** You enable the mic and strum once to confirm it hears you. *Watch a demo* plays the game for you without a guitar.
- Works on phones (upright or sideways) and desktop. Settings and presets are saved in your browser.

## Develop

```bash
npm install
npm run dev
```

## Deploy (static hosting)

`npm run build` writes a fully static site to `dist/`. It uses relative paths, so it works from any host or subpath.

**GitHub Pages:** push to `main`, then in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow in `.github/workflows/deploy.yml` builds and publishes the site.

Mic access requires HTTPS. GitHub Pages provides it, and `localhost` also works during development.

## Tips for good detection

- Tune your guitar first.
- Put the phone or laptop within about 1 m of the soundhole.
- If strings won't light, slide **Detection** toward *lenient*. If wrong chords count, slide it toward *strict*.
