import { memo } from 'react'
import { busyWait } from '../scenarios/busyWork'
import { StarIcon } from '../shell/Icons'
import type { Message } from './model'

interface MessageRowProps {
  message: Message
  selected: boolean
  onSelect: (id: number) => void
  /** Opt-in Heavy mode from the Scenario Lab. */
  heavy: boolean
}

export const MessageRow = memo(function MessageRow({ message, selected, onSelect, heavy }: MessageRowProps) {
  // INTENTIONAL (opt-in only): Heavy mode makes every row cost 1.5ms of CPU.
  if (heavy) busyWait(1.5)

  return (
    <li className="message-row-item">
      <button
        type="button"
        className="message-row"
        aria-current={selected ? 'true' : undefined}
        data-unread={message.unread ? 'true' : undefined}
        onClick={() => onSelect(message.id)}
      >
        <span className="message-row__dot" aria-hidden="true" />
        <span className="message-row__top">
          <span className="message-row__sender truncate">{message.sender}</span>
          {message.starred ? <StarIcon className="message-row__star" width={13} height={13} /> : null}
          <time className="message-row__time tabular">{message.time}</time>
        </span>
        <span className="message-row__subject truncate">{message.subject}</span>
        <span className="message-row__bottom">
          <span className="message-row__preview truncate">{message.preview}</span>
          <span className="tag">{message.category}</span>
        </span>
        {message.unread ? <span className="visually-hidden">, unread</span> : null}
        {message.starred ? <span className="visually-hidden">, starred</span> : null}
      </button>
    </li>
  )
})
