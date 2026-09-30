import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { supported, cacheModel, fakeInference } from './fixtures/separationHarness'
import { taggedWav } from './fixtures/audio'
import { PROJECT_DATABASE, PROJECT_DIRECTORY } from '../src/projects/projectTypes'
import type { ProjectRecord } from '../src/projects/projectTypes'
import { MODEL } from '../src/separation/separationTypes'

test.use({ serviceWorkers: 'block' })
async function records(page: Page) {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    try { return await new Promise<ProjectRecord[]>((resolve, reject) => { const r = db.transaction('projects').objectStore('projects').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) }) }
    finally { db.close() }
  }, PROJECT_DATABASE)
}
async function files(page: Page, id?: string) {
  return page.evaluate(async ({ root, id }) => {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(root)
    if (id) dir = await dir.getDirectoryHandle(id)
    const result = []
    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile()
        result.push({ name, size: file.size, modified: file.lastModified, header: Array.from(new Uint8Array(await file.slice(0, 4).arrayBuffer())) })
      } else result.push({ name, size: 0, modified: 0, header: [] })
    }
    return result.sort((a,b) => a.name.localeCompare(b.name))
  }, { root: PROJECT_DIRECTORY, id })
}
async function prepare(page: Page, title = '저장 테스트', amplitude = .05) {
  await supported(page); await fakeInference(page, 0, amplitude)
  await page.goto('/'); await cacheModel(page)
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ title, artist: '저장 가수', album: '저장 앨범', lyrics: '저장 가사\n다음 줄', artwork: true }, 'project-original.wav', 12))
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '분리 시작', exact: true }).click()
  await expect(page.locator('.separation-status')).toContainText('분리 완료', { timeout: 20000 })
  await expect(page.getByRole('button', { name: '분리 결과 저장', exact: true })).toBeEnabled()
}
async function save(page: Page) {
  await page.getByRole('button', { name: '분리 결과 저장', exact: true }).click()
  await expect(page.getByRole('button', { name: '현재 설정 저장', exact: true })).toBeEnabled({ timeout: 30000 })
  return (await records(page))[0]
}
async function loadSaved(page: Page, title = '저장 테스트') {
  await page.getByRole('article', { name: title, exact: true }).getByRole('button', { name: '불러오기', exact: true }).click()
  await expect(page.getByRole('button', { name: '현재 설정 저장', exact: true })).toBeEnabled({ timeout: 30000 })
  await expect(page.getByRole('button', { name: 'Stem Mix', exact: true })).toHaveAttribute('aria-pressed', 'true')
}

