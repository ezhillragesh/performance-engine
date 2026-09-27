import { useSyncExternalStore } from 'react'
import { isHeavyMode, subscribeHeavyMode } from './busyWork'

/** Whether the opt-in Workspace "Heavy mode" (toggled from the Scenario Lab) is on. */
export function useHeavyMode(): boolean {
  return useSyncExternalStore(subscribeHeavyMode, isHeavyMode, isHeavyMode)
}
