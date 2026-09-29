export const STEM_DEFINITIONS = [
  { id: 'vocals', label: 'Vocals' },
  { id: 'guitar', label: 'Guitar' },
  { id: 'piano', label: 'Piano' },
  { id: 'drums', label: 'Drums' },
  { id: 'bass', label: 'Bass' },
  { id: 'others', label: 'Others' },
] as const

export type StemId = typeof STEM_DEFINITIONS[number]['id']

export interface StemAudioSource {
  kind: 'buffer'
  buffer: AudioBuffer
}

export interface StemChannelState {
  id: StemId
  label: string
  volume: number // Linear gain, 0..1; independent of the original player's volume.
  muted: boolean
  solo: boolean
  source: StemAudioSource | null
  status: 'unprocessed' | 'loading' | 'ready' | 'error'
  error: string | null
}

export type StemChannels = Record<StemId, StemChannelState>

export interface MixerState {
  trackId: number | null
  channels: StemChannels
  separationStatus: 'idle' | 'preparing' | 'unprocessed' | 'ready' | 'error'
  error: string | null
}

export const MIXER_PRESETS = [
  { id: 'original', label: 'Original' },
  { id: 'vocal-only', label: 'Vocal Only' },
  { id: 'no-vocal', label: 'No Vocal' },
  { id: 'no-guitar', label: 'No Guitar' },
  { id: 'no-piano', label: 'No Piano' },
] as const

export type MixerPresetId = typeof MIXER_PRESETS[number]['id']