test('explicit FLAC project save, reload without model/inference, real playback, A/B and mixer-only updates', async ({ page }) => {
  let inferences = 0
  page.on('request', request => { if (request.url().includes('stemAudio.worker-')) inferences++ })
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { value: async () => false })
    const start = AudioBufferSourceNode.prototype.start
    Object.assign(window, { projectStarts: [] })
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
      (window as unknown as { projectStarts: object[] }).projectStarts.push({ when, offset, sample: this.buffer!.getChannelData(0)[100], frames: this.buffer!.length })
      if (duration === undefined) start.call(this, when, offset); else start.call(this, when, offset, duration)
    }
  })
  await prepare(page)
  expect(await records(page)).toEqual([])
  expect(await files(page)).toEqual([])
  await expect(page.getByText('분리 결과는 현재 세션에서만 유지됩니다.', { exact: true })).toBeVisible()
  await page.getByRole('slider', { name: 'Guitar 볼륨', exact: true }).fill('0')
  await page.getByRole('slider', { name: 'Piano 볼륨', exact: true }).fill('80')
  await page.getByRole('slider', { name: 'Others 볼륨', exact: true }).fill('90')
  await page.getByRole('button', { name: 'Drums Mute', exact: true }).click()
  for (const name of ['Vocals Solo', 'Piano Solo']) await page.getByRole('button', { name, exact: true }).click()
  const record = await save(page)
  expect(record).not.toHaveProperty('key'); expect(record).not.toHaveProperty('chords')
  expect(Object.values(record.stems).every(stem => stem.format === 'flac-pcm24')).toBe(true)
  const savedFiles = await files(page, record.id)
  expect(savedFiles.filter(f => f.name.endsWith('.flac'))).toHaveLength(6)
  for (const file of savedFiles.filter(f => f.name.endsWith('.flac'))) expect(file.header).toEqual([102, 76, 97, 67])
  expect(record.bytes).toBe(savedFiles.reduce((size, file) => size + file.size, 0))
  expect(record.bytes).toBeLessThan(12 * 44100 * 2 * 4 * 6)
  await expect(page.locator('.project-storage')).toContainText('사용 중')
  await expect(page.locator('.project-save')).toContainText('영구 저장소가 허용되지 않아')
  // No auto-save on mixer edits, including after loading a saved project.
  await page.getByRole('slider', { name: 'Piano 볼륨', exact: true }).fill('20')
  expect((await records(page))[0].mixer.piano.volume).toBe(.8)
  await page.getByRole('button', { name: '모델 삭제', exact: true }).click()
  await page.reload()
  await loadSaved(page)
  expect(inferences).toBe(1)
  await expect(page.locator('.player-panel').getByRole('heading', { name: '저장 테스트', exact: true })).toBeVisible()
  await expect(page.locator('.track-artist')).toHaveText('저장 가수')
  await expect(page.locator('.track-artwork')).toBeVisible()
  await page.getByRole('button', { name: '가사', exact: true }).click()
  await expect(page.locator('.plain-lyrics')).toHaveText('저장 가사\n다음 줄')
  await expect(page.getByRole('slider', { name: 'Piano 볼륨', exact: true })).toHaveValue('80')
  await expect(page.getByRole('slider', { name: 'Guitar 볼륨', exact: true })).toHaveValue('0')
  for (const name of ['Drums Mute', 'Vocals Solo', 'Piano Solo']) await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(.1)
  const starts = await page.evaluate(() => (window as unknown as { projectStarts: { when: number; offset: number; sample: number; frames: number }[] }).projectStarts)
  expect(starts).toHaveLength(6)
  expect(new Set(starts.map(s => s.when)).size).toBe(1)
  for (const [index, modelIndex] of [3, 4, 5, 1, 0, 2].entries()) {
    expect(starts[index].frames).toBe(12 * 44100)
    expect(Math.abs(starts[index].sample - .05 * Math.sin(100 * 2 * Math.PI * (modelIndex + 1) * 110 / 44100))).toBeLessThan(1.3e-7)
  }
  await page.getByRole('button', { name: '일시 정지' }).click()
  await page.getByLabel('재생 위치').fill('5')
  await page.getByRole('group', { name: '재생 소스' }).getByRole('button', { name: 'Original', exact: true }).click()
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(5)
  await page.getByRole('button', { name: '일시 정지' }).click()
  await page.getByRole('slider', { name: 'Piano 볼륨', exact: true }).fill('25')
  await page.getByRole('button', { name: '현재 설정 저장', exact: true }).click()
  await expect(page.locator('.project-save')).toContainText('현재 믹서 설정을 저장했습니다.')
  expect((await records(page))[0].mixer.piano.volume).toBe(.25)
  expect(await files(page, record.id)).toEqual(savedFiles)
  await page.reload(); await loadSaved(page)
  await expect(page.getByRole('slider', { name: 'Piano 볼륨', exact: true })).toHaveValue('25')
  expect(inferences).toBe(1)
})

