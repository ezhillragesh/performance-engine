import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initPerfEngine } from '../../core/index'

let session = initPerfEngine({
  trackEvents: true,
  trackNetwork: true,
  trackRenders: true,
  analysisIntervalMs: 2000,
  onInsights: (insights) => {
    if (insights.length === 0) {
      return
    }

    window.postMessage(
      {
        source: 'perf-engine',
        type: 'INSIGHTS_UPDATE',
        payload: insights,
        timestamp: performance.now(),
      },
      '*',
    )

    window.postMessage(
      {
        source: 'perf-engine',
        type: 'EVENTS_UPDATE',
        payload: session.getEvents(),
        timestamp: performance.now(),
      },
      '*',
    )

    console.log('[perf-insights]', insights)
  },
})

window.postMessage(
  {
    source: 'perf-engine',
    type: 'EVENTS_UPDATE',
    payload: session.getEvents(),
    timestamp: performance.now(),
  },
  '*',
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
