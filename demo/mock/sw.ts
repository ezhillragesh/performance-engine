/// <reference lib="webworker" />
/**
 * Mock API Service Worker for the production build (static hosting has no
 * server to answer `api/*`). Built to `mock-api-sw.js` by server/mockApi.ts.
 *
 * It answers exactly like the dev middleware: same handler, same simulated
 * latency, real HTTP status codes. The page still issues ordinary fetch/XHR
 * requests, so the engine's network tracker and Resource Timing see real
 * traffic. Everything that is not `<base>api/*` goes to the network untouched.
 */
import { apiRoute, MOCK_HEADERS, resolveMockRequest } from './api'

declare const self: ServiceWorkerGlobalScope

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// The page asks to be claimed after a hard reload (which bypasses the worker).
self.addEventListener('message', (event) => {
  if (event.data === 'claim') event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  const route = apiRoute(url.pathname, new URL(self.registration.scope).pathname)
  if (!route) return

  const { status, body, delayMs } = resolveMockRequest(event.request.method, route, url.searchParams)
  event.respondWith(
    new Promise<Response>((resolve) => {
      setTimeout(() => resolve(new Response(JSON.stringify(body), { status, headers: MOCK_HEADERS })), delayMs)
    }),
  )
})
