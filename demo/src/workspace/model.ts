import type { ApiMessage, MessageCategory } from '../../mock/api'
import { apiUrl } from '../lib/api'

export type { MessageCategory }
export type CategoryFilter = 'All' | MessageCategory
export type WorkspaceView = 'inbox' | 'starred' | 'tasks' | 'archive'

/** Shape returned by `api/messages` (mock/api.ts). */
export type Message = ApiMessage

export type TaskPriority = 'Low' | 'Normal' | 'High'

export interface Task {
  id: number
  title: string
  done: boolean
  priority: TaskPriority
}

export type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string }

export const CATEGORIES: CategoryFilter[] = ['All', 'Work', 'Finance', 'Ops', 'Personal']

export const SEED_TASKS: Task[] = [
  { id: 1, title: 'Review launch checklist', done: false, priority: 'High' },
  { id: 2, title: 'Approve invoice batch', done: false, priority: 'Normal' },
  { id: 3, title: 'Update status page copy', done: true, priority: 'Low' },
]

export const MESSAGES_URL = apiUrl('messages?delay=350')

export async function fetchMessages(signal: AbortSignal): Promise<Message[]> {
  const response = await fetch(MESSAGES_URL, { signal })
  if (!response.ok) throw new Error(`Server responded with ${response.status}`)
  return (await response.json()) as Message[]
}

export function matchesView(message: Message, view: WorkspaceView): boolean {
  switch (view) {
    case 'inbox':
      return !message.archived
    case 'starred':
      return message.starred && !message.archived
    case 'archive':
      return message.archived
    case 'tasks':
      return false
  }
}

export function filterMessages(
  messages: Message[],
  view: WorkspaceView,
  category: CategoryFilter,
  query: string,
): Message[] {
  const needle = query.trim().toLowerCase()
  return messages.filter((message) => {
    if (!matchesView(message, view)) return false
    if (category !== 'All' && message.category !== category) return false
    if (!needle) return true
    return (
      message.sender.toLowerCase().includes(needle) ||
      message.subject.toLowerCase().includes(needle) ||
      message.preview.toLowerCase().includes(needle)
    )
  })
}

const INCOMING: Array<Pick<Message, 'sender' | 'subject' | 'preview' | 'body' | 'category'>> = [
  { sender: 'Build Bot', subject: 'Nightly build passed', preview: 'All 1,284 checks passed in 6m 12s.', body: 'The nightly build finished successfully. Bundle size is unchanged; the slowest suite was integration/payments at 94s.', category: 'Ops' },
  { sender: 'Maya Chen', subject: 'Re: Q3 launch checklist', preview: 'Owners confirmed for sections 2 and 4.', body: 'Section owners for 2 and 4 confirmed. Still waiting on legal for section 5.', category: 'Work' },
  { sender: 'Finance Desk', subject: 'Payment run released', preview: 'The afternoon payment run is complete.', body: 'All approved invoices were paid in the afternoon run. Remittance advice has been sent to vendors.', category: 'Finance' },
  { sender: 'Calendar', subject: 'Design sync moved to 3 PM', preview: 'The organizer updated the event time.', body: 'The weekly design sync moved from 2 PM to 3 PM today. The meeting link is unchanged.', category: 'Work' },
]

/** Deterministic "new mail" generator for the opt-in background sync. */
export function createIncomingMessage(sequence: number, id: number): Message {
  const template = INCOMING[sequence % INCOMING.length] ?? INCOMING[0]!
  const now = new Date()
  return {
    ...template,
    id,
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    unread: true,
    starred: false,
    archived: false,
  }
}
