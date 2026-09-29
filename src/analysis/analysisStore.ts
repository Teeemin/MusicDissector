import { MusicAnalysisEngine } from './MusicAnalysisEngine'
import { fingerprint, IndexedAnalysisCache } from './analysisCache'
import type { AnalysisCache } from './analysisCache'
import { validResult } from './analysisTypes'
import type { AnalysisEngine, AnalysisState } from './analysisTypes'

const idle = (): AnalysisState => ({ trackId: null, status: 'idle', stage: null, result: null, cached: false })
export class AnalysisStore {
  private state = idle()
  private listeners = new Set<() => void>()
  private controller: AbortController | null = null
  private file: File | null = null
  private engine: AnalysisEngine
  private cache: AnalysisCache
  private identify: typeof fingerprint
  constructor(engine: AnalysisEngine = new MusicAnalysisEngine(), cache: AnalysisCache = new IndexedAnalysisCache(), identify = fingerprint) {
    this.engine = engine; this.cache = cache; this.identify = identify
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<AnalysisState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  selectFile(file: File, trackId: number) {
    this.file = file
    void this.run(file, trackId, false)
  }
  reanalyze = () => {
    if (this.file && this.state.trackId !== null) void this.run(this.file, this.state.trackId, true)
  }
  clear() {
    this.controller?.abort()
    this.controller = null
    this.file = null
    this.update(idle())
  }
  private async run(file: File, trackId: number, force: boolean) {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    const { signal } = controller
    const current = () => !signal.aborted && this.controller === controller
    this.update({ ...idle(), trackId, status: 'decoding', stage: 'decoding' })
    try {
      const key = await this.identify(file).catch(() => null)
      if (!current()) return
      if (key && !force) {
        const result = await this.cache.get(key).catch(() => null)
        if (!current()) return
        if (validResult(result)) { this.update({ status: 'complete', stage: null, result, cached: true }); return }
      }
      const result = await this.engine.analyze(file, { signal, onStage: (stage) => {
        if (current()) this.update({ stage, status: stage === 'decoding' ? 'decoding' : 'analyzing' })
      } })
      if (!current()) return
      if (!validResult(result)) throw new Error('Invalid result')
      this.update({ status: 'complete', stage: null, result, cached: false })
      if (key) await this.cache.put(key, result, signal).catch(() => {})
    } catch {
      if (current()) this.update({ status: 'error', stage: null, result: null, cached: false })
    }
  }
}
export const analysisStore = new AnalysisStore()
