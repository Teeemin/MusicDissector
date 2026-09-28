export interface LocalTrack {
  name: string
  fileName: string
  format: string
  size: number
}

export interface PlaybackState {
  track: LocalTrack | null
  currentTime: number
  duration: number
  isPlaying: boolean
  isLoading: boolean
  isStarting: boolean
  isBuffering: boolean
  isReady: boolean
  volume: number
  muted: boolean
  error: string | null
}
