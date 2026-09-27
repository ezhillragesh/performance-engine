/**
 * Deterministic mock API used by the demo (dev server and `vite preview`).
 *
 *   GET /api/messages?delay=ms   -> ApiMessage[]
 *   GET /api/invoices?delay=ms   -> ApiInvoice[] (40 rows)
 *   GET /api/slow?ms=N           -> { ms, invoices } after N ms
 *   GET /api/error?delay=ms      -> 500 { error }
 *
 * Everything is generated from a seeded PRNG so every run returns the same data.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

export type MessageCategory = 'Work' | 'Finance' | 'Ops' | 'Personal'

export interface ApiMessage {
  id: number
  sender: string
  subject: string
  preview: string
  body: string
  time: string
  unread: boolean
  starred: boolean
  archived: boolean
  category: MessageCategory
}

export type InvoiceStatus = 'Paid' | 'Pending' | 'Overdue'

export interface ApiInvoice {
  id: string
  customer: string
  amount: number
  status: InvoiceStatus
  dueDate: string
}

const MAX_DELAY_MS = 5000

/** Mulberry32 — tiny deterministic PRNG. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type MessageSeed = Pick<ApiMessage, 'sender' | 'subject' | 'preview' | 'body' | 'category'>

const MESSAGE_SEED: MessageSeed[] = [
  { sender: 'Maya Chen', subject: 'Q3 launch checklist', preview: 'Updated checklist and rollout notes are attached.', body: 'The rollout checklist now lists revised owners, QA gates, and the fallback steps for the launch window. Please confirm your section by Thursday.', category: 'Work' },
  { sender: 'Finance Desk', subject: 'Invoice batch ready for review', preview: 'The monthly batch is ready before the 3 PM payment run.', body: 'Please review the invoice batch before 3 PM so the payment run can be released this afternoon. Two vendors changed bank details this month.', category: 'Finance' },
  { sender: 'Ops Team', subject: 'Maintenance window tonight', preview: 'Status page copy is scheduled to change at 11 PM.', body: 'The status page will be updated for the scheduled maintenance window at 11 PM. No customer-facing downtime is expected.', category: 'Ops' },
  { sender: 'Noah Park', subject: 'Lunch next week?', preview: 'Are you around next Tuesday?', body: 'No pressure, just checking whether you want to grab lunch next Tuesday while you are in the office.', category: 'Personal' },
  { sender: 'Support', subject: 'Overnight ticket summary', preview: 'Three tickets moved to pending overnight.', body: 'Three customer tickets moved to pending with notes from the support queue. One is flagged for engineering follow-up.', category: 'Work' },
  { sender: 'Priya Raman', subject: 'Design review: onboarding', preview: 'Sharing the new onboarding flow for feedback.', body: 'The new onboarding flow reduces the number of steps from seven to four. Feedback on the empty states would be great before Friday.', category: 'Work' },
  { sender: 'Payroll', subject: 'Expense report approved', preview: 'Your March expense report has been approved.', body: 'Your expense report was approved and will be reimbursed in the next payroll cycle.', category: 'Finance' },
  { sender: 'Infra Alerts', subject: 'Disk usage above 80% on cache-02', preview: 'Automated alert from the monitoring pipeline.', body: 'cache-02 crossed the 80% disk usage threshold. The eviction policy has been adjusted; no action is required unless it exceeds 90%.', category: 'Ops' },
  { sender: 'Lena Ortiz', subject: 'Photos from the offsite', preview: 'Uploaded everything to the shared album.', body: 'All the photos from the offsite are in the shared album. Feel free to grab any for the newsletter.', category: 'Personal' },
  { sender: 'Security', subject: 'Quarterly access review', preview: 'Please confirm the access list for your team.', body: 'As part of the quarterly access review, please confirm that the access list for your team is still accurate.', category: 'Ops' },
  { sender: 'Sam Whitaker', subject: 'Contract renewal terms', preview: 'Legal returned the redlines this morning.', body: 'Legal returned the redlines on the renewal. The main change is the payment term moving from net-30 to net-45.', category: 'Finance' },
  { sender: 'Growth Team', subject: 'Weekly metrics digest', preview: 'Activation is up 4.2% week over week.', body: 'Activation is up 4.2% week over week, driven mostly by the new onboarding checklist. Retention is flat.', category: 'Work' },
]

function buildMessages(): ApiMessage[] {
  const random = createRandom(42)
  return MESSAGE_SEED.map((seed, index) => {
    const minutes = 8 * 60 + 7 + index * 23
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
    const mm = String(minutes % 60).padStart(2, '0')
    return {
      ...seed,
      id: index + 1,
      time: `${hh}:${mm}`,
      unread: random() < 0.45,
      starred: random() < 0.3,
      archived: index < 2,
    }
  }).reverse()
}

const CUSTOMERS = ['Acme Corp', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark Industries', 'Wayne Enterprises', 'Soylent', 'Vandelay', 'Wonka Industries']
const STATUSES: InvoiceStatus[] = ['Paid', 'Pending', 'Overdue']

function buildInvoices(count = 40): ApiInvoice[] {
  const random = createRandom(7)
  const rows: ApiInvoice[] = []
  for (let i = 0; i < count; i += 1) {
    const day = 1 + Math.floor(random() * 28)
    const month = 1 + Math.floor(random() * 12)
    rows.push({
      id: `INV-${String(1040 + i).padStart(5, '0')}`,
      customer: CUSTOMERS[Math.floor(random() * CUSTOMERS.length)] ?? 'Acme Corp',
      amount: Math.round((200 + random() * 9800) * 100) / 100,
      status: STATUSES[Math.floor(random() * STATUSES.length)] ?? 'Pending',
      dueDate: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    })
  }
  return rows
}

const MESSAGES = buildMessages()
const INVOICES = buildInvoices()

function readDelay(params: URLSearchParams, key: string, fallback: number): number {
  const value = params.get(key)
  if (value === null) return fallback
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw < 0) return fallback
  return Math.min(Math.round(raw), MAX_DELAY_MS)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

/** Handles `/api/*` requests. Returns false for anything else so the caller can fall through. */
export function handleMockApi(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/')) return false

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return true
  }

  const params = url.searchParams
  let status = 200
  let body: unknown
  let delay = 0

  switch (url.pathname) {
    case '/api/messages':
      delay = readDelay(params, 'delay', 0)
      body = MESSAGES
      break
    case '/api/invoices':
      delay = readDelay(params, 'delay', 0)
      body = INVOICES
      break
    case '/api/slow':
      delay = readDelay(params, 'ms', 1000)
      body = { ms: delay, invoices: INVOICES }
      break
    case '/api/error':
      delay = readDelay(params, 'delay', 0)
      status = 500
      body = { error: 'Simulated server failure' }
      break
    default:
      status = 404
      body = { error: `Unknown endpoint ${url.pathname}` }
  }

  setTimeout(() => sendJson(res, status, body), delay)
  return true
}

type Next = (error?: unknown) => void

/** Vite plugin mounting the mock API on both the dev and the preview server. */
export function mockApiPlugin(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: Next) => {
    if (!handleMockApi(req, res)) next()
  }
  return {
    name: 'northstar-mock-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
