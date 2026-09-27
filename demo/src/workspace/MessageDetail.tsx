import { memo } from 'react'
import { ArchiveIcon, PlusIcon, StarIcon } from '../shell/Icons'
import type { Message } from './model'

interface MessageDetailProps {
  message: Message | null
  onToggleStar: (id: number) => void
  onToggleRead: (id: number) => void
  onToggleArchive: (id: number) => void
  onAddFollowUp: (message: Message) => void
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export const MessageDetail = memo(function MessageDetail({
  message,
  onToggleStar,
  onToggleRead,
  onToggleArchive,
  onAddFollowUp,
}: MessageDetailProps) {
  if (!message) {
    return (
      <section className="card message-detail message-detail--empty">
        <p className="empty-state__title">No message selected</p>
        <p className="empty-state__text">Pick a message to read it here.</p>
      </section>
    )
  }

  return (
    <section className="card message-detail" aria-labelledby="message-detail-subject">
      <header className="message-detail__header">
        <span className="avatar" aria-hidden="true">
          {initials(message.sender)}
        </span>
        <div className="message-detail__meta">
          <span className="message-detail__sender truncate">{message.sender}</span>
          <span className="text-secondary tabular">
            {message.time} · {message.category}
          </span>
        </div>
      </header>

      <h2 id="message-detail-subject" className="message-detail__subject">
        {message.subject}
      </h2>
      <p className="message-detail__body">{message.body}</p>

      <div className="message-detail__actions">
        <button type="button" className="button button--secondary button--sm" aria-pressed={message.starred} onClick={() => onToggleStar(message.id)}>
          <StarIcon width={14} height={14} />
          {message.starred ? 'Starred' : 'Star'}
        </button>
        <button type="button" className="button button--secondary button--sm" onClick={() => onToggleRead(message.id)}>
          {message.unread ? 'Mark read' : 'Mark unread'}
        </button>
        <button type="button" className="button button--secondary button--sm" onClick={() => onToggleArchive(message.id)}>
          <ArchiveIcon width={14} height={14} />
          {message.archived ? 'Move to inbox' : 'Archive'}
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={() => onAddFollowUp(message)}>
          <PlusIcon width={14} height={14} />
          Follow-up
        </button>
      </div>
    </section>
  )
})
