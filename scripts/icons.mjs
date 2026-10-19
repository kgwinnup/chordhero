// Renders app icons from the SVG designs in design/icons (retired designs live in design/icons/rejected).
//   node scripts/icons.mjs 3        use option 3 as the app icon (writes public/icons/*)
//   node scripts/icons.mjs --sheet  render design/icons/options.png to compare all options
import { Resvg } from '@resvg/resvg-js'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const designDir = join(root, 'design/icons')
const options = readdirSync(designDir)
  .filter((f) => /^option-\d+-.*\.svg$/.test(f))
  .sort((a, b) => parseInt(a.slice(7)) - parseInt(b.slice(7)))

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: true } }).render().asPng()

if (process.argv[2] === '--sheet') {
  // All options side by side, each shown with an iOS-style rounded mask.
  const tile = 220
  const gap = 36
  const width = options.length * tile + (options.length + 1) * gap
  const height = tile + 2 * gap + 50
  const tiles = options
    .map((file, i) => {
      const x = gap + i * (tile + gap)
      // Prefix each design's ids so gradients and filters with the same name (like "bg") don't collide.
      const inner = readFileSync(join(designDir, file), 'utf8')
        .replace(/id="([^"]+)"/g, `id="o${i}-$1"`)
        .replace(/url\(#([^)]+)\)/g, `url(#o${i}-$1)`)
        .replace('<svg ', `<svg x="${x}" y="${gap}" width="${tile}" height="${tile}" `)
      const label = file.replace(/^option-(\d+)-(.*)\.svg$/, (_, n, name) => `${n}. ${name.replace(/-/g, ' ')}`)
      return `<clipPath id="c${i}"><rect x="${x}" y="${gap}" width="${tile}" height="${tile}" rx="${tile * 0.22}"/></clipPath>
        <g clip-path="url(#c${i})">${inner}</g>
        <text x="${x + tile / 2}" y="${gap + tile + 34}" fill="#e9e9ee" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="bold" text-anchor="middle" style="text-transform: capitalize">${label}</text>`
    })
    .join('\n')
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#2a2a2e"/>${tiles}</svg>`
  writeFileSync(join(designDir, 'options.png'), render(sheet, width))
  console.log(`wrote design/icons/options.png (${options.length} options)`)
} else {
  const n = Number(process.argv[2] ?? 1)
  const file = options.find((f) => f.startsWith(`option-${n}-`))
  if (!file) throw new Error(`No icon option ${n}. Options: ${options.join(', ')}`)
  const svg = readFileSync(join(designDir, file), 'utf8')
  const out = join(root, 'public/icons')
  mkdirSync(out, { recursive: true })
  // Full-bleed squares: iOS and Android apply their own rounded or circular masks, and every
  // design keeps its subject inside the maskable safe zone, so one artwork serves all sizes.
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['maskable-512.png', 512],
    ['apple-touch-icon.png', 180],
  ]) {
    writeFileSync(join(out, name), render(svg, size))
  }
  copyFileSync(join(designDir, file), join(root, 'public/favicon.svg'))
  console.log(`app icon is now ${file}`)
}
