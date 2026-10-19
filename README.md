# ChordLight

A Simply Guitar–style chord trainer that runs entirely in the browser. Build a chord sequence, pick a tempo, and play along. ChordLight listens through your mic, lights up each string as it hears it ring, and scores each chord as it scrolls past the "now" line.

## Features

- **Live string detection.** The fretboard lights each string green when its note is heard (Web Audio FFT, checking each string's fundamental and harmonics).
- **Chord highway.** Chords scroll toward the playhead so you can see what's next. Hits turn green and misses turn red.
- **Wait for me** mode pauses on each chord until you play it. Turn it off to play strictly in time.
- **Tempo** from 30 to 200 BPM, plus a metronome, count-in, and looping.
- **Sequence builder** with 23 chords and presets. Each chord can last 1–8 beats, and ♪ plays any chord so you can hear it.
- **Test mode** strums the right chords for you, so you can try the app without a guitar or mic.
- Works on phones and desktop. Settings are saved in your browser.

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
