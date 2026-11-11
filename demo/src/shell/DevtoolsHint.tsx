import { TerminalIcon } from './Icons'

const POPOVER_ID = 'devtools-hint'

/** Uses the native Popover API: light-dismiss, Escape and focus handling come for free. */
export function DevtoolsHint() {
  return (
    <>
      <button
        type="button"
        className="icon-button"
        popoverTarget={POPOVER_ID}
        aria-label="How to open the Perf Intelligence panel"
        title="Open DevTools"
      >
        <TerminalIcon />
      </button>
      <div id={POPOVER_ID} popover="auto" className="popover">
        <p className="popover__title">Open the diagnosis panel</p>
        <ol className="popover__steps">
          <li>
            Open DevTools (<kbd>F12</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> or <kbd>⌥⌘I</kbd>).
          </li>
          <li>
            Select the <strong>Perf Intelligence</strong> tab.
          </li>
          <li>Run a scenario — insights stream in live.</li>
        </ol>
        <p className="popover__foot">
          Extension not installed?{' '}
          <a href="#about" onClick={(event) => event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()}>
            See About
          </a>
          .
        </p>
      </div>
    </>
  )
}
