import { expect, test } from '@playwright/test'
import { ANALYSIS_VERSION } from '../src/analysis/analysisTypes'
import { analysisAudio } from './fixtures/analysisAudio'

test.use({ serviceWorkers: 'block' })

test('real PCM → Web Audio decode → Essentia worker → BPM, beats and IndexedDB', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  // Seed the retired schemas exactly as an existing installation would have them.
  await page.evaluate(async () => {
    for (const name of ['music-dissector-analysis', 'music-dissector-chords']) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1)
        request.onupgradeneeded = () => request.result.createObjectStore('results')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('results', 'readwrite')
        tx.objectStore('results').put({ key: 'C', scale: 'major', chords: [], engineVersion: 'v1' }, 'old-track')
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
      })
      db.close()
    }
  })
  await page.reload()
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'music-dissector-chords'))).toBe(false)
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(analysisAudio())
  await expect(page.locator('.analysis-status')).toHaveText('분석 완료 · 추정값', { timeout: 60_000 })
  expect(Number(await page.getByTestId('analysis-bpm').textContent())).toBeGreaterThanOrEqual(118)
  expect(Number(await page.getByTestId('analysis-bpm').textContent())).toBeLessThanOrEqual(122)
  await expect(page.getByTestId('analysis-beats')).toContainText('/ ')
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('music-dissector-analysis'); r.onsuccess = () => resolve(r.result) })
    const data = await new Promise<{ beats: number[]; engineVersion: string }[]>((resolve) => {
      const r = db.transaction('results').objectStore('results').getAll(); r.onsuccess = () => resolve(r.result)
    })
    db.close()
    return data[0]?.beats.length ?? 0
  })).toBeGreaterThan(30)
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('music-dissector-analysis'); r.onsuccess = () => resolve(r.result) })
    const values = await new Promise<{ bpm: number; beats: number[]; engineVersion: string }[]>((resolve) => {
      const r = db.transaction('results').objectStore('results').getAll(); r.onsuccess = () => resolve(r.result)
    })
    const version = db.version
    db.close(); return { ...values[0], cacheVersion: version, recordCount: values.length }
  })
  expect(saved.cacheVersion).toBe(2)
  expect(saved.recordCount).toBe(1)
  expect(saved.engineVersion).toBe(ANALYSIS_VERSION)
  expect(saved).not.toHaveProperty('key')
  expect(saved).not.toHaveProperty('scale')
  expect(saved.beats.every((v, i) => v >= 0 && v <= 24 && (i === 0 || v > saved.beats[i - 1]))).toBe(true)
  // Detected ticks remain on the original seconds clock after 22.05 → 44.1 kHz resampling.
  expect(saved.beats.filter((v) => Math.abs(v * 2 - Math.round(v * 2)) < .2).length / saved.beats.length).toBeGreaterThan(.8)
  await page.getByRole('button', { name: '10초 앞으로' }).click()
  await expect(page.getByTestId('analysis-beats')).not.toContainText('Beat 0 /')
  await page.screenshot({ path: 'test-results/phase4-analysis.png', fullPage: true })
})

