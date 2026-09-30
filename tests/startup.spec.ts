import { expect, test } from '@playwright/test'
import { taggedWav } from './fixtures/audio'
import { fakeInference, supported } from './fixtures/separationHarness'
import { MODEL } from '../src/separation/separationTypes'
import { PROJECT_DATABASE, PROJECT_DIRECTORY, PROJECT_LOCK } from '../src/projects/projectTypes'

test.use({ serviceWorkers: 'block' })

interface StartupGate {
  recoveryEntered: boolean
  estimateEntered: boolean
  releaseRecovery: () => void
  releaseEstimate: () => void
}

test('first selection survives late database recovery, orphan cleanup, list refresh and storage estimate', async ({ page, context }) => {
  test.setTimeout(60_000)
  await supported(page)
  await fakeInference(page)
  // Each Playwright test gets a fresh context. Seed persisted disk data before
  // the app reads it; do not reload the page or select a second file.
  const cdp = await context.newCDPSession(page)
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: 'http://127.0.0.1:4173', quotaSize: 2 * 1024 ** 3 })
  await cdp.detach()
  const writingId = 'p-00000000-0000-4000-8000-000000000001'
  const orphanId = 'p-00000000-0000-4000-8000-000000000002'
  const retainedId = 'p-00000000-0000-4000-8000-000000000003'
  await page.addInitScript(({ model, database, directory, lockName, writingId, orphanId, retainedId }) => {
    const gate: StartupGate = { recoveryEntered: false, estimateEntered: false, releaseRecovery: () => {}, releaseEstimate: () => {} }
    const recovery = new Promise<void>(resolve => { gate.releaseRecovery = resolve })
    const estimate = new Promise<void>(resolve => { gate.releaseEstimate = resolve })
    Object.assign(window, { startupGate: gate })
    const request = navigator.locks.request.bind(navigator.locks)
    navigator.locks.request = ((name: string, options: LockOptions | LockGrantedCallback, callback?: LockGrantedCallback) => {
      const action = typeof options === 'function' ? options : callback!
      return request(name, typeof options === 'function' ? {} : options, async lock => {
        if (name === lockName && !gate.recoveryEntered) { gate.recoveryEntered = true; await recovery }
        return action(lock)
      })
    }) as typeof navigator.locks.request
    const nativeEstimate = navigator.storage.estimate.bind(navigator.storage)
    navigator.storage.estimate = async () => {
      if (!gate.estimateEntered) { gate.estimateEntered = true; await estimate }
      return nativeEstimate()
    }
    const getDirectory = navigator.storage.getDirectory.bind(navigator.storage)
    let seeded: Promise<FileSystemDirectoryHandle> | undefined
    navigator.storage.getDirectory = () => seeded ??= (async () => {
      const root = await getDirectory()
      // Same sparse model fixture as phase6 tests; inference alone is mocked.
      const models = await root.getDirectoryHandle('music-dissector-models', { create: true })
      const key = `${model.revision}-${model.file}`
      const file = await (await models.getFileHandle(key, { create: true })).createWritable()
      await file.truncate(model.bytes); await file.close()
      const marker = await (await models.getFileHandle(`${key}.json`, { create: true })).createWritable()
      await marker.write(JSON.stringify({ size: model.bytes, revision: model.revision })); await marker.close()
      const projects = await root.getDirectoryHandle(directory, { create: true })
      for (const id of [writingId, orphanId, retainedId]) await projects.getDirectoryHandle(id, { create: true })
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(database, 1)
        r.onupgradeneeded = () => {
          r.result.createObjectStore('projects', { keyPath: 'id' })
          r.result.createObjectStore('jobs', { keyPath: 'id' })
        }
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
      })
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['projects', 'jobs'], 'readwrite')
          tx.objectStore('jobs').put({ id: writingId, kind: 'writing' })
          // An unknown schema is listed as unavailable, never auto-deleted.
          tx.objectStore('projects').put({ id: retainedId, version: 999, title: '이전 저장 항목', savedAt: 1, bytes: 0 })
          tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error)
        })
      } finally { db.close() }
      return root
    })()
  }, { model: MODEL, database: PROJECT_DATABASE, directory: PROJECT_DIRECTORY, lockName: PROJECT_LOCK, writingId, orphanId, retainedId })

  let documents = 0
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) documents++ })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => (window as unknown as { startupGate: StartupGate }).startupGate.recoveryEntered)).toBe(true)
  await expect(page.getByText('모델 설치됨 · 약 336 MiB', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '목록 새로고침' })).toBeDisabled()
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ title: '최신 사용자 선택', artist: '첫 가수', album: '첫 앨범', artwork: true }, 'first-selection.wav', 12))
  const title = page.getByRole('heading', { name: '최신 사용자 선택', exact: true })
  await expect(title).toBeVisible()
  await expect(page.locator('.track-artist')).toHaveText('첫 가수')
  await expect(page.locator('.track-album')).toHaveText('첫 앨범')
  await expect(page.locator('.track-artwork')).toBeVisible()
  const artwork = await page.locator('.track-artwork').getAttribute('src')
  await expect(page.locator('.analysis-status')).toContainText(/분석 완료|확인하지 못했습니다/, { timeout: 30_000 })
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(.2)

  await page.evaluate(() => (window as unknown as { startupGate: StartupGate }).startupGate.releaseRecovery())
  await expect.poll(() => page.evaluate(() => (window as unknown as { startupGate: StartupGate }).startupGate.estimateEntered)).toBe(true)
  await expect(title).toBeVisible()
  await expect(page.getByRole('button', { name: '일시 정지', exact: true })).toBeVisible()
  await page.evaluate(() => (window as unknown as { startupGate: StartupGate }).startupGate.releaseEstimate())
  await expect(page.getByRole('button', { name: '목록 새로고침' })).toBeEnabled()
  await expect(page.getByRole('article', { name: '이전 저장 항목' })).toBeVisible()
  await expect(page.locator('.track-artwork')).toHaveAttribute('src', artwork!)
  await expect(title).toBeVisible()
  await page.getByRole('button', { name: '일시 정지', exact: true }).click()
  await page.getByLabel('재생 위치').fill('2')
  await expect(page.getByLabel('재생 위치')).toHaveValue('2')

  const disk = await page.evaluate(async directory => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(directory)
    const names: string[] = []
    for await (const [name] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) names.push(name)
    return names
  }, PROJECT_DIRECTORY)
  expect(disk).toEqual([retainedId])
  await page.getByRole('button', { name: '분리 시작', exact: true }).click()
  await expect(page.locator('.separation-status')).toContainText('분리 완료', { timeout: 20_000 })
  await expect(page.getByRole('button', { name: '분리 결과 저장', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Stem Mix', exact: true }).click()
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(2.2)
  await expect(title).toBeVisible()
  expect(documents).toBe(1)
})
