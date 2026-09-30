import { PROJECT_DATABASE } from './projectTypes'
import type { ProjectRecord } from './projectTypes'
export interface ProjectJob { id: string; kind: 'writing' | 'deleting' }

export class ProjectDatabase {
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(PROJECT_DATABASE, 1)
      let expired = false
      const timer = setTimeout(() => { expired = true; reject(new Error('프로젝트 저장소가 응답하지 않습니다. 다른 탭을 닫고 다시 시도해 주세요.')) }, 4000)
      request.onblocked = () => { expired = true; clearTimeout(timer); reject(new Error('프로젝트 저장소가 다른 탭에서 사용 중입니다.')) }
      request.onupgradeneeded = () => {
        request.result.createObjectStore('projects', { keyPath: 'id' })
        request.result.createObjectStore('jobs', { keyPath: 'id' })
      }
      request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else { request.result.onversionchange = () => request.result.close(); resolve(request.result) } }
      request.onerror = () => { clearTimeout(timer); reject(request.error) }
    })
  }
  private async run<T>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction) => () => T): Promise<T> {
    const db = await this.open()
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(stores, mode)
        const result = action(tx)
        tx.oncomplete = () => resolve(result())
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('프로젝트 저장소 작업에 실패했습니다.'))
      })
    } finally { db.close() }
  }
  all(): Promise<unknown[]> { return this.run(['projects'], 'readonly', tx => { const r = tx.objectStore('projects').getAll(); return () => r.result }) }
  get(id: string): Promise<unknown> { return this.run(['projects'], 'readonly', tx => { const r = tx.objectStore('projects').get(id); return () => r.result }) }
  jobs(): Promise<ProjectJob[]> { return this.run(['jobs'], 'readonly', tx => { const r = tx.objectStore('jobs').getAll(); return () => r.result }) }
  journal(job: ProjectJob) { return this.run(['jobs'], 'readwrite', tx => { tx.objectStore('jobs').put(job); return () => {} }) }
  commit(record: ProjectRecord) {
    return this.run(['projects', 'jobs'], 'readwrite', tx => { tx.objectStore('projects').put(record); tx.objectStore('jobs').delete(record.id); return () => {} })
  }
  forget(id: string) {
    return this.run(['projects', 'jobs'], 'readwrite', tx => { tx.objectStore('projects').delete(id); tx.objectStore('jobs').delete(id); return () => {} })
  }
}