test('analysis stays interactive under CPU throttling while folding and seeking', async ({ page, context }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const started = Date.now()
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(analysisAudio())
  // Start after Playwright transfers/base64-decodes the fixture into the renderer.
  // That test-harness task is not native file-picker or application analysis work.
  await page.evaluate(() => {
    const probe = { frames: 0, maxGap: 0, previous: performance.now(), active: true, longTasks: [] as number[] }
    Object.assign(window, { analysisFrameProbe: probe })
    new PerformanceObserver((list) => {
      if (probe.active) probe.longTasks.push(...list.getEntries().map((entry) => entry.duration))
    }).observe({ type: 'longtask', buffered: false })
    const frame = (now: number) => {
      probe.frames++; probe.maxGap = Math.max(probe.maxGap, now - probe.previous); probe.previous = now
      if (probe.active) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  await page.getByRole('button', { name: '10초 앞으로' }).click()
  await page.setViewportSize({ width: 800, height: 915 })
  await expect(page.locator('.analysis-status')).toHaveText('분석 완료 · 추정값', { timeout: 60_000 })
  const probe = await page.evaluate(() => {
    const probe = (window as unknown as { analysisFrameProbe: { active: boolean; frames: number; maxGap: number; longTasks: number[] } }).analysisFrameProbe
    probe.active = false
    return { frames: probe.frames, maxGap: probe.maxGap, longTasks: probe.longTasks, noOverflow: document.documentElement.scrollWidth <= innerWidth }
  })
  await test.info().attach('analysis-browser-timing', { body: JSON.stringify({ elapsedMs: Date.now() - started, ...probe }), contentType: 'application/json' })
  expect(probe.frames).toBeGreaterThan(10)
  expect(probe.maxGap).toBeLessThan(500)
  expect(Math.max(0, ...probe.longTasks)).toBeLessThan(500)
  expect(probe.noOverflow).toBe(true)
  await page.screenshot({ path: 'test-results/phase4-fold.png', fullPage: true })
})

test.describe('offline analysis', () => {
  test.use({ serviceWorkers: 'allow' })
  test('precached local WASM analyzes a new file offline', async ({ page, context }) => {
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await page.reload()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    await context.setOffline(true)
    await page.reload()
    await page.getByLabel('음악 파일', { exact: true }).setInputFiles(analysisAudio())
    await expect(page.locator('.analysis-status')).toHaveText('분석 완료 · 추정값', { timeout: 30_000 })
    expect(Number(await page.getByTestId('analysis-bpm').textContent())).toBeGreaterThanOrEqual(118)
    await expect(page.locator('.analysis-status')).toHaveText('분석 완료 · 추정값')
  })
})

test('silence does not invent BPM or beats and playback still works', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(analysisAudio(true, 3))
  await expect(page.locator('.analysis-status')).toContainText('확인하지 못했습니다', { timeout: 30_000 })
  await expect(page.getByTestId('analysis-bpm')).toHaveText('--')
  await expect(page.getByTestId('analysis-beats')).toHaveText('Beat --')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
})

test('deterministic result UI, persisted cache, forced reanalysis, reset and failure isolation', async ({ page }) => {
  const result = { bpm: 123.94, beats: [.47, .95, 1.44], confidence: { bpm: 3 }, engineVersion: ANALYSIS_VERSION }
  let workers = 0
  await page.route('**/musicAnalysis.worker-*.js', async (route) => {
    workers++
    await route.fulfill({ contentType: 'application/javascript', body: `self.onmessage=()=>{ self.postMessage({kind:'stage',stage:'bpm'}); setTimeout(()=>self.postMessage(${JSON.stringify({ kind: 'result', result })}),200); }` })
  })
  // Fixed lastModified allows identity to persist across reloads, as a real File does.
  const load = async (name: string) => {
    const audio = analysisAudio(false, 3)
    await page.evaluate(({ name, bytes }) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'audio/wav', lastModified: 123 }))
      const input = document.querySelector<HTMLInputElement>('input[type=file]')!
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
    }, { name, bytes: [...audio.buffer] })
  }
  await page.goto('/')
  await load('cache.wav')
  await expect(page.getByTestId('analysis-bpm')).toHaveText('124')
  await expect(page.getByTestId('analysis-beats')).toHaveText('Beat 0 / 3')
  await page.getByRole('button', { name: '10초 앞으로' }).click()
  await expect(page.getByTestId('analysis-beats')).toHaveText('Beat 3 / 3')
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('music-dissector-analysis'); r.onsuccess = () => resolve(r.result) })
    const count = await new Promise<number>((resolve) => { const r = db.transaction('results').objectStore('results').count(); r.onsuccess = () => resolve(r.result) })
    db.close(); return count
  })).toBe(1)
  await page.reload(); await load('cache.wav')
  await expect(page.locator('.analysis-status')).toHaveText('저장된 분석 결과')
  expect(workers).toBe(1)
  await page.getByRole('button', { name: '다시 분석' }).click()
  await expect(page.locator('.analysis-status')).toHaveText('분석 완료 · 추정값')
  expect(workers).toBe(2)
  await page.unroute('**/musicAnalysis.worker-*.js')
  await page.route('**/musicAnalysis.worker-*.js', (route) => route.fulfill({ contentType: 'application/javascript', body: "self.onmessage=()=>setTimeout(()=>self.postMessage({kind:'error'}),500)" }))
  await load('new.wav')
  await expect(page.getByTestId('analysis-bpm')).not.toHaveText('124')
  await expect(page.locator('.analysis-status')).toContainText('분석하지 못했습니다')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(0)
})
