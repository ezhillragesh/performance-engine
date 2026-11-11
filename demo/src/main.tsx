// IMPORT ORDER MATTERS: './perf' must stay first. It calls instrumentReact(),
// which installs the React DevTools global hook that react-dom registers with
// when it is evaluated below. Moving it later silently disables per-component
// render tracking.
import './perf'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/shell.css'
import './styles/workspace.css'
import './styles/lab.css'
import './styles/about.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

