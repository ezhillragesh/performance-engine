import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initPerfEngine } from '../../core/index'

initPerfEngine({
  trackEvents: true,
  trackNetwork: true,
  trackRenders: true,
  analysisIntervalMs: 2000,
  onInsights: (insights) => {
    if (insights.length === 0) {
      return
    }

    console.log('[perf-insights]', insights)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
