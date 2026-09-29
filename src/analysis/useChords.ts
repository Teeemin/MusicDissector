import { useSyncExternalStore } from 'react'
import { chordStore } from './chordStore'
import { usePlayback } from '../stores/playbackStore'

export function useChords() {
  const state = useSyncExternalStore(chordStore.subscribe, chordStore.getSnapshot)
  const { track } = usePlayback()
  return { ...state, result: state.trackId === track?.id ? state.result : null }
}
