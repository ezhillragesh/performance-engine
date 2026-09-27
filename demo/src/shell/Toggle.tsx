interface ToggleProps {
  pressed: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
}

/** iOS-style switch rendered as a toggle button (`aria-pressed`). */
export function Toggle({ pressed, onChange, label, hint }: ToggleProps) {
  return (
    <button type="button" className="toggle" aria-pressed={pressed} onClick={() => onChange(!pressed)} title={hint}>
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {hint ? <span className="toggle__hint">{hint}</span> : null}
      </span>
    </button>
  )
}
