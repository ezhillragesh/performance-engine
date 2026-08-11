import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initPerfEngine } from '../../core/index'
import type { PerfEngineSession } from '../../core/index'
import type { Insight } from '../../core/types/insights'
import type { TrackedEvent } from '../../core/types/events'

declare global {
  interface Window {
    __perfSession?: PerfEngineSession
  }
}

function publish(type: 'INSIGHTS_UPDATE' | 'EVENTS_UPDATE', payload: Insight[] | TrackedEvent[]) {
  window.postMessage(
    {
      source: 'perf-engine',
      type,
      payload,
      timestamp: performance.now(),
    },
    '*',
  )
}

const session = initPerfEngine({
  trackEvents: true,
  trackNetwork: true,
  trackRenders: true,
  analysisIntervalMs: 2000,
  onInsights: () => {
    const insights = session.getInsights()
    if (insights.length === 0) {
      return
    }

    publish('INSIGHTS_UPDATE', insights)
    publish('EVENTS_UPDATE', session.getEvents())
    console.log('[perf-insights]', insights)
  },
})

window.__perfSession = session

// Publish events periodically so the DevTools panel stays in sync even
// when no new insights arrive (e.g. dedupe window or panel opened late).
window.setInterval(() => {
  publish('EVENTS_UPDATE', session.getEvents())

  const insights = session.getInsights()
  if (insights.length > 0) {
    publish('INSIGHTS_UPDATE', insights)
  }
}, 3000)

publish('EVENTS_UPDATE', session.getEvents())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
