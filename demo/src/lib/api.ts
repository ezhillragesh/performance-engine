/**
 * Where the mock API lives and how it is reached.
 *
 * Dev: the Vite middleware answers `api/*` (server/mockApi.ts).
 * Production build: a Service Worker built from mock/sw.ts answers the same
 * requests in the browser, so the static site works on any host. Either way
 * the page makes real fetch/XHR requests that the engine's network tracker sees.
 */
const BASE = import.meta.env.BASE_URL
/** Injected by server/mockApi.ts (`define`), so the client never bundles the mock data module. */
const MOCK_SW_FILE = __MOCK_SW_FILE__

/** Absolute path of an API endpoint below the app's base URL, e.g. `apiUrl('slow?ms=900')`. */
export function apiUrl(endpoint: string): string {
  return `${BASE}api/${endpoint}`
}

/** Longest we hold the first render waiting for the worker; the app still renders (and can retry) after it. */
const CONTROL_TIMEOUT_MS = 4000

function waitForController(container: ServiceWorkerContainer): Promise<void> {
  if (container.controller) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer)
      container.removeEventListener('controllerchange', done)
      resolve()
    }
    const timer = window.setTimeout(done, CONTROL_TIMEOUT_MS)
    container.addEventListener('controllerchange', done)
  })
}

/**
 * Makes sure `api/*` requests will be answered before the app renders.
 * Never rejects: without Service Workers the app renders and shows its
 * normal "couldn't load" states.
 */
export async function startMockApi(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const container = navigator.serviceWorker
  try {
    if (import.meta.env.DEV) {
      // The dev middleware answers; drop a worker left over from `vite preview` on this origin.
      const registrations = await container.getRegistrations()
      await Promise.all(
        registrations.filter((r) => r.active?.scriptURL.endsWith(`/${MOCK_SW_FILE}`)).map((r) => r.unregister()),
      )
      return
    }
    const registration = await container.register(`${BASE}${MOCK_SW_FILE}`, { scope: BASE })
    if (container.controller) return
    // First visit: the worker claims the page on activation. Hard reload: the
    // page bypassed an already-active worker, so ask it to claim us.
    registration.active?.postMessage('claim')
    await waitForController(container)
  } catch {
    // Unsupported or blocked (e.g. some private modes): render anyway.
  }
}
