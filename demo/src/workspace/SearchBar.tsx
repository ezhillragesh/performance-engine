import { memo, useEffect, useRef } from 'react'
import { CloseIcon, SearchIcon } from '../shell/Icons'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
}

/** Search field; press "/" anywhere (outside inputs) to focus it. */
export const SearchBar = memo(function SearchBar({ value, onChange }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return
      }
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="search" role="search">
      <SearchIcon className="search__icon" />
      <input
        ref={inputRef}
        className="search__input"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onChange('')
            event.currentTarget.blur()
          }
        }}
        placeholder="Search mail"
        aria-label="Search mail"
        autoComplete="off"
        spellCheck={false}
      />
      {value ? (
        <button type="button" className="search__clear" aria-label="Clear search" onClick={() => onChange('')}>
          <CloseIcon width={12} height={12} />
        </button>
      ) : (
        <kbd className="search__hint" aria-hidden="true">
          /
        </kbd>
      )}
    </div>
  )
})
