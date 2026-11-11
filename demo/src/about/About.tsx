const PIPELINE = [
  {
    name: 'Trackers',
    text: 'DOM interactions, fetch/XHR, long animation frames, Event Timing latency, Web Vitals and per-instance React renders via instrumentReact().',
  },
  {
    name: 'Trace context',
    text: 'A click or keystroke opens a causal trace. Work started inside it, including network responses, keeps the same traceId. App actions get named traces with trackAction(): this demo names its tab switches that way.',
  },
  {
    name: 'Analyzer',
    text: 'Rules run over each trace window every 1.5s and emit insights with evidence, confidence, impact and a suggested fix.',
  },
  {
    name: 'DevTools bridge',
    text: 'Built into core. Streams snapshots only while a panel is attached, so there is zero overhead with DevTools closed.',
  },
  {
    name: 'Extension',
    text: 'The Perf Intelligence panel renders insights, traces, budgets and the session health score.',
  },
]

const SHORTCUTS: Array<[string, string]> = [
  ['1 · 2 · 3', 'Switch between Workspace, Scenario Lab and About'],
  ['← →', 'Move between the section tabs once one has focus'],
  ['/', 'Focus the inbox search'],
  ['Esc', 'Clear the search, or close the DevTools popover'],
]

export function About() {
  return (
    <div className="page about">
      <header className="page-header">
        <div className="page-header__text">
          <p className="eyebrow">About</p>
          <h1 className="page-title">How the demo works</h1>
          <p className="page-lede">
            Northstar is two things: a calm, reasonably fast workspace that acts as the control surface, and a lab of
            deliberate performance problems for the engine to diagnose.
          </p>
        </div>
      </header>

      <section className="about-section" aria-labelledby="about-pipeline">
        <h2 id="about-pipeline" className="section-title">
          Architecture
        </h2>
        <ol className="pipeline">
          {PIPELINE.map((step, index) => (
            <li key={step.name} className="pipeline__step">
              <span className="pipeline__index tabular" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <p className="pipeline__name">{step.name}</p>
                <p className="pipeline__text">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="about-columns">
        <section className="card about-card" aria-labelledby="about-install">
          <h2 id="about-install" className="section-title">
            Load the extension
          </h2>
          <ol className="steps">
            <li>
              Open <code>chrome://extensions</code>.
            </li>
            <li>
              Turn on <strong>Developer mode</strong> (top right).
            </li>
            <li>
              Click <strong>Load unpacked</strong> and select the <code>extension/</code> folder of this repository.
            </li>
            <li>
              Reload this page, open DevTools and choose the <strong>Perf Intelligence</strong> tab.
            </li>
          </ol>
          <p className="text-secondary about-note">
            Render durations come from React’s profiler timing. <code>npm run dev</code> and the default production build
            (React’s profiling bundle) both record them; a build with <code>DEMO_REACT_PROFILING=0</code> does not, so its
            slow-component card says it cannot fire.
          </p>
        </section>

        <section className="card about-card" aria-labelledby="about-keys">
          <h2 id="about-keys" className="section-title">
            Keyboard
          </h2>
          <dl className="shortcuts">
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys} className="shortcuts__row">
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  )
}
