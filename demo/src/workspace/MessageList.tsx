import { memo } from 'react'
import { RefreshIcon } from '../shell/Icons'
import { MessageRow } from './MessageRow'
import type { LoadState, Message } from './model'

interface MessageListProps {
  messages: Message[]
  selectedId: number | null
  load: LoadState
  onSelect: (id: number) => void
  onRetry: () => void
  heavy: boolean
  emptyHint: string
}

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5]

export const MessageList = memo(function MessageList({
  messages,
  selectedId,
  load,
  onSelect,
  onRetry,
  heavy,
  emptyHint,
}: MessageListProps) {
  let body
  if (load.status === 'loading') {
    body = (
      <ul className="message-list__items" aria-busy="true" aria-label="Loading messages">
        {SKELETON_ROWS.map((row) => (
          <li key={row} className="message-skeleton">
            <span className="skeleton skeleton--line skeleton--short" />
            <span className="skeleton skeleton--line" />
            <span className="skeleton skeleton--line skeleton--faint" />
          </li>
        ))}
      </ul>
    )
  } else if (load.status === 'error') {
    body = (
      <div className="empty-state" role="alert">
        <p className="empty-state__title">Couldn’t load messages</p>
        <p className="empty-state__text">{load.message}</p>
        <button type="button" className="button button--secondary" onClick={onRetry}>
          <RefreshIcon />
          Try again
        </button>
      </div>
    )
  } else if (messages.length === 0) {
    body = (
      <div className="empty-state">
        <p className="empty-state__title">No messages</p>
        <p className="empty-state__text">{emptyHint}</p>
      </div>
    )
  } else {
    body = (
      <ul className="message-list__items">
        {messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            selected={message.id === selectedId}
            onSelect={onSelect}
            heavy={heavy}
          />
        ))}
      </ul>
    )
  }

  return (
    <section className="card message-list" aria-label="Messages">
      {body}
    </section>
  )
})
