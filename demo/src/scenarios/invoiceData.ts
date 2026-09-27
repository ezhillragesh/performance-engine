export type InvoiceStatus = 'Paid' | 'Pending' | 'Overdue'

export interface Invoice {
  id: string
  customer: string
  amount: number
  status: InvoiceStatus
  dueDate: string
}

interface SlowResponse {
  ms: number
  invoices: Invoice[]
}

export const PAGE_SIZE = 8

export const SLOW_INVOICES_URL = '/api/slow?ms=900'

export async function fetchSlowInvoices(url = SLOW_INVOICES_URL): Promise<Invoice[]> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = (await response.json()) as SlowResponse
  return body.invoices
}

/* Cache used only by the fixed variant of the network scenario. */
let cached: Invoice[] | null = null
let inflight: Promise<Invoice[]> | null = null

export function getCachedInvoices(): Invoice[] | null {
  return cached
}

/** Starts (or reuses) a background fetch. Safe to call repeatedly, e.g. on hover. */
export function prefetchInvoices(): Promise<Invoice[]> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = fetchSlowInvoices()
      .then((rows) => {
        cached = rows
        return rows
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
