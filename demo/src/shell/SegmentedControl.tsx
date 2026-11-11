import type { ReactNode } from 'react'

export interface Segment<T extends string> {
  value: T
  label: ReactNode
  /** Optional trailing count badge. */
  count?: number
  icon?: ReactNode
}

interface SegmentedControlProps<T extends string> {
  label: string
  segments: Segment<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  /** `tabs` renders a tablist (for page tabs); `buttons` renders pressed toggle buttons (for filters). */
  mode?: 'tabs' | 'buttons'
  /** Tabs mode: tab `i` gets id `${idPrefix}-tab-${value}` and controls `${idPrefix}-panel-${value}`. */
  idPrefix?: string
}

export function SegmentedControl<T extends string>({
  label,
  segments,
  value,
  onChange,
  className,
  mode = 'buttons',
  idPrefix,
}: SegmentedControlProps<T>) {
  const isTabs = mode === 'tabs'
  return (
    <div
      className={`segmented${className ? ` ${className}` : ''}`}
      role={isTabs ? 'tablist' : 'group'}
      aria-label={label}
    >
      {segments.map((segment) => {
        const selected = segment.value === value
        return (
          <button
            key={segment.value}
            type="button"
            className="segmented__item"
            role={isTabs ? 'tab' : undefined}
            id={isTabs && idPrefix ? `${idPrefix}-tab-${segment.value}` : undefined}
            aria-controls={isTabs && idPrefix ? `${idPrefix}-panel-${segment.value}` : undefined}
            aria-selected={isTabs ? selected : undefined}
            aria-pressed={isTabs ? undefined : selected}
            data-selected={selected ? 'true' : undefined}
            onClick={() => onChange(segment.value)}
          >
            {segment.icon}
            <span className="truncate">{segment.label}</span>
            {segment.count !== undefined && segment.count > 0 ? (
              <span className="segmented__count tabular">{segment.count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
