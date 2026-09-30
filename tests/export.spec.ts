import { expect, test } from '@playwright/test'
import { downloadAndInspect, expectGains, exportTitle, prepareExport } from './fixtures/exportHarness'
import { taggedWav } from './fixtures/audio'

test.use({ serviceWorkers: 'block' })

const cases = [
  { name: 'default', volumes: {}, toggles: [], preset: null, gains: [1, 1, 1, 1, 1, 1] },
  { name: 'guitar-zero', volumes: { Guitar: 0 }, toggles: [], preset: null, gains: [1, 1, 1, 1, 0, 1] },
  { name: 'guitar-mute', volumes: {}, toggles: ['Guitar Mute'], preset: null, gains: [1, 1, 1, 1, 0, 1] },
  { name: 'guitar-solo', volumes: {}, toggles: ['Guitar Solo'], preset: null, gains: [0, 0, 0, 0, 1, 0] },
  { name: 'multi-solo', volumes: {}, toggles: ['Guitar Solo', 'Vocals Solo'], preset: null, gains: [0, 0, 0, 1, 1, 0] },
  { name: 'no-guitar-preset', volumes: {}, toggles: [], preset: 'No Guitar', gains: [1, 1, 1, 1, 0, 1] },
  { name: 'relative-volume', volumes: { Guitar: 25, Piano: 80, Others: 90 }, toggles: [], preset: null, gains: [1, 1, .9, 1, .25, .8] },
] as const

