import { audioEngine } from '../audio/AudioEngine'
import { mixerStore } from '../mixer/mixerStore'
import { analysisStore } from '../analysis/analysisStore'
import { ProjectRepository, projectStorageSupported } from './ProjectRepository'
import { mixerSettings } from './projectTypes'
import type { ProjectEntry, ProjectProgress } from './projectTypes'

interface Binding { id: string; trackId: number; buffer: WeakRef<AudioBuffer> }
interface State {
  entries: ProjectEntry[]
  busy: 'save' | 'load' | 'update' | 'delete' | 'refresh' | null
  progress: ProjectProgress | null
  message: string | null
  error: string | null
  usage: number | null
  quota: number | null
  persistent: boolean | null
  binding: Binding | null
}
export class ProjectStore {
  private state: State = { entries: [], busy: null, progress: null, message: null, error: null, usage: null, quota: null, persistent: null, binding: null }
  private repository = new ProjectRepository()
  private listeners = new Set<() => void>()
  private job: AbortController | null = null
  private initialized = false
  private persistenceAttempted = false
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()) }
  private progress = (progress: ProjectProgress) => this.update({ progress })
  private bind(id: string) {
    const mix = mixerStore.getSnapshot()
    const buffer = mix.channels.vocals.source?.buffer
    this.update({ binding: mix.trackId !== null && buffer ? { id, trackId: mix.trackId, buffer: new WeakRef(buffer) } : null })
  }
  currentId() {
    const { binding } = this.state
    const mix = mixerStore.getSnapshot()
    return binding && binding.trackId === audioEngine.getSnapshot().track?.id && mix.separationStatus === 'ready' && binding.buffer.deref() === mix.channels.vocals.source?.buffer ? binding.id : null
  }
  private async readList() {
    const entries = await this.repository.list()
    const estimate = await navigator.storage.estimate?.().catch(() => null)
    this.update({ entries, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null })
  }
  initialize = () => { if (!this.initialized) { this.initialized = true; void this.refresh() } }
  refresh = async () => {
    if (this.state.busy || !projectStorageSupported()) return
    this.update({ busy: 'refresh', error: null })
    try { await this.readList() } catch { this.update({ error: '저장된 목록을 읽지 못했습니다. 목록 새로고침으로 다시 시도해 주세요.' }) }
    finally { this.update({ busy: null }) }
  }
  cancel = () => this.job?.abort()
  private async sessionJob(kind: 'save' | 'load', operation: (signal: AbortSignal, releaseGuard: () => void) => Promise<void>) {
    if (this.state.busy) return
    const controller = new AbortController(); this.job = controller
    const trackId = audioEngine.getSnapshot().track?.id
    const source = mixerStore.getSnapshot().channels.vocals.source
    const check = () => { if (audioEngine.getSnapshot().track?.id !== trackId || mixerStore.getSnapshot().channels.vocals.source !== source) controller.abort() }
    const unsubAudio = audioEngine.subscribe(check); const unsubMixer = mixerStore.subscribe(check)
    const release = () => { unsubAudio(); unsubMixer() }
    this.update({ busy: kind, message: null, error: null, progress: { completed: 0, total: 6, label: kind === 'save' ? '저장 준비 중' : '불러오기 준비 중' } })
    try { await operation(controller.signal, release) }
    catch (error) {
      this.update(controller.signal.aborted ? { message: '작업을 취소했습니다.' } : { error: error instanceof DOMException && error.name === 'QuotaExceededError' ? '저장 공간이 부족합니다. 저장된 곡을 삭제한 뒤 다시 시도해 주세요.' : error instanceof RangeError ? '프로젝트를 불러올 메모리가 부족합니다. 다른 탭을 닫은 뒤 다시 시도해 주세요.' : error instanceof Error ? error.message : '프로젝트 작업에 실패했습니다.' })
    } finally {
      release(); this.job = null
      await this.readList().catch(() => this.update({ error: '목록을 갱신하지 못했습니다. 목록 새로고침을 눌러 주세요.' }))
      this.update({ busy: null, progress: null })
    }
  }
  save = async () => {
    const state = audioEngine.getSnapshot(); const mix = mixerStore.getSnapshot(); const original = audioEngine.getOriginalFile()
    if (!state.track || !original || mix.separationStatus !== 'ready' || mix.trackId !== state.track.id) return
    const track = state.track
    const analysis = analysisStore.getSnapshot()
    await this.sessionJob('save', async signal => {
      if (!this.persistenceAttempted) {
        this.persistenceAttempted = true
        const persistent = await navigator.storage.persist?.().catch(() => false) ?? null
        this.update({ persistent })
      }
      signal.throwIfAborted()
      const record = await this.repository.save({ track, original, channels: mix.channels, duration: state.duration, analysis: analysis.trackId === track.id ? analysis.result : null }, signal, this.progress)
      // Save captured settings only. Any edits made during storage remain unsaved.
      if (!signal.aborted) this.bind(record.id)
      const fallback = Object.values(record.stems).some(stem => stem.format === 'wav-float32')
      this.update({ message: fallback ? '분리 결과를 저장했습니다. 일부 stem은 원본 정밀도를 유지하는 WAV로 저장했습니다.' : '분리 결과를 FLAC으로 저장했습니다.' })
    })
  }
  load = async (id: string) => {
    await this.sessionJob('load', async (signal, releaseGuard) => {
      const loaded = await this.repository.load(id, signal, this.progress)
      signal.throwIfAborted()
      releaseGuard()
      const error = audioEngine.loadFile(loaded.original, loaded)
      if (error) throw new Error(error)
      this.bind(id)
      this.update({ message: '저장된 분리 결과를 불러왔습니다. Stem Mix에서 재생할 수 있어요.' })
    })
  }
  updateMixer = async () => {
    const id = this.currentId()
    if (!id || this.state.busy) return
    const settings = mixerSettings(mixerStore.getSnapshot().channels)
    this.update({ busy: 'update', error: null, message: null })
    try { await this.repository.updateMixer(id, settings); this.update({ message: '현재 믹서 설정을 저장했습니다. 오디오 파일은 그대로 유지됩니다.' }) }
    catch (error) { this.update({ error: error instanceof Error ? error.message : '설정 저장에 실패했습니다.' }) }
    finally { this.update({ busy: null }) }
  }
  remove = async (id: string) => {
    if (this.state.busy) return
    this.update({ busy: 'delete', error: null, message: null })
    const active = this.currentId() === id || audioEngine.getSnapshot().track?.projectId === id
    if (active) audioEngine.pause()
    try {
      await this.repository.remove(id)
      if (active && (this.currentId() === id || audioEngine.getSnapshot().track?.projectId === id)) audioEngine.dispose()
      if (this.state.binding?.id === id) this.update({ binding: null })
      this.update({ message: '저장된 분리 결과를 삭제했습니다.' })
    } catch { this.update({ error: '삭제를 완료하지 못했습니다. 다시 삭제하거나 목록을 새로고침해 주세요.' }) }
    finally { await this.readList().catch(() => {}); this.update({ busy: null }) }
  }
}
export const projectStore = new ProjectStore()
