import { useSyncExternalStore } from 'react'
import { mixerStore } from './mixerStore'

export function useMixer() {
  return useSyncExternalStore(mixerStore.subscribe, mixerStore.getSnapshot)
}