for (const scenario of cases) {
  test(`real stereo CBR MP3: ${scenario.name}, metadata/artwork and measured stem amplitudes`, async ({ page }, info) => {
    await prepareExport(page)
    for (const [stem, value] of Object.entries(scenario.volumes)) await page.getByRole('slider', { name: `${stem} 볼륨`, exact: true }).fill(String(value))
    for (const name of scenario.toggles) await page.getByRole('button', { name, exact: true }).click()
    if (scenario.preset) await page.getByRole('group', { name: 'Quick Presets' }).getByRole('button', { name: scenario.preset, exact: true }).click()
    // Export always uses stems, independent of current Original/master/Repeat.
    await page.getByRole('group', { name: '재생 소스' }).getByRole('button', { name: 'Original', exact: true }).click()
    await page.getByLabel('음량', { exact: true }).fill('0.2')
    if (scenario.name === 'guitar-mute') await page.getByRole('button', { name: '음소거', exact: true }).click()
    await page.getByRole('button', { name: '반복 재생', exact: true }).click()
    await page.getByLabel('재생 위치').fill('3')
    const before = await page.locator('.stem-grid').evaluate(el => el.innerHTML)
    const result = await downloadAndInspect(page, info, scenario.name)
    expectGains(result.amplitudes, [...scenario.gains])
    expect(await page.locator('.stem-grid').evaluate(el => el.innerHTML)).toBe(before)
    await expect(page.getByRole('group', { name: '재생 소스' }).getByRole('button', { name: 'Original', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('음량', { exact: true })).toHaveValue(scenario.name === 'guitar-mute' ? '0' : '0.2')
    await expect(page.getByLabel('재생 위치')).toHaveValue('3')
    await expect(page.getByRole('button', { name: '반복 재생', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '재생', exact: true })).toBeVisible()
    await expect(page.getByText('분리 결과는 현재 세션에서만 유지됩니다.', { exact: true })).toBeVisible()
    await expect(page.locator('.project-list li')).toHaveCount(0)
  })
}

test('export uses a click-time snapshot, prevents duplicates and leaves active playback running', async ({ page }, info) => {
  await prepareExport(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/mp3Encoder-*.js', async route => { await gate; await route.continue() })
  await page.getByRole('button', { name: 'Guitar Mute', exact: true }).click()
  await page.getByRole('button', { name: '재생', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '현재 믹스 내보내기', exact: true }).click()
  await expect(page.getByText('MP3 인코딩 중...', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '현재 믹스 내보내기', exact: true })).toBeDisabled()
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(.3)
  await page.getByRole('button', { name: 'Guitar Mute', exact: true }).click()
  await page.getByRole('button', { name: 'Vocals Solo', exact: true }).click()
  release()
  const result = await download
  await result.saveAs(info.outputPath('snapshot.mp3'))
  await expect(page.getByRole('button', { name: '일시 정지', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Vocals Solo', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // Re-open the downloaded file to compare content using the metadata/audio reader.
  const { readFile } = await import('node:fs/promises')
  const bytes = await readFile(info.outputPath('snapshot.mp3'))
  await page.route('**/__snapshot.mp3', route => route.fulfill({ body: bytes, contentType: 'audio/mpeg' }))
  const amplitudes = await page.evaluate(async () => {
    const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await (await fetch('/__snapshot.mp3')).arrayBuffer())
    const pcm = buffer.getChannelData(0)
    return [440, 550, 110].map(hz => {
      let sin = 0; let cos = 0
      for (let i = 44100; i < 88200; i++) { const phase = 2 * Math.PI * hz * i / 44100; sin += pcm[i] * Math.sin(phase); cos += pcm[i] * Math.cos(phase) }
      return Math.hypot(sin, cos) * 2 / 44100
    })
  })
  expect(amplitudes[0]).toBeCloseTo(.05, 3)
  expect(amplitudes[1]).toBeLessThan(.0005)
  expect(amplitudes[2]).toBeCloseTo(.05, 3)
})

test('new file during export cancels stale work and never downloads the previous mix', async ({ page }) => {
  await prepareExport(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/mp3Encoder-*.js', async route => { await gate; await route.continue() })
  let downloads = 0
  page.on('download', () => { downloads++ })
  await page.getByRole('button', { name: '현재 믹스 내보내기', exact: true }).click()
  await expect(page.getByText('MP3 인코딩 중...', { exact: true })).toBeVisible()
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ title: '새로운 곡' }))
  release()
  await expect(page.getByText('음원이 변경되어 이전 믹스의 내보내기를 취소했습니다.', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '새로운 곡', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '현재 믹스 내보내기', exact: true })).toBeDisabled()
  expect(downloads).toBe(0)
})

test('loaded project exports current unsaved mixer settings without AI or changing stored metadata', async ({ page }, info) => {
  await prepareExport(page)
  await page.getByRole('button', { name: '분리 결과 저장', exact: true }).click()
  await expect(page.getByRole('button', { name: '현재 설정 저장', exact: true })).toBeEnabled({ timeout: 30_000 })
  const records = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('music-dissector-projects'); r.onsuccess = () => resolve(r.result) })
    try { return await new Promise(resolve => { const r = db.transaction('projects').objectStore('projects').getAll(); r.onsuccess = () => resolve(r.result) }) }
    finally { db.close() }
  })
  const saved = await records()
  await page.getByRole('button', { name: '모델 삭제', exact: true }).click()
  await expect(page.getByRole('button', { name: '모델 다운로드', exact: true })).toBeEnabled()
  await page.reload()
  await page.getByRole('article', { name: exportTitle, exact: true }).getByRole('button', { name: '불러오기', exact: true }).click()
  await expect(page.getByRole('button', { name: '현재 설정 저장', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Guitar Mute', exact: true }).click()
  const result = await downloadAndInspect(page, info, 'loaded-project')
  expectGains(result.amplitudes, [1, 1, 1, 1, 0, 1])
  expect(await records()).toEqual(saved)
  await expect(page.getByRole('button', { name: '모델 다운로드', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Guitar Mute', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

for (const failure of ['encoder-init', 'encoding', 'download'] as const) {
  test(`${failure} failure is recoverable and preserves the current session`, async ({ page }, info) => {
    await prepareExport(page)
    await page.evaluate(failure => {
      const originalPost = Worker.prototype.postMessage
      const originalURL = URL.createObjectURL
      Worker.prototype.postMessage = function (message, options?: StructuredSerializeOptions) {
        if ((failure === 'encoder-init' && message.command?.type === 'init') || (failure === 'encoding' && message.command?.type === 'flush')) {
          queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, success: false, error: new Error('Injected encoder failure') } })))
        } else originalPost.call(this, message, options)
      }
      URL.createObjectURL = blob => {
        if (failure === 'download' && blob instanceof Blob && blob.type === 'audio/mpeg') throw new Error('Injected download failure')
        return originalURL(blob)
      }
      Object.assign(window, { restoreExport: () => { Worker.prototype.postMessage = originalPost; URL.createObjectURL = originalURL } })
    }, failure)
    await page.getByRole('button', { name: '현재 믹스 내보내기', exact: true }).click()
    const messages = { 'encoder-init': 'MP3 인코더를 초기화하지 못했습니다.', encoding: 'MP3 인코딩에 실패했습니다.', download: '다운로드 파일을 생성하지 못했습니다.' }
    await expect(page.locator('.mix-export [role="alert"]')).toContainText(messages[failure])
    await expect(page.getByRole('heading', { name: exportTitle, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '현재 믹스 내보내기', exact: true })).toBeEnabled()
    await page.evaluate(() => (window as unknown as { restoreExport: () => void }).restoreExport())
    expectGains((await downloadAndInspect(page, info, `retry-${failure}`)).amplitudes, [1, 1, 1, 1, 1, 1])
  })
}

test('cancel during offline render discards the result; a later export succeeds and releases its URL', async ({ page }, info) => {
  await prepareExport(page)
  await page.evaluate(() => {
    const original = OfflineAudioContext.prototype.startRendering
    OfflineAudioContext.prototype.startRendering = function () {
      const rendering = original.call(this)
      return new Promise<AudioBuffer>((resolve, reject) => {
        Object.assign(window, { releaseRender: () => { OfflineAudioContext.prototype.startRendering = original; rendering.then(resolve, reject) } })
      })
    }
  })
  let downloads = 0
  page.on('download', () => downloads++)
  await page.getByRole('button', { name: '현재 믹스 내보내기', exact: true }).click()
  await expect.poll(() => page.evaluate(() => 'releaseRender' in window)).toBe(true)
  await page.getByRole('button', { name: '내보내기 취소', exact: true }).click()
  await page.evaluate(() => (window as unknown as { releaseRender: () => void }).releaseRender())
  await expect(page.getByText('믹스 내보내기를 취소했습니다.', { exact: true })).toBeVisible()
  expect(downloads).toBe(0)
  await page.evaluate(() => {
    const create = URL.createObjectURL; const revoke = URL.revokeObjectURL
    const probe = { url: '', revoked: false }; Object.assign(window, { exportURL: probe })
    URL.createObjectURL = blob => { const url = create(blob); if (blob instanceof Blob && blob.type === 'audio/mpeg') probe.url = url; return url }
    URL.revokeObjectURL = url => { if (url === probe.url) probe.revoked = true; revoke(url) }
  })
  await downloadAndInspect(page, info, 'after-cancel')
  // pagehide uses the same cleanup as the delayed mobile-download handoff.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  expect(await page.evaluate(() => (window as unknown as { exportURL: { revoked: boolean } }).exportURL.revoked)).toBe(true)
  expect(downloads).toBe(1)
})

test('project load intent cancels an export before restoration completes', async ({ page }) => {
  await prepareExport(page)
  await page.getByRole('button', { name: '분리 결과 저장', exact: true }).click()
  await expect(page.getByRole('button', { name: '현재 설정 저장', exact: true })).toBeEnabled({ timeout: 30_000 })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/mp3Encoder-*.js', async route => { await gate; await route.continue() })
  let downloads = 0
  page.on('download', () => downloads++)
  await page.getByRole('button', { name: '현재 믹스 내보내기', exact: true }).click()
  await expect(page.getByText('MP3 인코딩 중...', { exact: true })).toBeVisible()
  await page.getByRole('article', { name: exportTitle, exact: true }).getByRole('button', { name: '불러오기', exact: true }).click()
  release()
  await expect(page.getByText('음원이 변경되어 이전 믹스의 내보내기를 취소했습니다.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '현재 믹스 내보내기', exact: true })).toBeEnabled()
  expect(downloads).toBe(0)
})

test.describe('offline PWA MP3 encoder', () => {
  test.use({ serviceWorkers: 'allow' })
  test('first export works after offline reload, with the encoder bundled and no model', async ({ page, context }, info) => {
    await page.addInitScript(() => {
      const register = ServiceWorkerContainer.prototype.register
      ServiceWorkerContainer.prototype.register = function (url, options) {
        if (!document.documentElement?.dataset.enableSW) return new Promise(() => {})
        return register.call(this, url, options)
      }
    })
    await prepareExport(page)
    await page.getByRole('button', { name: '분리 결과 저장', exact: true }).click()
    await expect(page.getByRole('button', { name: '현재 설정 저장', exact: true })).toBeEnabled({ timeout: 30_000 })
    await page.getByRole('button', { name: '모델 삭제', exact: true }).click()
    await page.evaluate(async () => { document.documentElement.dataset.enableSW = 'yes'; await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready })
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await context.setOffline(true); await page.reload()
    await page.getByRole('article', { name: exportTitle, exact: true }).getByRole('button', { name: '불러오기', exact: true }).click()
    await expect(page.getByRole('button', { name: '현재 믹스 내보내기', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Guitar Mute', exact: true }).click()
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: '현재 믹스 내보내기', exact: true }).click()
    const download = await downloading
    expect(await download.failure()).toBeNull()
    await download.saveAs(info.outputPath('offline-guitar-muted.mp3'))
    await expect(page.getByText('MP3 다운로드를 시작했습니다.', { exact: true })).toBeVisible()
    for (const width of [320, 412, 800]) {
      await page.setViewportSize({ width, height: 915 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.locator('.mix-export').screenshot({ path: info.outputPath(`export-${width}.png`) })
    }
  })
})
