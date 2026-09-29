import { ANALYSIS_VERSION, validResult } from './analysisTypes'
import type { MusicAnalysisResult } from './analysisTypes'

export interface AnalysisCache {
  get(key: string): Promise<MusicAnalysisResult | null>
  put(key: string, result: MusicAnalysisResult, signal: AbortSignal): Promise<void>
}

/** One-way cleanup only; the retired database is never opened or recreated. */
export function removeLegacyChordCache() {
  try {
    const request = indexedDB.deleteDatabase('music-dissector-chords')
    request.onerror = () => { /* Storage restrictions must not block playback. */ }
  } catch { /* IndexedDB may be unavailable in private/restricted contexts. */ }
}

/** Hash at most 192 KiB plus identity, not an entire multi-hundred-MB file. */
export async function fingerprint(file: File, version = ANALYSIS_VERSION): Promise<string> {
  const size = 65536
  const positions = [...new Set([0, Math.max(0, Math.floor(file.size / 2) - size / 2), Math.max(0, file.size - size)])]
  const parts = await Promise.all(positions.map((start) => file.slice(start, start + size).arrayBuffer()))
  const identity = new TextEncoder().encode(JSON.stringify([file.name, file.size, file.lastModified]))
  const bytes = new Uint8Array(identity.length + parts.reduce((sum, part) => sum + part.byteLength, 0))
  bytes.set(identity)
  let offset = identity.length
  for (const part of parts) { bytes.set(new Uint8Array(part), offset); offset += part.byteLength }
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `${version}:${Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')}`
}

export class IndexedAnalysisCache implements AnalysisCache {
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('music-dissector-analysis', 2)
      let expired = false
      const timer = setTimeout(() => { expired = true; reject(new Error('Cache open timed out')) }, 2000)
      request.onupgradeneeded = () => {
        // v1 mixed Key/BPM records are disposable: rebuild BPM-only results.
        if (request.result.objectStoreNames.contains('results')) request.result.deleteObjectStore('results')
        request.result.createObjectStore('results')
      }
      request.onsuccess = () => {
        clearTimeout(timer)
        if (expired) request.result.close()
        else { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
      }
      request.onerror = () => { clearTimeout(timer); reject(request.error) }
      request.onblocked = () => { expired = true; clearTimeout(timer); reject(new Error('Cache unavailable')) }
    })
  }
  async get(key: string): Promise<MusicAnalysisResult | null> {
    const db = await this.open()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('results', 'readonly')
        const request = tx.objectStore('results').get(key)
        const timer = setTimeout(() => tx.abort(), 2000)
        tx.oncomplete = () => { clearTimeout(timer); resolve(validResult(request.result) ? request.result : null) }
        tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(tx.error ?? new Error('Cache read failed')) }
      })
    } finally { db.close() }
  }
  async put(key: string, result: MusicAnalysisResult, signal: AbortSignal): Promise<void> {
    if (!validResult(result)) throw new Error('Invalid analysis result')
    signal.throwIfAborted()
    const db = await this.open()
    try {
      signal.throwIfAborted()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('results', 'readwrite')
        const abort = () => tx.abort()
        const timer = setTimeout(abort, 2000)
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
        signal.addEventListener('abort', abort, { once: true })
        tx.objectStore('results').put(result, key)
        tx.oncomplete = () => { cleanup(); resolve() }
        tx.onabort = tx.onerror = () => { cleanup(); reject(tx.error ?? new Error('Cache write failed')) }
      })
    } finally { db.close() }
  }
}
