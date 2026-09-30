import { MockStemSeparationEngine } from '../separation/MockStemSeparationEngine'
import type { StemSeparationEngine } from '../separation/StemSeparationEngine'
import type { StemResult } from '../separation/StemSeparationEngine'
import { createChannels, withPreset } from './mixerRules'
import { STEM_DEFINITIONS } from './mixerTypes'
import type { MixerPresetId, MixerState, StemId } from './mixerTypes'
import type { MixerSettings } from '../projects/projectTypes'

const initialState = (): MixerState => ({ trackId: null, channels: createChannels(), separationStatus: 'idle', error: null })

export class MixerStore {
  private state = initialState()
  private listeners = new Set<() => void>()
  private abort: AbortController | null = null
  private engine: StemSeparationEngine

  constructor(engine: StemSeparationEngine = new MockStemSeparationEngine()) { this.engine = engine }

  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private update(state: MixerState) {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }

  selectFile(file: File, trackId: number) {
    this.abort?.abort()
    const controller = new AbortController()
    this.abort = controller
    this.update({ ...initialState(), trackId, separationStatus: 'preparing' })
    void this.prepare(file, controller)
  }

  private async prepare(file: File, controller: AbortController) {
    try {
      const result = await this.engine.separate(file, { signal: controller.signal })
      if (controller.signal.aborted || this.abort !== controller) return
      const channels = { ...this.state.channels }
      for (const { id } of STEM_DEFINITIONS) {
        channels[id] = { ...channels[id], source: result.stems[id], status: result.processed ? 'ready' : 'unprocessed', error: null }
      }
      this.update({ ...this.state, channels, separationStatus: result.processed ? 'ready' : 'unprocessed' })
    } catch {
      if (controller.signal.aborted || this.abort !== controller) return
      this.update({ ...this.state, separationStatus: 'error', error: '믹서 설정을 준비하지 못했어요. 다른 파일을 선택해 다시 시도해 주세요.' })
    }
  }

  setVolume(id: StemId, volume: number) {
    if (this.state.trackId === null || !Number.isFinite(volume)) return
    const channels = this.state.channels
    this.update({ ...this.state, channels: { ...channels, [id]: { ...channels[id], volume: Math.min(1, Math.max(0, volume)) } } })
  }

  setSeparated(result: Extract<StemResult, { processed: true }>, trackId: number) {
    if (this.state.trackId !== trackId) return false
    this.abort?.abort()
    const channels = { ...this.state.channels }
    for (const { id } of STEM_DEFINITIONS) channels[id] = { ...channels[id], source: result.stems[id], status: 'ready', error: null }
    this.update({ ...this.state, channels, separationStatus: 'ready', error: null })
    return true
  }

  restoreProject(result: Extract<StemResult, { processed: true }>, settings: MixerSettings, trackId: number) {
    this.abort?.abort()
    this.abort = null
    const channels = createChannels()
    for (const { id } of STEM_DEFINITIONS) channels[id] = {
      ...channels[id], volume: settings[id].volume, muted: settings[id].muted, solo: settings[id].solo,
      source: result.stems[id], status: 'ready',
    }
    this.update({ trackId, channels, separationStatus: 'ready', error: null })
  }

  clearSources(trackId: number) {
    if (this.state.trackId !== trackId) return
    this.abort?.abort()
    const channels = { ...this.state.channels }
    for (const { id } of STEM_DEFINITIONS) channels[id] = { ...channels[id], source: null, status: 'unprocessed' }
    this.update({ ...this.state, channels, separationStatus: 'unprocessed' })
  }

  toggleMute(id: StemId) { this.toggle(id, 'muted') }
  toggleSolo(id: StemId) { this.toggle(id, 'solo') }

  private toggle(id: StemId, property: 'muted' | 'solo') {
    if (this.state.trackId === null) return
    const channels = this.state.channels
    this.update({ ...this.state, channels: { ...channels, [id]: { ...channels[id], [property]: !channels[id][property] } } })
  }

  applyPreset(id: MixerPresetId) {
    if (this.state.trackId !== null) this.update({ ...this.state, channels: withPreset(this.state.channels, id) })
  }

  clear() {
    this.abort?.abort()
    this.abort = null
    this.update(initialState())
  }
}

export const mixerStore = new MixerStore()