test('confirmed deletion removes project audio and metadata, stops its session, preserves model cache', async ({ page }) => {
  await prepare(page); const record = await save(page)
  const item = page.getByRole('article', { name: '저장 테스트', exact: true })
  await item.getByRole('button', { name: '삭제', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click()
  expect(await files(page)).toHaveLength(1)
  await item.getByRole('button', { name: '삭제', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '삭제 확인', exact: true }).click()
  await expect(item).toHaveCount(0)
  expect(await records(page)).toEqual([]); expect(await files(page)).toEqual([])
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeDisabled()
  expect(await page.evaluate(async ({ revision, file, bytes }) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('music-dissector-models')
    return (await (await dir.getFileHandle(`${revision}-${file}`)).getFile()).size === bytes
  }, MODEL)).toBe(true)
  expect(record.id).toMatch(/^p-/)
})

test('failed FLAC encoder falls back to real Float32 WAV and remains loadable', async ({ page }) => {
  await page.route('**/flac.worker-*.js', route => route.fulfill({ contentType: 'application/javascript', body: "self.onmessage=()=>self.postMessage({error:'encoder unavailable'})" }))
  await prepare(page); const record = await save(page)
  expect(Object.values(record.stems).every(stem => stem.format === 'wav-float32')).toBe(true)
  const media = await files(page, record.id)
  expect(media.filter(f => f.name.endsWith('.flac'))).toHaveLength(0)
  for (const file of media.filter(f => f.name.endsWith('.wav'))) expect(file.header).toEqual([82, 73, 70, 70])
  await page.reload(); await loadSaved(page)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(0)
})

test('cancelled save rolls back, interrupted writes and orphan directories recover on restart', async ({ page }) => {
  await page.route('**/flac.worker-*.js', route => route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage=()=>{}' }))
  await prepare(page)
  await page.getByRole('button', { name: '분리 결과 저장', exact: true }).click()
  await expect(page.locator('.project-progress')).toContainText('Vocals 저장 중')
  await page.getByRole('button', { name: '프로젝트 작업 취소', exact: true }).click()
  await expect(page.getByRole('button', { name: '분리 결과 저장', exact: true })).toBeEnabled()
  expect(await records(page)).toEqual([]); expect(await files(page)).toEqual([])
  await page.evaluate(async ({ root, database }) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(root)
    const id = `p-${crypto.randomUUID()}`
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open(database); r.onsuccess = () => resolve(r.result) })
    await new Promise<void>(resolve => { const tx = db.transaction('jobs','readwrite'); tx.objectStore('jobs').put({ id, kind: 'writing' }); tx.oncomplete = () => resolve() })
    db.close()
    for (const name of [id, `p-${crypto.randomUUID()}`]) { const partial = await dir.getDirectoryHandle(name, { create: true }); const w = await (await partial.getFileHandle('partial', { create: true })).createWritable(); await w.write('incomplete'); await w.close() }
  }, { root: PROJECT_DIRECTORY, database: PROJECT_DATABASE })
  await page.reload()
  await expect(page.getByRole('button', { name: '목록 새로고침', exact: true })).toBeEnabled()
  expect(await files(page)).toEqual([])
})

test('missing and corrupt projects fail gracefully without replacing the current song', async ({ page }) => {
  await prepare(page); const record = await save(page)
  // Preserve the file size but corrupt the FLAC signature, bypassing list-size checks.
  await page.evaluate(async ({ root, record }) => {
    const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(root)).getDirectoryHandle(record.id)
    const writer = await (await dir.getFileHandle(record.stems.vocals.file)).createWritable({ keepExistingData: true })
    await writer.write({ type: 'write', position: 0, data: new Uint8Array([0,0,0,0]) }); await writer.close()
  }, { root: PROJECT_DIRECTORY, record })
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ title: '유지할 곡' }, 'keep.wav', 3))
  await page.getByRole('article', { name: '저장 테스트', exact: true }).getByRole('button', { name: '불러오기', exact: true }).click()
  await expect(page.locator('.project-error[role=alert]')).toContainText('손상')
  await expect(page.getByRole('heading', { name: '유지할 곡', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  await page.evaluate(async ({ root, record }) => {
    const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(root)).getDirectoryHandle(record.id)
    await dir.removeEntry(record.stems.guitar.file)
  }, { root: PROJECT_DIRECTORY, record })
  await page.getByRole('button', { name: '목록 새로고침', exact: true }).click()
  await expect(page.getByRole('article', { name: '저장 테스트', exact: true }).getByRole('button', { name: '불러오기', exact: true })).toBeDisabled()
})

