import { expect, test } from '@playwright/test'
import { chordAudio, FIXTURE_CHORDS } from './fixtures/chordAudio'
import { getChordAtTime } from '../src/analysis/chordUtils'
import type { ChordAnalysisResult } from '../src/analysis/chordTypes'
import { CHORD_ENGINE_VERSION } from '../src/analysis/chordTypes'
import { ANALYSIS_VERSION } from '../src/analysis/analysisTypes'
import { taggedWav } from './fixtures/audio'
import type { Page } from '@playwright/test'

test('real Essentia HPCP detects nine chord qualities, silence and noise across the waveform', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(chordAudio())
  await expect(page.locator('.chord-status')).toHaveText('코드 분석 완료 · 추정값', { timeout: 60_000 })
  const read = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('music-dissector-chords'); r.onsuccess = () => resolve(r.result) })
    const values = await new Promise<ChordAnalysisResult[]>((resolve) => { const r = db.transaction('results').objectStore('results').getAll(); r.onsuccess = () => resolve(r.result) })
    db.close(); return values[0]
  })
  await expect.poll(async () => (await read())?.chords.length ?? 0).toBeGreaterThan(8)
  const result = await read()
  await test.info().attach('real-chords', { body: JSON.stringify(result), contentType: 'application/json' })
  expect(FIXTURE_CHORDS.map((_s, i) => getChordAtTime(i * 2 + 1, result.chords)?.chord)).toEqual(FIXTURE_CHORDS)
  expect(result.chords[0].start).toBe(0)
  expect(result.chords.at(-1)?.end).toBe(22)
  await page.getByLabel('재생 위치').fill('5')
  await expect(page.getByTestId('current-chord')).toHaveText('C7')
  await expect(page.getByTestId('previous-chord')).toHaveText('Cm')
  await expect(page.getByTestId('next-chord')).toHaveText('Cmaj7')
  expect(errors).toEqual([])
  await page.screenshot({ path: 'test-results/phase5-real.png', fullPage: true })
})

const mockResult = (): ChordAnalysisResult => ({ engineVersion: CHORD_ENGINE_VERSION, analyzedAt: 123, chords:
  Array.from({ length: 20 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, chord: ['C', 'Am', 'F', 'G', 'N'][i % 5], confidence: .9 })) })
async function mockMusic(page: Page) {
  await page.route('**/musicAnalysis.worker-*.js', (route) => route.fulfill({ contentType: 'application/javascript', body:
    `self.onmessage=()=>self.postMessage(${JSON.stringify({ kind: 'result', result: { bpm: null, beats: [], key: null, scale: null, confidence: {}, engineVersion: ANALYSIS_VERSION } })})` }))
}
async function mockChords(page: Page, delay = 150) {
  await page.route('**/chordAnalysis.worker-*.js', (route) => route.fulfill({ contentType: 'application/javascript', body:
    `self.onmessage=()=>{self.postMessage({kind:'stage',stage:'extracting'});setTimeout(()=>self.postMessage(${JSON.stringify({ kind: 'result', result: mockResult() })}),${delay})}` }))
}

