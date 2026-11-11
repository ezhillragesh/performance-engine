import { refreshPerfSnapshot, usePerfSelector } from '../hooks/usePerfSnapshot'
import { session } from '../perf'
import { PauseIcon, PlayIcon, TrashIcon } from './Icons'

// Hoisted elements: React skips re-rendering an element that is referentially
// identical, so the icons do not re-render with every engine tick.
const PAUSE_ICON = <PauseIcon />
const PLAY_ICON = <PlayIcon />
const TRASH_ICON = <TrashIcon />

const GRADE_LABEL: Record<string, string> = {
  good: 'Good',
  'needs-improvement': 'Needs work',
  poor: 'Poor',
}

/**
 * Live engine status. Each value is selected as a primitive, so this only
 * re-renders when a displayed number actually changes.
 */
export function EngineStatus() {
  const paused = usePerfSelector((snapshot) => snapshot.paused)
  const eventCount = usePerfSelector((snapshot) => snapshot.events.length + snapshot.droppedEvents)
  const insightCount = usePerfSelector((snapshot) => snapshot.insights.length)
  const score = usePerfSelector((snapshot) => Math.round(snapshot.summary.score))
  const grade = usePerfSelector((snapshot) => snapshot.summary.grade)

  const togglePaused = () => {
    if (session.isPaused()) session.resume()
    else session.pause()
    refreshPerfSnapshot()
  }

  const clear = () => {
    session.clear()
    refreshPerfSnapshot()
  }

  return (
    <div className="engine">
      <div className="engine-pill" data-state={paused ? 'paused' : 'recording'}>
        <span className="engine-pill__dot" aria-hidden="true" />
        <span className="engine-pill__state">{paused ? 'Paused' : 'Recording'}</span>
        <span className="engine-pill__sep" aria-hidden="true" />
        <span className="engine-pill__metric tabular" title="Events captured this session">
          {eventCount.toLocaleString()} <span className="engine-pill__unit">{eventCount === 1 ? 'event' : 'events'}</span>
        </span>
        <span className="engine-pill__metric engine-pill__metric--wide tabular" title="Current insights">
          {insightCount} <span className="engine-pill__unit">{insightCount === 1 ? 'insight' : 'insights'}</span>
        </span>
        <span className="engine-pill__score tabular" data-grade={grade} title={`Health score · ${GRADE_LABEL[grade] ?? grade}`}>
          {score}
        </span>
      </div>
      <button
        type="button"
        className="icon-button"
        onClick={togglePaused}
        aria-pressed={paused}
        aria-label={paused ? 'Resume recording' : 'Pause recording'}
        title={paused ? 'Resume recording' : 'Pause recording'}
      >
        {paused ? PLAY_ICON : PAUSE_ICON}
      </button>
      <button type="button" className="icon-button" onClick={clear} aria-label="Clear events and insights" title="Clear events and insights">
        {TRASH_ICON}
      </button>
    </div>
  )
}