test('out-of-range stem samples use Float32 WAV without clipping', async ({ page }) => {
  await prepare(page, 'Headroom', 1.25)
  const record = await save(page)
  expect(Object.values(record.stems).every(stem => stem.format === 'wav-float32')).toBe(true)
  const peak = await page.evaluate(async ({ root, record }) => {
    const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(root)).getDirectoryHandle(record.id)
    const file = await (await dir.getFileHandle(record.stems.vocals.file)).getFile()
    const samples = new DataView(await file.slice(44, 44 + 8192).arrayBuffer())
    let peak = 0
    for (let i = 0; i < samples.byteLength; i += 4) peak = Math.max(peak, Math.abs(samples.getFloat32(i, true)))
    return peak
  }, { root: PROJECT_DIRECTORY, record })
  expect(peak).toBeGreaterThan(1.2)
  await page.reload(); await loadSaved(page, 'Headroom')
})

test('quota failure rolls back audio and journal while keeping the session usable', async ({ page }) => {
  await prepare(page)
  await page.evaluate(() => {
    const write = FileSystemWritableFileStream.prototype.write
    FileSystemWritableFileStream.prototype.write = function (data) {
      if (data instanceof Uint8Array) return Promise.reject(new DOMException('Test quota', 'QuotaExceededError'))
      return write.call(this, data)
    }
  })
  await page.getByRole('button', { name: '분리 결과 저장', exact: true }).click()
  await expect(page.locator('.project-error[role=alert]')).toContainText('저장 공간이 부족')
  await expect(page.getByRole('button', { name: '분리 결과 저장', exact: true })).toBeEnabled()
  expect(await records(page)).toEqual([]); expect(await files(page)).toEqual([])
  await page.getByRole('button', { name: 'Stem Mix', exact: true }).click()
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(0)
})

test('failed delete keeps a cleanup journal and recovers after reopening', async ({ page }) => {
  await prepare(page); await save(page)
  await page.evaluate(() => {
    const remove = FileSystemDirectoryHandle.prototype.removeEntry
    FileSystemDirectoryHandle.prototype.removeEntry = function (name, options) {
      if (name.startsWith('p-')) return Promise.reject(new DOMException('Test filesystem failure', 'NotAllowedError'))
      return remove.call(this, name, options)
    }
  })
  await page.getByRole('article', { name: '저장 테스트', exact: true }).getByRole('button', { name: '삭제', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '삭제 확인', exact: true }).click()
  await expect(page.getByRole('article', { name: '저장 테스트', exact: true })).toContainText('정리를 완료하지 못했습니다')
  expect(await files(page)).toHaveLength(1)
  await page.reload()
  await expect(page.getByRole('button', { name: '목록 새로고침', exact: true })).toBeEnabled()
  expect(await records(page)).toEqual([]); expect(await files(page)).toEqual([])
})

test('file replacement cancels a pending save and another tab never reaps its live files', async ({ page, context }) => {
  await page.route('**/flac.worker-*.js', route => route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage=()=>{}' }))
  await prepare(page)
  await page.getByRole('button', { name: '분리 결과 저장', exact: true }).click()
  await expect(page.locator('.project-progress')).toContainText('Vocals 저장 중')
  const second = await context.newPage(); await second.goto('/')
  await expect(second.getByRole('button', { name: '목록 새로고침', exact: true })).toBeDisabled()
  expect(await files(page)).toHaveLength(1)
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ title: '새 세션' }, 'new.wav', 3))
  await expect(page.locator('.project-save')).toContainText('작업을 취소했습니다.')
  await expect(second.getByRole('button', { name: '목록 새로고침', exact: true })).toBeEnabled()
  expect(await files(page)).toEqual([])
  await expect(page.getByRole('heading', { name: '새 세션', exact: true })).toBeVisible()
  await second.close()
})