test.describe('deterministic chord UI', () => {
  test.use({ serviceWorkers: 'block' })
  test('timed lyrics display overlapping chords, clicks seek, and both follow controls work', async ({ page }) => {
    await mockMusic(page); await mockChords(page)
    await page.goto('/')
    await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ lyrics: Array.from({ length: 16 }, (_, i) => `[00:${String(i * 2 + 1).padStart(2, '0')}]가사 ${i + 1}`).join('\n') }))
    await expect(page.locator('.chord-status')).toHaveText('코드 분석 완료 · 추정값')
    const first = page.locator('.lyrics-lines > li').first()
    await expect(first.locator('.lyric-chord')).toHaveText(['C', 'Am'])
    await first.getByRole('button', { name: '0:02 Am 코드로 이동', exact: true }).click()
    await expect(page.getByLabel('재생 위치')).toHaveValue('2')
    await expect(page.getByTestId('current-chord')).toHaveText('Am')
    await expect(page.getByTestId('previous-chord')).toHaveText('C')
    await expect(page.getByTestId('next-chord')).toHaveText('F')
    await page.getByRole('button', { name: '0:25 가사 13', exact: true }).click()
    await expect(page.getByLabel('재생 위치')).toHaveValue('25')
    const lyrics = page.getByRole('region', { name: '동기화 가사' })
    await expect.poll(() => lyrics.evaluate((el) => el.scrollTop)).toBeGreaterThan(300)
    const timeline = page.getByRole('region', { name: '코드 타임라인' })
    await expect.poll(() => timeline.evaluate((el) => el.scrollLeft)).toBeGreaterThan(300)
    await timeline.focus(); await page.keyboard.press('Home')
    await expect(page.getByRole('button', { name: '코드 따라가기', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await page.getByLabel('재생 위치').fill('35')
    await page.getByRole('button', { name: '코드 따라가기', exact: true }).click()
    await expect(page.getByRole('button', { name: '코드 따라가기', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await lyrics.focus(); await page.keyboard.press('Home')
    await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Follow', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await timeline.getByRole('button', { name: '0:08 코드 없음', exact: true }).click()
    await expect(page.getByTestId('current-chord')).toHaveText('—')
    await expect(page.getByLabel('재생 위치')).toHaveValue('8')
  })

  test('persistent chord cache, chord-only retry, reset, errors and plain USLT remain independent', async ({ page }) => {
    await mockMusic(page)
    let workers = 0
    await page.route('**/chordAnalysis.worker-*.js', (route) => {
      workers++
      return route.fulfill({ contentType: 'application/javascript', body: `self.onmessage=()=>self.postMessage(${JSON.stringify({ kind: 'result', result: mockResult() })})` })
    })
    const load = async (name: string) => {
      const audio = taggedWav({ lyrics: '일반 가사\n코드를 배정하지 않아요' }, name)
      await page.evaluate(({ bytes, name }) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'audio/wav', lastModified: 123 }))
        const input = document.querySelector<HTMLInputElement>('input[type=file]')!
        input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
      }, { bytes: [...audio.buffer], name })
    }
    await page.goto('/'); await load('cache.wav')
    await expect(page.getByTestId('current-chord')).toHaveText('C')
    await expect(page.locator('.lyric-chord')).toHaveCount(0)
    await expect(page.getByRole('region', { name: '일반 가사' })).toHaveText('일반 가사\n코드를 배정하지 않아요')
    await expect.poll(() => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('music-dissector-chords'); r.onsuccess = () => resolve(r.result) })
      const count = await new Promise<number>((resolve) => { const r = db.transaction('results').objectStore('results').count(); r.onsuccess = () => resolve(r.result) })
      db.close(); return count
    })).toBe(1)
    await page.reload(); await load('cache.wav')
    await expect(page.locator('.chord-status')).toHaveText('저장된 코드 분석 · 추정값'); expect(workers).toBe(1)
    await page.getByRole('button', { name: '코드 재분석', exact: true }).click()
    await expect(page.locator('.chord-status')).toHaveText('코드 분석 완료 · 추정값'); expect(workers).toBe(2)
    await page.unroute('**/chordAnalysis.worker-*.js')
    await page.route('**/chordAnalysis.worker-*.js', (route) => route.fulfill({ contentType: 'application/javascript', body: "self.onmessage=()=>setTimeout(()=>self.postMessage({kind:'error'}),500)" }))
    await load('error.wav')
    await expect(page.getByTestId('current-chord')).toHaveText('—')
    await expect(page.locator('.chord-timeline')).toHaveCount(0)
    await expect(page.locator('.chord-status')).toContainText('분석하지 못했습니다')
    await page.getByRole('button', { name: '재생', exact: true }).click()
    await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
    await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(0)
  })

  for (const width of [320, 412, 800]) {
    test(`chord cards, timeline and multi-chord lyrics fit ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 915 }); await mockMusic(page); await mockChords(page)
      await page.goto('/')
      await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ lyrics: '[00:00]아주 긴 한 줄에 많은 코드가 바뀌는 가사입니다' }))
      await expect(page.locator('.lyric-chord')).toHaveCount(16)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.getByLabel('재생 위치').fill('24')
      await expect(page.getByTestId('current-chord')).toHaveText('F')
      const timeline = page.getByRole('region', { name: '코드 타임라인' })
      await expect.poll(() => timeline.evaluate((el) => el.scrollLeft)).toBeGreaterThan(300)
      await page.screenshot({ path: `test-results/phase5-${width}.png`, fullPage: true })
    })
  }
})

test('offline shell includes chord worker and analyzes a newly selected file', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await context.setOffline(true); await page.reload()
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(chordAudio())
  await expect(page.locator('.chord-status')).toHaveText('코드 분석 완료 · 추정값', { timeout: 60_000 })
  await page.getByLabel('재생 위치').fill('11')
  await expect(page.getByTestId('current-chord')).toHaveText('Csus2')
})

test.describe('mobile chord analysis', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  test('real chord worker stays responsive under CPU throttling and unfolding', async ({ page, context }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.getByLabel('음악 파일', { exact: true }).setInputFiles(chordAudio())
    // Observe app work after test-harness fixture transfer, including native decode,
    // both analysis workers, touch playback and the Fold layout transition.
    await page.evaluate(() => {
      const probe = { active: true, frames: 0, previous: performance.now(), maxGap: 0, tasks: [] as number[] }
      Object.assign(window, { chordProbe: probe })
      new PerformanceObserver((list) => { if (probe.active) probe.tasks.push(...list.getEntries().map((e) => e.duration)) }).observe({ type: 'longtask' })
      const frame = (now: number) => { probe.frames++; probe.maxGap = Math.max(probe.maxGap, now - probe.previous); probe.previous = now; if (probe.active) requestAnimationFrame(frame) }
      requestAnimationFrame(frame)
    })
    await page.getByRole('button', { name: '재생', exact: true }).tap()
    await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
    await page.getByRole('button', { name: '10초 앞으로' }).tap()
    await page.setViewportSize({ width: 800, height: 915 })
    await expect(page.locator('.chord-status')).toHaveText('코드 분석 완료 · 추정값', { timeout: 60_000 })
    const probe = await page.evaluate(() => {
      const p = (window as unknown as { chordProbe: { active: boolean; frames: number; maxGap: number; tasks: number[] } }).chordProbe
      p.active = false
      return { frames: p.frames, maxGap: p.maxGap, longTasks: p.tasks, noOverflow: document.documentElement.scrollWidth <= innerWidth }
    })
    await test.info().attach('chord-cpu-probe', { body: JSON.stringify(probe), contentType: 'application/json' })
    expect(probe.frames).toBeGreaterThan(10)
    expect(probe.maxGap).toBeLessThan(500)
    expect(Math.max(0, ...probe.longTasks)).toBeLessThan(500)
    expect(probe.noOverflow).toBe(true)
    await page.screenshot({ path: 'test-results/phase5-fold.png', fullPage: true })
  })
})
