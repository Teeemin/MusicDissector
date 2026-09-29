import { MODEL, SeparationError } from './separationTypes'
const DIRECTORY = 'music-dissector-models'
const KEY = `${MODEL.revision}-${MODEL.file}`
const getDir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(DIRECTORY, { create: true })
export interface ModelStorage {
  ready(): Promise<boolean>
  download(signal: AbortSignal, progress: (loaded: number, total: number) => void): Promise<void>
  read(): Promise<File>
  remove(): Promise<void>
}
/** Versioned OPFS model + completion marker; partial downloads are never accepted. */
export class OPFSModelCache implements ModelStorage {
  async ready() {
    try {
      const dir = await getDir()
      const file = await (await dir.getFileHandle(KEY)).getFile()
      const marker = JSON.parse(await (await (await dir.getFileHandle(`${KEY}.json`)).getFile()).text())
      return file.size === MODEL.bytes && marker.revision === MODEL.revision && marker.size === MODEL.bytes
    } catch { return false }
  }
  async read() {
    if (!await this.ready()) throw new SeparationError('model-load')
    return (await (await getDir()).getFileHandle(KEY)).getFile()
  }
  async remove() {
    const dir = await getDir()
    for (const key of [KEY, `${KEY}.json`, `${KEY}.part`]) {
      try { await dir.removeEntry(key) } catch (e) { if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e }
    }
  }
  async download(signal: AbortSignal, progress: (loaded: number, total: number) => void) {
    signal.throwIfAborted()
    if (await this.ready()) { progress(MODEL.bytes, MODEL.bytes); return }
    const estimate = await navigator.storage.estimate()
    if (estimate.quota && estimate.quota - (estimate.usage ?? 0) < MODEL.bytes * 2.1) throw new SeparationError('memory')
    const dir = await getDir()
    const response = await fetch(MODEL.url, { signal, cache: 'no-store' })
    if (!response.ok || !response.body) throw new SeparationError('download')
    const temp = await dir.getFileHandle(`${KEY}.part`, { create: true })
    const writer = await temp.createWritable()
    const reader = response.body.getReader()
    let loaded = 0
    try {
      for (;;) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        loaded += value.byteLength
        if (loaded > MODEL.bytes) throw new SeparationError('download', 'Unexpected model size')
        await writer.write(value)
        progress(loaded, MODEL.bytes)
      }
      if (loaded !== MODEL.bytes) throw new SeparationError('download', 'Incomplete model')
      await writer.close()
      signal.throwIfAborted()
      // Stream promotion avoids a second 353 MB ArrayBuffer on the UI thread.
      const target = await dir.getFileHandle(KEY, { create: true })
      await (await temp.getFile()).stream().pipeTo(await target.createWritable(), { signal })
      signal.throwIfAborted()
      const marker = await (await dir.getFileHandle(`${KEY}.json`, { create: true })).createWritable()
      await marker.write(JSON.stringify({ revision: MODEL.revision, size: loaded }))
      await marker.close()
    } catch (error) { await writer.abort().catch(() => {}); await this.remove().catch(() => {}); throw error }
    finally { await reader.cancel().catch(() => {}); await dir.removeEntry(`${KEY}.part`).catch(() => {}) }
  }
}
