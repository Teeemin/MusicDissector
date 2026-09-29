import type { PlaybackState } from '../types/audio'
import { readMetadata } from '../metadata/MetadataReader'
import { mixerStore } from '../mixer/mixerStore'

const initialState: PlaybackState = {
  track: null,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  isLoading: false,
  isStarting: false,
  isBuffering: false,
  isReady: false,
  volume: 1,
  muted: false,
  error: null,
}

/** One media timeline. Stream local files without decoding a whole song into RAM. */
export class AudioEngine {
  private audio: HTMLAudioElement | null = null
  private context: AudioContext | null = null
  private source: MediaElementAudioSourceNode | null = null
  private objectUrl: string | null = null
  private artworkUrl: string | null = null
  private metadataAbort: AbortController | null = null
  private generation = 0
  private state: PlaybackState = initialState
  private listeners = new Set<() => void>()

  getSnapshot = (): PlaybackState => this.state

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private update(patch: Partial<PlaybackState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  private createAudio() {
    if (this.audio) return this.audio
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.addEventListener('loadedmetadata', () => this.readDuration())
    audio.addEventListener('durationchange', () => this.readDuration())
    audio.addEventListener('timeupdate', () => this.update({ currentTime: audio.currentTime }))
    audio.addEventListener('canplay', () => this.update({ isLoading: false, isBuffering: false, isReady: true }))
    audio.addEventListener('playing', () => this.update({ isPlaying: true, isStarting: false, isBuffering: false }))
    audio.addEventListener('waiting', () => this.update({ isBuffering: true }))
    audio.addEventListener('pause', () => this.update({ isPlaying: false, isBuffering: false }))
    audio.addEventListener('ended', () => this.update({ isPlaying: false, isStarting: false, currentTime: audio.duration }))
    audio.addEventListener('volumechange', () => this.update({ volume: audio.volume, muted: audio.muted }))
    audio.addEventListener('error', () => {
      if (!audio.error || !this.objectUrl) return
      this.update({
        isLoading: false, isStarting: false, isPlaying: false, isBuffering: false, isReady: false,
        error: '이 파일을 재생할 수 없어요. 파일이 손상되었거나 브라우저가 지원하지 않는 코덱일 수 있어요. 다른 파일을 선택해 주세요.',
      })
    })
    this.audio = audio
    return audio
  }

  private readDuration() {
    const duration = this.audio?.duration ?? 0
    if (Number.isFinite(duration) && duration > 0) {
      this.update({ duration, isReady: true, isLoading: false })
    }
  }

  /** Validate first so a rejected file never interrupts the current song. */
  loadFile(file: File): string | null {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!['mp3', 'wav', 'flac', 'm4a'].includes(extension)) {
      return 'MP3, WAV, FLAC, M4A 파일을 선택해 주세요.'
    }
    if (file.size === 0) return '빈 파일은 재생할 수 없어요. 다른 음악 파일을 선택해 주세요.'

    const nextUrl = URL.createObjectURL(file)
    this.generation++
    this.clearMetadata()
    const audio = this.createAudio()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = nextUrl
    this.update({
      ...initialState,
      volume: audio.volume,
      muted: audio.muted,
      isLoading: true,
      track: {
        id: this.generation,
        name: file.name.replace(/\.[^.]+$/, '') || file.name,
        fileName: file.name,
        format: extension.toUpperCase(),
        size: file.size,
        artist: null,
        album: null,
        metadataDuration: null,
        artworkUrl: null,
        metadataStatus: 'loading',
        lyrics: { kind: 'none' },
      },
    })
    audio.src = nextUrl
    audio.load()
    this.metadataAbort = new AbortController()
    void this.loadMetadata(file, this.generation, this.metadataAbort.signal)
    mixerStore.selectFile(file, this.generation)
    return null
  }

  private clearMetadata() {
    this.metadataAbort?.abort()
    this.metadataAbort = null
    if (this.artworkUrl) URL.revokeObjectURL(this.artworkUrl)
    this.artworkUrl = null
  }

  private async loadMetadata(file: File, generation: number, signal: AbortSignal) {
    try {
      const metadata = await readMetadata(file, signal)
      if (signal.aborted || generation !== this.generation || !this.state.track) return
      if (metadata.artwork) {
        this.artworkUrl = URL.createObjectURL(new Blob([metadata.artwork.data], { type: metadata.artwork.format }))
      }
      this.update({ track: {
        ...this.state.track,
        name: metadata.title ?? this.state.track.name,
        artist: metadata.artist,
        album: metadata.album,
        metadataDuration: metadata.duration,
        artworkUrl: this.artworkUrl,
        metadataStatus: 'ready',
        lyrics: metadata.lyrics,
      } })
    } catch {
      if (!signal.aborted && generation === this.generation && this.state.track) {
        this.update({ track: { ...this.state.track, metadataStatus: 'unavailable' } })
      }
    }
  }

  async play() {
    const audio = this.audio
    if (!audio || !this.state.isReady || this.state.isStarting) return
    const generation = this.generation
    this.update({ isStarting: true, error: null })
    try {
      // Create and resume in the user's play gesture (mobile autoplay policy).
      // Basic playback still works on browsers without Web Audio support.
      if ('AudioContext' in window && !this.context) {
        this.context = new AudioContext()
        this.source = this.context.createMediaElementSource(audio)
        this.source.connect(this.context.destination)
      }
      if (this.context?.state === 'suspended') await this.context.resume()
      if (generation !== this.generation) return
      if (audio.ended || audio.currentTime >= this.state.duration) audio.currentTime = 0
      await audio.play()
    } catch {
      if (generation === this.generation) {
        this.update({ error: '재생을 시작하지 못했어요. 재생 버튼을 다시 누르거나 다른 파일을 선택해 주세요.', isPlaying: false })
      }
    } finally {
      if (generation === this.generation) this.update({ isStarting: false })
    }
  }

  pause() { this.audio?.pause() }

  seek(seconds: number) {
    if (!this.audio || !this.state.isReady || !Number.isFinite(seconds)) return
    const time = Math.max(0, Math.min(seconds, this.state.duration))
    this.audio.currentTime = time
    this.update({ currentTime: time })
  }

  skip(seconds: number) { this.seek((this.audio?.currentTime ?? 0) + seconds) }

  setVolume(volume: number) {
    if (!this.audio) return
    this.audio.volume = Math.max(0, Math.min(1, volume))
    this.audio.muted = false
  }

  toggleMute() {
    if (this.audio) this.audio.muted = !this.audio.muted
  }

  dispose() {
    this.generation++
    mixerStore.clear()
    this.clearMetadata()
    if (this.audio) {
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
    }
    this.source?.disconnect()
    if (this.context) void this.context.close().catch(() => {})
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.audio = null
    this.context = null
    this.source = null
    this.objectUrl = null
    this.update(initialState)
  }
}

export const audioEngine = new AudioEngine()
