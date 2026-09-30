import { ProjectDatabase } from './projectDatabase'
import { PROJECT_DIRECTORY, PROJECT_LOCK, PROJECT_VERSION, mixerSettings, validMixer, validProject, validProjectId } from './projectTypes'
import type { LoadedProject, MixerSettings, ProjectEntry, ProjectProgress, ProjectRecord, StoredStem } from './projectTypes'
import { STEM_DEFINITIONS } from '../mixer/mixerTypes'
import type { StemChannels, StemId } from '../mixer/mixerTypes'
import type { LocalTrack } from '../types/audio'
import type { MusicAnalysisResult } from '../analysis/analysisTypes'
import { validResult } from '../analysis/analysisTypes'
import { lyricsText } from '../lyrics/LyricsParser'
import { restoreStem, storeStem } from './stemStorage'

export interface SaveProjectInput { track: LocalTrack; original: File; channels: StemChannels; duration: number; analysis: MusicAnalysisResult | null }
export const projectStorageSupported = () => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory && !!navigator.locks?.request && typeof indexedDB !== 'undefined'
const directory = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(PROJECT_DIRECTORY, { create: true })
const isMissing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError'

/** Cross-tab lock + durable journal bridge OPFS and IDB (which cannot share a transaction). */
export class ProjectRepository {
  private db = new ProjectDatabase()
  private locked<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!projectStorageSupported()) return Promise.reject(new Error('이 브라우저에서는 로컬 프로젝트 저장을 지원하지 않습니다.'))
    return navigator.locks.request(PROJECT_LOCK, { mode: 'exclusive', ...(signal ? { signal } : {}) }, action)
  }
  private async clean(id: string) {
    if (validProjectId(id)) {
      try { await (await directory()).removeEntry(id, { recursive: true }) }
      catch (error) { if (!isMissing(error)) throw error }
    }
    // Keep the journal if file removal failed; next refresh/restart retries it.
    await this.db.forget(id)
  }
  private async recover() {
    const failures = new Set<string>()
    for (const job of await this.db.jobs()) {
      try { await this.clean(job.id) } catch { failures.add(job.id) }
    }
    const records = await this.db.all()
    const ids = new Set(records.map(value => (value as { id: string }).id))
    const dir = await directory()
    // Only our UUID directories; never traverse or touch the model cache.
    for await (const [id] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (validProjectId(id) && !ids.has(id) && !failures.has(id)) {
        try { await dir.removeEntry(id, { recursive: true }) } catch { failures.add(id) }
      }
    }
    return { records, failures }
  }
  async list(): Promise<ProjectEntry[]> {
    return this.locked(async () => {
      const { records, failures } = await this.recover()
      const entries: ProjectEntry[] = []
      for (const value of records) {
        const raw = value as Partial<ProjectRecord>
        if (typeof raw.id !== 'string') continue
        let issue: string | null = validProject(value) ? null : '지원하지 않거나 손상된 프로젝트입니다.'
        if (failures.has(raw.id)) issue = '파일 정리를 완료하지 못했습니다. 삭제를 다시 시도해 주세요.'
        if (!issue && validProject(value)) {
          try {
            const dir = await (await directory()).getDirectoryHandle(value.id)
            for (const part of [{ file: 'original.audio', bytes: value.originalBytes }, ...Object.values(value.stems), ...(value.artwork ? [{ file: 'artwork', bytes: value.artwork.bytes }] : [])]) {
              if ((await (await dir.getFileHandle(part.file)).getFile()).size !== part.bytes) throw new Error('size')
            }
          } catch { issue = '일부 저장 파일이 없거나 손상되었습니다. 삭제 후 다시 저장해 주세요.' }
        }
        entries.push({ id: raw.id, title: typeof raw.title === 'string' ? raw.title : '읽을 수 없는 프로젝트', artist: typeof raw.artist === 'string' ? raw.artist : null, savedAt: Number.isFinite(raw.savedAt) ? raw.savedAt! : 0, bytes: Number.isFinite(raw.bytes) ? raw.bytes! : 0, issue })
      }
      for (const id of failures) if (!entries.some(e => e.id === id)) entries.push({ id, title: '미완료 저장', artist: null, savedAt: 0, bytes: 0, issue: '파일 정리가 필요합니다. 삭제를 다시 시도해 주세요.' })
      return entries.sort((a, b) => b.savedAt - a.savedAt)
    })
  }
  async save(input: SaveProjectInput, signal: AbortSignal, progress: (value: ProjectProgress) => void) {
    return this.locked(async () => {
      signal.throwIfAborted()
      await this.recover()
      const { track, original, channels } = input
      for (const { id } of STEM_DEFINITIONS) if (!channels[id].source) throw new Error('저장할 6개 stem이 준비되지 않았습니다.')
      let artwork: Blob | null = null
      if (track.artworkUrl) {
        artwork = await (await fetch(track.artworkUrl, { signal })).blob()
        if (artwork.size > 128 * 1024 ** 2 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'].includes(artwork.type)) artwork = null
      }
      const worstCase = STEM_DEFINITIONS.reduce((size, { id }) => size + channels[id].source!.buffer.length * channels[id].source!.buffer.numberOfChannels * 4 + 1048576, original.size + (artwork?.size ?? 0))
      const estimate = await navigator.storage.estimate?.().catch(() => null)
      if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < worstCase * 1.1) throw new Error('저장 공간이 부족합니다. 저장된 곡을 삭제한 뒤 다시 시도해 주세요.')
      const id = `p-${crypto.randomUUID()}`
      const now = Date.now()
      const record: ProjectRecord = {
        id, version: PROJECT_VERSION, appVersion: '0.1.0', title: track.name, artist: track.artist, album: track.album, duration: input.duration,
        originalFilename: original.name, originalType: original.type, originalLastModified: original.lastModified, originalBytes: original.size,
        savedAt: now, updatedAt: now, bytes: original.size + (artwork?.size ?? 0), artwork: artwork ? { type: artwork.type, bytes: artwork.size } : null,
        lyrics: lyricsText(track.lyrics), analysis: validResult(input.analysis) ? input.analysis : null,
        stems: {} as Record<StemId, StoredStem>, mixer: mixerSettings(channels),
      }
      await this.db.journal({ id, kind: 'writing' })
      try {
        const dir = await (await directory()).getDirectoryHandle(id, { create: true })
        await original.stream().pipeTo(await (await dir.getFileHandle('original.audio', { create: true })).createWritable(), { signal })
        if (artwork) await artwork.stream().pipeTo(await (await dir.getFileHandle('artwork', { create: true })).createWritable(), { signal })
        for (const [index, { id: stem, label }] of STEM_DEFINITIONS.entries()) {
          signal.throwIfAborted(); progress({ completed: index, total: 6, label: `${label} 저장 중` })
          record.stems[stem] = await storeStem(dir, stem, channels[stem].source!.buffer, signal)
          record.bytes += record.stems[stem].bytes
        }
        signal.throwIfAborted()
        if (!validProject(record)) throw new Error('프로젝트 데이터가 올바르지 않습니다.')
        await this.db.commit(record)
        progress({ completed: 6, total: 6, label: '저장 완료' })
        return record
      } catch (error) {
        try { await this.clean(id) } catch { throw new Error('저장에 실패했고 임시 파일 정리가 남았습니다. 목록 새로고침 또는 삭제로 다시 정리해 주세요.') }
        throw error
      }
    }, signal)
  }
  async load(id: string, signal: AbortSignal, progress: (value: ProjectProgress) => void): Promise<LoadedProject> {
    return this.locked(async () => {
      await this.recover(); signal.throwIfAborted()
      const record = await this.db.get(id)
      if (!validProject(record)) throw new Error('지원하지 않거나 손상된 프로젝트입니다. 기존 세션을 유지합니다.')
      const dir = await (await directory()).getDirectoryHandle(record.id)
      const originalFile = await (await dir.getFileHandle('original.audio')).getFile()
      if (originalFile.size !== record.originalBytes) throw new Error('저장된 원본 파일이 없거나 손상되었습니다.')
      const original = new File([originalFile], record.originalFilename, { type: record.originalType, lastModified: record.originalLastModified })
      let artwork: Blob | null = null
      if (record.artwork) {
        const file = await (await dir.getFileHandle('artwork')).getFile()
        if (file.size !== record.artwork.bytes) throw new Error('저장된 앨범 이미지가 손상되었습니다.')
        artwork = new Blob([file], { type: record.artwork.type })
      }
      const result: LoadedProject['result'] = { kind: 'separated', processed: true, stems: {} as LoadedProject['result']['stems'] }
      for (const [index, { id: stem, label }] of STEM_DEFINITIONS.entries()) {
        progress({ completed: index, total: 6, label: `${label} 불러오는 중` })
        result.stems[stem] = { kind: 'buffer', buffer: await restoreStem(dir, record.stems[stem], signal) }
      }
      signal.throwIfAborted()
      return { record, original, artwork, result }
    }, signal)
  }
  async updateMixer(id: string, mixer: MixerSettings) {
    return this.locked(async () => {
      const record = await this.db.get(id)
      if (!validProject(record) || !validMixer(mixer) || (await this.db.jobs()).some(job => job.id === id)) throw new Error('이 프로젝트를 갱신할 수 없습니다. 목록을 새로고침해 주세요.')
      await this.db.commit({ ...record, mixer, updatedAt: Date.now() })
    })
  }
  async remove(id: string) {
    return this.locked(async () => { await this.db.journal({ id, kind: 'deleting' }); await this.clean(id) })
  }
}
