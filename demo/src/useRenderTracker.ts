import { useEffect, useRef } from 'react'
import { trackRender } from '../../core/index'

function hashValue(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Records a render event after every commit with an optional props
 * snapshot for wasted-render detection.
 *
 * Runs inside an effect (not during render) so it stays correct under
 * React StrictMode double-rendering and concurrent rendering, and never
 * reads or writes refs during render.
 */
export function useRenderTracker(componentName: string, propsSnapshot?: unknown): void {
  const prevHashRef = useRef<string | undefined>(undefined)
  const propsHash = propsSnapshot !== undefined ? hashValue(propsSnapshot) : undefined

  useEffect(() => {
    const prevPropsHash = prevHashRef.current
    trackRender(componentName, 0, propsHash, prevPropsHash)
    prevHashRef.current = propsHash
  })
}
