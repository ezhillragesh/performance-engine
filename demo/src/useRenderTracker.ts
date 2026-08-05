import { useRef } from 'react'
import { trackRender } from '../../core/index'

function hashValue(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Records a render event on every commit with optional props snapshot
 * for wasted-render detection.
 */
export function useRenderTracker(componentName: string, propsSnapshot?: unknown): void {
  const prevHashRef = useRef<string | undefined>(undefined)
  const propsHash = propsSnapshot !== undefined ? hashValue(propsSnapshot) : undefined
  const prevPropsHash = prevHashRef.current

  trackRender(componentName, 0, propsHash, prevPropsHash)

  if (propsHash !== undefined) {
    prevHashRef.current = propsHash
  }
}
