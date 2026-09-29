import { ChordAnalysisEngine } from './ChordAnalysisEngine'
import { fingerprint, IndexedResultCache } from './analysisCache'
import type { ResultCache } from './analysisCache'
import { analysisStore } from './analysisStore'
import { CHORD_ENGINE_VERSION, validChordResult } from './chordTypes'
import type { ChordAnalysisResult, ChordEngine, ChordState } from './chordTypes'

/** Avoid two whole-song jobs competing on mobile; both reuse the decode pipeline. */
export function waitForMusicAnalysis(trackId: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { unsubscribe(); signal.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    const check = () => {
      const state = analysisStore.getSnapshot()
      if (state.trackId !== trackId || ['complete', 'error', 'idle'].includes(state.status)) { cleanup(); resolve() }
    }
    const unsubscribe = analysisStore.subscribe(check)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort(); else check()
  })
}
const idle = (): ChordState => ({ trackId: null, status: 'idle', result: null, cached: false })
export class ChordStore {
  private state = idle()
  private file: File | null = null
  private controller: AbortController | null = null
  private listeners = new Set<() => void>()
  private engine: ChordEngine
  private cache: ResultCache<ChordAnalysisResult>
  private identify: (file: File) => Promise<string>
  private wait: typeof waitForMusicAnalysis
  constructor(engine: ChordEngine = new ChordAnalysisEngine(), cache: ResultCache<ChordAnalysisResult> = new IndexedResultCache('music-dissector-chords', validChordResult),
    identify = (file: File) => fingerprint(file, CHORD_ENGINE_VERSION), wait = waitForMusicAnalysis) {
    this.engine = engine; this.cache = cache; this.identify = identify; this.wait = wait
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<ChordState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()) }
  selectFile(file: File, trackId: number) { this.file = file; void this.run(file, trackId, false) }
  reanalyze = () => { if (this.file && this.state.trackId !== null) void this.run(this.file, this.state.trackId, true) }
  clear() { this.controller?.abort(); this.controller = null; this.file = null; this.update(idle()) }
  private async run(file: File, trackId: number, force: boolean) {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    const { signal } = controller
    const current = () => !signal.aborted && this.controller === controller
    this.update({ ...idle(), trackId, status: 'waiting' })
    try {
      const key = await this.identify(file).catch(() => null)
      if (!current()) return
      if (key && !force) {
        const result = await this.cache.get(key).catch(() => null)
        if (!current()) return
        if (validChordResult(result)) { this.update({ result, status: 'complete', cached: true }); return }
      }
      await this.wait(trackId, signal)
      if (!current()) return
      const result = await this.engine.analyze(file, { signal, onStage: (status) => { if (current()) this.update({ status }) } })
      if (!current()) return
      if (!validChordResult(result)) throw new Error('Invalid chord result')
      this.update({ result, status: 'complete', cached: false })
      if (key) await this.cache.put(key, result, signal).catch(() => {})
    } catch { if (current()) this.update({ result: null, status: 'error', cached: false }) }
  }
}
export const chordStore = new ChordStore()
