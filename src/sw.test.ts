import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Runs public/sw.js against an in-memory stand-in for the browser's service worker APIs, so the
 * offline behaviour is tested without a browser that supports service workers.
 */
function loadWorker(network: Record<string, string>, { online = true } = {}) {
  const BASE = 'https://example.test/app/'
  const stores = new Map<string, Map<string, Response>>()
  const key = (r: { url: string } | string) => new URL(typeof r === 'string' ? r : r.url, BASE).href
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return {
        async put(r: { url: string } | string, res: Response) {
          store.set(key(r), res)
        },
        async addAll(urls: string[]) {
          for (const u of urls) store.set(key(u), await fakeFetch(u))
        },
        async keys() {
          return [...store.keys()].map((u) => new Request(u))
        },
      }
    },
    async match(r: { url: string } | string) {
      for (const store of stores.values()) if (store.has(key(r))) return store.get(key(r))!.clone()
      return undefined
    },
    async keys() {
      return [...stores.keys()]
    },
    async delete(name: string) {
      return stores.delete(name)
    },
  }
  let isOnline = online
  async function fakeFetch(input: { url: string } | string): Promise<Response> {
    if (!isOnline) throw new TypeError('offline')
    const url = key(input)
    const path = url.slice(BASE.length)
    if (!(path in network)) return new Response('not found', { status: 404 })
    return new Response(network[path], { status: 200 })
  }
  const listeners: Record<string, (e: unknown) => void> = {}
  const self = {
    location: new URL(BASE),
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  }
  new Function('self', 'caches', 'fetch', readFileSync('public/sw.js', 'utf8'))(self, caches, fakeFetch)

  const run = async (type: string, extra: object = {}) => {
    let done: Promise<unknown> = Promise.resolve()
    let response: Promise<Response> | undefined
    listeners[type]({ ...extra, waitUntil: (p: Promise<unknown>) => (done = p), respondWith: (p: Promise<Response>) => (response = p) })
    await done
    return response
  }
  return {
    install: () => run('install'),
    activate: () => run('activate'),
    // A plain request-like object: Node's Request has a read-only `mode`.
    fetch: (path: string, mode = 'no-cors') => run('fetch', { request: { url: BASE + path, method: 'GET', mode } }),
    goOffline: () => (isOnline = false),
    cached: async () => (await (await caches.open('chordhero-v1')).keys()).map((r) => r.url.slice(BASE.length)),
  }
}

const SITE = {
  '': '<script type="module" src="./assets/index-abc.js"></script><link rel="stylesheet" href="./assets/index-def.css">',
  'manifest.webmanifest': '{}',
  'icons/icon-192.png': 'png',
  'icons/icon-512.png': 'png',
  'models/basic-pitch/model.json': '{}',
  'models/basic-pitch/group1-shard1of1.bin': 'weights',
  'assets/index-abc.js': 'app',
  'assets/index-def.css': 'css',
  'assets/esm-xyz.js': 'tf',
}

describe('service worker', () => {
  it('caches the page, its scripts and styles, the icons and the ML model on install', async () => {
    const sw = loadWorker(SITE)
    await sw.install()
    expect((await sw.cached()).sort()).toEqual(
      ['', 'assets/index-abc.js', 'assets/index-def.css', 'icons/icon-192.png', 'icons/icon-512.png', 'manifest.webmanifest', 'models/basic-pitch/group1-shard1of1.bin', 'models/basic-pitch/model.json'].sort(),
    )
  })

  it('opens offline from the cache', async () => {
    const sw = loadWorker(SITE)
    await sw.install()
    await sw.activate()
    sw.goOffline()
    expect(await (await sw.fetch('', 'navigate'))!.text()).toContain('index-abc.js')
    expect(await (await sw.fetch('assets/index-abc.js'))!.text()).toBe('app')
    expect(await (await sw.fetch('models/basic-pitch/group1-shard1of1.bin'))!.text()).toBe('weights')
  })

  it('caches files loaded later (like the model runtime) for next time', async () => {
    const sw = loadWorker(SITE)
    await sw.install()
    await sw.fetch('assets/esm-xyz.js')
    expect(await sw.cached()).toContain('assets/esm-xyz.js')
  })

  it('serves the newest page when online', async () => {
    const site = { ...SITE }
    const sw = loadWorker(site)
    await sw.install()
    site[''] = '<script type="module" src="./assets/index-new.js"></script>'
    expect(await (await sw.fetch('', 'navigate'))!.text()).toContain('index-new.js')
  })
})
