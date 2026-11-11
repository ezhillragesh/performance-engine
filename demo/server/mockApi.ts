/**
 * Vite plugin for the demo's mock API (handler and data: mock/api.ts).
 *
 *   - Dev server: mounted as middleware, so `api/*` is answered over real HTTP.
 *   - Build: bundles the Service Worker (mock/sw.ts) into `mock-api-sw.js` next to
 *     index.html. The built site registers it (src/lib/api.ts) and is fully
 *     functional on any static host, including `vite preview`, which
 *     deliberately has no middleware so it behaves exactly like a deployment.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'vite'
import { apiRoute, MOCK_HEADERS, MOCK_SW_FILE, resolveMockRequest } from '../mock/api'

const SW_ENTRY = fileURLToPath(new URL('../mock/sw.ts', import.meta.url))

/** Handles `<base>api/*` requests. Returns false for anything else so the caller can fall through. */
export function handleMockApi(req: IncomingMessage, res: ServerResponse, basePath = '/'): boolean {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const route = apiRoute(url.pathname, basePath)
  if (!route) return false

  const { status, body, delayMs } = resolveMockRequest(req.method ?? 'GET', route, url.searchParams)
  setTimeout(() => {
    res.statusCode = status
    for (const [name, value] of Object.entries(MOCK_HEADERS)) res.setHeader(name, value)
    res.end(JSON.stringify(body))
  }, delayMs)
  return true
}

/** Bundles the worker on its own: a classic Service Worker must be one self-contained script. */
async function bundleWorker(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      write: false,
      minify: true,
      lib: { entry: SW_ENTRY, formats: ['iife'], name: 'northstarMockApi', fileName: () => MOCK_SW_FILE },
    },
  })
  const outputs = Array.isArray(result) ? result : [result]
  for (const output of outputs) {
    if (!('output' in output)) continue
    const chunk = output.output.find((item) => item.type === 'chunk')
    if (chunk && chunk.type === 'chunk') return chunk.code
  }
  throw new Error(`Could not bundle ${MOCK_SW_FILE}`)
}

export function mockApiPlugin(): Plugin {
  let basePath = '/'
  let emitWorker = false
  let worker: Promise<string> | null = null
  return {
    name: 'northstar-mock-api',
    config() {
      return { define: { __MOCK_SW_FILE__: JSON.stringify(MOCK_SW_FILE) } }
    },
    configResolved(config) {
      basePath = config.base
      emitWorker = config.command === 'build' && !config.build.ssr
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!handleMockApi(req, res, basePath)) next()
      })
    },
    buildStart() {
      if (emitWorker) worker = bundleWorker()
    },
    async generateBundle() {
      if (worker) this.emitFile({ type: 'asset', fileName: MOCK_SW_FILE, source: await worker })
    },
  }
}
