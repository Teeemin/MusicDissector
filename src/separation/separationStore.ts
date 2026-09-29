import { BSRoformerWebEngine } from './BSRoformerWebEngine'
import { OPFSModelCache } from './modelCache'
import type { ModelStorage } from './modelCache'
import { detectSeparationCapability } from './capabilities'
import type { SeparationCapability } from './capabilities'
import { MODEL, ERROR_MESSAGES, MAX_SECONDS, classifyError } from './separationTypes'
import type { SeparationProgress, SeparationErrorCode } from './separationTypes'
import type { StemSeparationEngine } from './StemSeparationEngine'
import { mixerStore, MixerStore } from '../mixer/mixerStore'
import { analysisStore } from '../analysis/analysisStore'
import { chordStore } from '../analysis/chordStore'

export interface SeparationState extends SeparationProgress {
  trackId: number | null
  capability: SeparationCapability | null
  model: 'checking' | 'not-downloaded' | 'downloading' | 'ready' | 'error'
  loaded: number
  error: string | null
  errorCode: SeparationErrorCode | null
}
export class SeparationStore {
  private state: SeparationState = { trackId: null, capability: null, model: 'checking', loaded: 0, stage: 'idle', completed: 0, total: 0, error: null, errorCode: null }
  private listeners = new Set<() => void>()
  private file: File | null = null
  private job: AbortController | null = null
  private downloadJob: AbortController | null = null
  private initializing: Promise<void> | null = null
  private engine: StemSeparationEngine
  private cache: ModelStorage
  private mixer: MixerStore
  private detect: typeof detectSeparationCapability
  constructor(engine: StemSeparationEngine = new BSRoformerWebEngine(), cache: ModelStorage = new OPFSModelCache(), mixer: MixerStore = mixerStore, detect = detectSeparationCapability) { this.engine = engine; this.cache = cache; this.mixer = mixer; this.detect = detect }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<SeparationState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l()) }
  initialize = () => {
    if (!this.initializing) this.initializing = Promise.all([this.detect(), this.cache.ready()]).then(([capability, ready]) => {
      this.update({ capability, model: ready ? 'ready' : 'not-downloaded', loaded: ready ? MODEL.bytes : 0 })
    }).catch(() => this.update({ model: 'error' }))
    return this.initializing
  }
  selectFile(file: File, trackId: number) { this.cancel(); this.file = file; this.update({ trackId, stage: 'idle', completed: 0, total: 0, error: null, errorCode: null }) }
  clear() { this.cancel(); this.file = null; this.update({ trackId: null, stage: 'idle', completed: 0, total: 0, error: null, errorCode: null }) }
  cancel = () => { this.job?.abort(); this.job = null; if (!['idle', 'complete', 'error', 'cancelled'].includes(this.state.stage)) this.update({ stage: 'cancelled', error: null, errorCode: 'cancelled' }) }
  download = async () => {
    if (this.downloadJob || this.state.model === 'ready') return
    const controller = new AbortController(); this.downloadJob = controller
    this.update({ model: 'downloading', loaded: 0, error: null, errorCode: null })
    try {
      await this.cache.download(controller.signal, (loaded) => { if (!controller.signal.aborted) this.update({ loaded }) })
      controller.signal.throwIfAborted()
      this.update({ model: 'ready', loaded: MODEL.bytes })
      if (typeof navigator !== 'undefined') void navigator.storage?.persist?.().catch(() => {})
    } catch (error) {
      const code = classifyError(error, 'download')
      this.update({ model: code === 'cancelled' ? 'not-downloaded' : 'error', loaded: 0, errorCode: code, error: code === 'cancelled' ? null : ERROR_MESSAGES[code] })
    } finally { if (this.downloadJob === controller) this.downloadJob = null }
  }
  cancelDownload = () => this.downloadJob?.abort()
  deleteModel = async () => {
    if (this.downloadJob || this.job) return
    try { await this.cache.remove(); this.update({ model: 'not-downloaded', loaded: 0, error: null, errorCode: null }) }
    catch { this.update({ error: '모델 파일을 삭제하지 못했습니다. 다시 시도해 주세요.' }) }
  }
  start = async (duration = 0) => {
    if (!this.file || this.state.trackId === null || this.job || this.state.model !== 'ready') return
    if (!this.state.capability?.supported) { this.update({ stage: 'error', errorCode: 'unsupported', error: ERROR_MESSAGES.unsupported }); return }
    if (duration > MAX_SECONDS || this.file.size > 128 * 1024 * 1024) { this.update({ stage: 'error', errorCode: 'memory', error: ERROR_MESSAGES.memory }); return }
    const controller = new AbortController(); this.job = controller
    const trackId = this.state.trackId
    const current = () => this.job === controller && !controller.signal.aborted && this.state.trackId === trackId
    this.mixer.clearSources(trackId)
    this.update({ stage: 'model-loading', completed: 0, total: 0, error: null, errorCode: null })
    try {
      // Let automatic analysis finish; don't compete with two additional WASM heaps.
      while (['decoding', 'analyzing'].includes(analysisStore.getSnapshot().status) || ['waiting', 'decoding', 'extracting', 'detecting'].includes(chordStore.getSnapshot().status)) {
        await new Promise((r) => setTimeout(r, 100)); controller.signal.throwIfAborted()
      }
      const result = await this.engine.separate(this.file, { signal: controller.signal, onProgress: (progress) => { if (current()) this.update(progress) } })
      if (!current()) return
      if (!result.processed) throw new Error('No separated stems')
      if (this.mixer.setSeparated(result, trackId)) this.update({ stage: 'complete' })
    } catch (error) {
      if (!current()) return
      const code = classifyError(error, 'inference')
      this.update({ stage: code === 'cancelled' ? 'cancelled' : 'error', errorCode: code, error: ERROR_MESSAGES[code] })
    } finally { if (this.job === controller) this.job = null }
  }
}
export const separationStore = new SeparationStore()
