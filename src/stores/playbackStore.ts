import { useSyncExternalStore } from 'react'
import { audioEngine } from '../audio/AudioEngine'

export function usePlayback() {
  return useSyncExternalStore(audioEngine.subscribe, audioEngine.getSnapshot)
}
