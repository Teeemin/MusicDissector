import type { PlaybackState } from '../types/audio'
import { readMetadata } from '../metadata/MetadataReader'
import { mixerStore } from '../mixer/mixerStore'
import { analysisStore } from '../analysis/analysisStore'
import { chordStore } from '../analysis/chordStore'
import { separationStore } from '../separation/separationStore'
import { StemAudioEngine } from './StemAudioEngine'

const initialState: PlaybackState = {
  mode: 'original',
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

/** One published timeline: streamed original or synchronized stems on one context. */
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
  private stems: StemAudioEngine | null = null
  private ticker: ReturnType<typeof setInterval> | null = null
  private mixerUnsubscribe: (() => void) | null = null
  private transportGeneration = 0

  getSnapshot = (): PlaybackState => this.state

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private update(patch: Partial<PlaybackState>) {
    this.state = { ...this.state, ...patch }
    if (patch.volume !== undefined || patch.muted !== undefined) this.stems?.setVolume(this.state.volume, this.state.muted)
    this.listeners.forEach((listener) => listener())
  }

  private createAudio() {
    if (this.audio) return this.audio
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.addEventListener('loadedmetadata', () => this.readDuration())
    audio.addEventListener('durationchange', () => this.readDuration())
    audio.addEventListener('timeupdate', () => { if (this.state.mode === 'original') this.update({ currentTime: audio.currentTime }) })
    audio.addEventListener('canplay', () => this.update({ isLoading: false, isBuffering: false, isReady: true }))
    audio.addEventListener('playing', () => { if (this.state.mode === 'original') this.update({ isPlaying: true, isStarting: false, isBuffering: false }) })
    audio.addEventListener('waiting', () => { if (this.state.mode === 'original') this.update({ isBuffering: true }) })
    audio.addEventListener('pause', () => { if (this.state.mode === 'original') this.update({ isPlaying: false, isBuffering: false }) })
    audio.addEventListener('ended', () => { if (this.state.mode === 'original') this.update({ isPlaying: false, isStarting: false, currentTime: audio.duration }) })
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
    this.pause()
    this.releaseStems()
    separationStore.clear()
    this.generation++
    analysisStore.clear()
    chordStore.clear()
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
    separationStore.selectFile(file, this.generation)
    if (!this.mixerUnsubscribe) this.mixerUnsubscribe = mixerStore.subscribe(() => {
      const mix = mixerStore.getSnapshot()
      if (mix.separationStatus === 'ready') this.stems?.updateMix(mix)
      else if (this.stems || this.state.mode === 'stems') {
        const time = this.stems?.currentTime ?? this.state.currentTime
        this.pause(); this.releaseStems()
        this.update({ mode: 'original' })
        if (this.audio && this.state.isReady) this.audio.currentTime = time
      }
    })
    analysisStore.selectFile(file, this.generation)
    chordStore.selectFile(file, this.generation)
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
    const transport = ++this.transportGeneration
    const mode = this.state.mode
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
      if (generation !== this.generation || transport !== this.transportGeneration) return
      if (mode === 'stems') {
        this.ensureStems()
        const time = this.state.currentTime >= this.state.duration ? 0 : this.state.currentTime
        this.stems!.play(time)
        this.update({ isPlaying: true, isStarting: false, isBuffering: false, currentTime: time })
        if (this.ticker) clearInterval(this.ticker)
        this.ticker = setInterval(() => {
          if (!this.stems || this.state.mode !== 'stems') return
          const currentTime = this.stems.currentTime
          if (currentTime >= this.stems.duration) {
            this.stems.pause(); if (this.ticker) clearInterval(this.ticker); this.ticker = null
            this.update({ currentTime: this.state.duration, isPlaying: false })
          }
          else this.update({ currentTime })
        }, 50)
        return
      }
      if (audio.ended || audio.currentTime >= this.state.duration) audio.currentTime = 0
      await audio.play()
      if (this.state.mode !== 'original') audio.pause()
    } catch {
      if (generation === this.generation && transport === this.transportGeneration) {
        this.update({ error: '재생을 시작하지 못했어요. 재생 버튼을 다시 누르거나 다른 파일을 선택해 주세요.', isPlaying: false })
      }
    } finally {
      if (generation === this.generation && transport === this.transportGeneration) this.update({ isStarting: false })
    }
  }

  pause() {
    this.transportGeneration++
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
    if (this.state.mode === 'stems' && this.stems) this.update({ currentTime: this.stems.pause() })
    this.audio?.pause()
    this.update({ isPlaying: false, isStarting: false, isBuffering: false })
  }

  private ensureStems() {
    const mix = mixerStore.getSnapshot()
    if (!this.context || mix.trackId !== this.state.track?.id || mix.separationStatus !== 'ready') throw new Error('Stems unavailable')
    if (!this.stems) this.stems = new StemAudioEngine(this.context, mix)
    this.stems.setVolume(this.state.volume, this.state.muted)
  }

  private releaseStems() {
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null; this.stems?.dispose(); this.stems = null
  }

  async setMode(mode: 'original' | 'stems') {
    if (mode === this.state.mode || !this.state.track) return
    if (mode === 'stems' && mixerStore.getSnapshot().separationStatus !== 'ready') return
    const playing = this.state.isPlaying || this.state.isStarting
    const time = this.state.mode === 'stems' ? this.stems?.currentTime ?? this.state.currentTime : this.audio?.currentTime ?? 0
    this.pause()
    this.update({ mode, currentTime: time })
    if (mode === 'original' && this.audio) this.audio.currentTime = time
    if (playing) await this.play()
  }

  seek(seconds: number) {
    if (!this.audio || !this.state.isReady || !Number.isFinite(seconds)) return
    const time = Math.max(0, Math.min(seconds, this.state.duration))
    if (this.state.mode === 'stems') {
      this.stems?.seek(time)
      if (time >= this.state.duration) this.update({ isPlaying: false })
    } else this.audio.currentTime = time
    this.update({ currentTime: time })
  }

  skip(seconds: number) { this.seek((this.state.mode === 'stems' ? this.stems?.currentTime ?? this.state.currentTime : this.audio?.currentTime ?? 0) + seconds) }

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
    this.pause(); this.releaseStems(); separationStore.clear()
    this.mixerUnsubscribe?.(); this.mixerUnsubscribe = null
    analysisStore.clear()
    chordStore.clear()
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
