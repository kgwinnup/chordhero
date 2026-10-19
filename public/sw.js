// ChordHero service worker: makes the installed app work offline.
// - Pages: network first (always the latest when online), cached copy when offline.
// - Everything else on this site (hashed scripts and styles, fonts, icons, the ML model):
//   cache first. Built files get a new name whenever they change, so a cached copy is never stale.
const CACHE = 'chordhero-v1'
const PRECACHE = ['./', 'manifest.webmanifest', 'keep-awake.mp4', 'icons/icon-192.png', 'icons/icon-512.png', 'models/basic-pitch/model.json', 'models/basic-pitch/group1-shard1of1.bin']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(PRECACHE)
      // Also cache the scripts and styles the current page needs, so the very next launch works offline.
      const html = await (await fetch('./', { cache: 'no-cache' })).text()
      const assets = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => m[1])
      await cache.addAll(assets)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request)
          const cache = await caches.open(CACHE)
          await cache.put('./', fresh.clone())
          return fresh
        } catch {
          return (await caches.match('./')) ?? Response.error()
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) (await caches.open(CACHE)).put(request, response.clone())
      return response
    })(),
  )
})
