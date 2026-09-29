import type { LyricsDocument } from '../lyrics/types'

export interface LocalTrack {
  id: number
  name: string
  fileName: string
  format: string
  size: number
  artist: string | null
  album: string | null
  metadataDuration: number | null
  artworkUrl: string | null
  metadataStatus: 'loading' | 'ready' | 'unavailable'
  lyrics: LyricsDocument
}

export interface PlaybackState {
  mode: 'original' | 'stems'
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
