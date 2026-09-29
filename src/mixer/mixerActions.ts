import { audioEngine } from '../audio/AudioEngine'
import { mixerStore } from './mixerStore'
import type { MixerPresetId, StemId } from './mixerTypes'

/** A mixer gesture auditions available stems; state-only updates never switch playback. */
function audition(change: () => void) {
  change()
  const mixer = mixerStore.getSnapshot()
  if (mixer.separationStatus === 'ready' && mixer.trackId === audioEngine.getSnapshot().track?.id) {
    void audioEngine.setMode('stems')
  }
}

export const mixerActions = {
  setVolume: (id: StemId, volume: number) => audition(() => mixerStore.setVolume(id, volume)),
  toggleMute: (id: StemId) => audition(() => mixerStore.toggleMute(id)),
  toggleSolo: (id: StemId) => audition(() => mixerStore.toggleSolo(id)),
  applyPreset: (id: MixerPresetId) => audition(() => mixerStore.applyPreset(id)),
}