test('unsupported storage leaves playback available and save disabled', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined }))
  await page.goto('/')
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({}, 'local.wav', 3))
  await expect(page.getByRole('button', { name: '분리 결과 저장', exact: true })).toBeDisabled()
  await expect(page.locator('.project-save')).toContainText('저장을 지원하지 않습니다')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
})

test.describe('offline saved project', () => {
  test.use({ serviceWorkers: 'allow' })
  test('offline reload restores FLAC stems and mixer without an AI model', async ({ page, context }) => {
    // Delay SW installation until the synthetic inference fixture has finished.
    await page.addInitScript(() => {
      const register = ServiceWorkerContainer.prototype.register
      ServiceWorkerContainer.prototype.register = function (url, options) {
        if (!document.documentElement?.dataset.enableSW) return new Promise(() => {})
        return register.call(this, url, options)
      }
    })
    await prepare(page); await save(page)
    await page.getByRole('button', { name: '모델 삭제', exact: true }).click()
    await page.evaluate(async () => { document.documentElement.dataset.enableSW = 'yes'; await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready })
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await context.setOffline(true); await page.reload()
    await loadSaved(page)
    await page.getByRole('button', { name: '재생', exact: true }).click()
    await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Vocals Solo', exact: true }).click()
    await page.getByRole('button', { name: '현재 설정 저장', exact: true }).click()
    await expect(page.locator('.project-save')).toContainText('현재 믹서 설정을 저장했습니다.')
    for (const width of [320, 412, 800]) {
      await page.setViewportSize({ width, height: 915 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.locator('.saved-projects').screenshot({ path: `test-results/saved-projects-${width}.png` })
    }
  })
})

test('late project load is cancelled when the user selects another file', async ({ page }) => {
  await prepare(page); await save(page)
  await page.evaluate(() => {
    const decode = OfflineAudioContext.prototype.decodeAudioData
    OfflineAudioContext.prototype.decodeAudioData = function (data) {
      const flac = new Uint8Array(data)[0] === 102
      const result = decode.call(this, data)
      if (flac) {
        Object.assign(window, { restoringProject: true })
        return new Promise<AudioBuffer>((resolve, reject) => { setTimeout(() => { result.then(resolve, reject) }, 700) })
      }
      return result
    }
  })
  await page.getByRole('article', { name: '저장 테스트', exact: true }).getByRole('button', { name: '불러오기', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { restoringProject?: boolean }).restoringProject)).toBe(true)
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ title: '선택한 새 곡' }, 'new.wav', 3))
  await expect(page.locator('.project-save')).toContainText('작업을 취소했습니다.')
  await expect(page.getByRole('heading', { name: '선택한 새 곡', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stem Mix', exact: true })).toHaveCount(0)
})

test('future schema versions remain deletable but cannot be loaded', async ({ page }) => {
  await prepare(page); const record = await save(page)
  await page.evaluate(async ({ name, record }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result) })
    await new Promise<void>(resolve => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put({ ...record, version: 999 }); tx.oncomplete = () => resolve() }); db.close()
  }, { name: PROJECT_DATABASE, record })
  await page.reload()
  const item = page.getByRole('article', { name: '저장 테스트', exact: true })
  await expect(item).toContainText('지원하지 않거나 손상된')
  await expect(item.getByRole('button', { name: '불러오기', exact: true })).toBeDisabled()
  await expect(item.getByRole('button', { name: '삭제', exact: true })).toBeEnabled()
  expect(await files(page)).toHaveLength(1)
})
