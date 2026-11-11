// IMPORT ORDER MATTERS: './perf' must stay first. It calls instrumentReact(),
// which installs the React DevTools global hook that react-dom registers with
// when it is evaluated below. Moving it later silently disables per-component
// render tracking.
import './perf'
import { startTransition, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startMockApi } from './lib/api'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/shell.css'
import './styles/workspace.css'
import './styles/lab.css'
import './styles/about.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing')

// Production builds answer `api/*` from a Service Worker; render once it controls the page.
// The first render is a transition so React yields while mounting all three pages, instead
// of one long task that the engine would (correctly) report on page load.
void startMockApi().then(() => {
  const reactRoot = createRoot(root)
  startTransition(() => {
    reactRoot.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
})

