import { audioEngine } from '../audio/AudioEngine'
import { mixerStore } from '../mixer/mixerStore'
import { projectStore } from '../projects/projectStore'
import { captureMix, mixFilename } from './mixSnapshot'
import { renderMix } from './renderMix'
import { downloadMix } from './downloadMix'
import { MixExportError } from './exportTypes'
import type { ExportErrorCode, ExportStage } from './exportTypes'

interface State { busy: boolean; stage: ExportStage; error: ExportErrorCode | null; message: string | null }
class ExportStore {
  private state: State = { busy: false, stage: 'idle', error: null, message: null }
  private listeners = new Set<() => void>()
  private generation = 0
  private job: AbortController | null = null
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()) }
  cancel = () => this.job?.abort(new MixExportError('cancelled'))

  start = async () => {
    if (this.job) return
    const generation = ++this.generation
    const controller = new AbortController(); this.job = controller
    const { signal } = controller
    let unsubscribeAudio = () => {}; let unsubscribeMixer = () => {}; let unsubscribeProjects = () => {}
    this.update({ busy: true, stage: 'mixing', error: null, message: null })
    try {
      const snapshot = captureMix(audioEngine.getSnapshot().track, mixerStore.getSnapshot())
      const checkSession = () => {
        const mix = mixerStore.getSnapshot()
        if (projectStore.getSnapshot().busy === 'load'
          || audioEngine.getSnapshot().track?.id !== snapshot.trackId || mix.trackId !== snapshot.trackId
          || snapshot.stems.some(stem => mix.channels[stem.id].source?.buffer !== stem.buffer)) {
          controller.abort(new MixExportError('session-changed'))
        }
      }
      unsubscribeAudio = audioEngine.subscribe(checkSession)
      unsubscribeMixer = mixerStore.subscribe(checkSession)
      // Loading a project expresses a new session intent before its FLAC decode
      // completes. List refresh/recovery/save never invalidate the current mix.
      unsubscribeProjects = projectStore.subscribe(checkSession)
      checkSession(); signal.throwIfAborted()
      let artwork: Blob | null = null
      if (snapshot.artworkUrl) {
        try { artwork = await (await fetch(snapshot.artworkUrl, { signal })).blob() }
        catch { signal.throwIfAborted() /* Optional artwork may be unavailable. */ }
      }
      const rendered = await renderMix(snapshot.stems, signal)
      signal.throwIfAborted()
      this.update({ stage: 'encoding' })
      const encoder = await import('./mp3Encoder').catch(() => { throw new MixExportError('encoder-init') })
      signal.throwIfAborted()
      const blob = await encoder.encodeMp3(rendered, snapshot, artwork, signal)
      checkSession(); signal.throwIfAborted()
      this.update({ stage: 'download' })
      signal.throwIfAborted()
      downloadMix(blob, mixFilename(snapshot.title))
      this.update({ message: 'MP3 다운로드를 시작했습니다.' })
    } catch (error) {
      const reason = signal.aborted ? signal.reason : error
      if (generation === this.generation) this.update({ error: reason instanceof MixExportError ? reason.code : 'encoding' })
    } finally {
      unsubscribeAudio(); unsubscribeMixer(); unsubscribeProjects()
      if (generation === this.generation) { this.job = null; this.update({ busy: false, stage: 'idle' }) }
    }
  }
}
export const exportStore = new ExportStore()
