const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

function setNativeValue(input: HTMLInputElement, value: string): void {
  // React tracks the value property; the prototype setter makes the change visible to onChange.
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Quiet period before the returned promise resolves. Callers typically flip a
 * "busy" flag when typing ends; doing that synchronously in the last
 * keystroke's task would make the card re-render inside that keystroke's
 * trace and be reported as part of the keystroke's work.
 */
const SETTLE_MS = 250

/**
 * Types `text` into a (React-controlled) input one character at a time by
 * dispatching real DOM `keydown` + `input` events, so the engine's UI tracker
 * sees keystrokes exactly like manual typing (minus `isTrusted`). Resolves
 * `SETTLE_MS` after the last keystroke.
 */
export function simulateTyping(input: HTMLInputElement, text: string, intervalMs = 70): Promise<void> {
  return new Promise((resolve) => {
    let index = 0
    input.focus()
    setNativeValue(input, '')
    const step = () => {
      index += 1
      const char = text.charAt(index - 1)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }))
      setNativeValue(input, text.slice(0, index))
      if (index < text.length) {
        window.setTimeout(step, intervalMs)
      } else {
        window.setTimeout(resolve, SETTLE_MS)
      }
    }
    window.setTimeout(step, intervalMs)
  })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
