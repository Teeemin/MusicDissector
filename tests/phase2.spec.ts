import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { taggedMp3, taggedWav } from './fixtures/audio'

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const lrc = Array.from({ length: 16 }, (_, i) => `[00:${String(i * 2 + 1).padStart(2, '0')}.00]가사 ${i + 1}`).join('\n')

async function choose(page: Page, file: ReturnType<typeof taggedWav> | string) {
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(file)
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled()
  await expect(page.locator('.lyrics-badge')).not.toHaveText('읽는 중')
}

test('real WAV tags display title, artist, album, artwork and duration', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await choose(page, taggedWav({ title: '내장 제목', artist: '음악가', album: '첫 앨범', artwork: true, lyrics: '첫 줄\n\n두 번째 줄' }))
  await expect(page.getByRole('heading', { name: '내장 제목', exact: true })).toBeVisible()
  await expect(page.locator('.track-artist')).toHaveText('음악가')
  await expect(page.locator('.track-album')).toHaveText('첫 앨범')
  await expect(page.getByRole('img', { name: '내장 제목 앨범 아트' })).toBeVisible()
  expect(await page.locator('.track-artwork').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(192)
  await expect(page.getByLabel('재생 위치')).toHaveAttribute('max', '40')
  await expect(page.getByRole('region', { name: '일반 가사' })).toHaveText('첫 줄\n\n두 번째 줄')
  await expect(page.locator('.lyrics-badge')).toHaveText('동기화 정보 없음')
  await expect(page.locator('.lyrics-panel .lyric-line')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Follow' })).toHaveCount(0)
  expect(errors).toEqual([])
})

for (const filename of ['tagged.flac', 'tagged.m4a']) {
  test(`real ${filename} reads native tags and embedded LRC`, async ({ page }) => {
    await page.goto('/')
    await choose(page, fixture(filename))
    await expect(page.getByRole('heading', { name: '테스트 제목', exact: true })).toBeVisible()
    await expect(page.locator('.track-artist')).toHaveText('테스트 아티스트')
    await expect(page.locator('.track-album')).toHaveText('테스트 앨범')
    await expect(page.locator('.track-artwork')).toBeVisible()
    await expect(page.locator('.lyrics-badge')).toHaveText('LRC · 시간 동기화')
    await page.getByRole('button', { name: '0:04 두 번째 줄', exact: true }).click()
    await expect(page.getByLabel('재생 위치')).toHaveValue('4')
    await page.getByRole('button', { name: '재생', exact: true }).click()
    await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  })
}

test('real MP3 SYLT beats USLT LRC and uses milliseconds for seek', async ({ page }) => {
  await page.goto('/')
  await choose(page, taggedMp3({ title: '동기화된 MP3', artwork: true, lyrics: '[00:01]낮은 우선순위', synchronized: [{ time: 1500, text: '첫 동기화 줄' }, { time: 4000, text: '둘째 동기화 줄' }] }))
  await expect(page.locator('.lyrics-badge')).toHaveText('내장 동기화 가사')
  await expect(page.getByText('낮은 우선순위')).toHaveCount(0)
  await expect(page.locator('.lyric-line[aria-current="true"]')).toHaveCount(0)
  await page.getByRole('button', { name: '0:01 첫 동기화 줄' }).click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('1.5')
  await expect(page.locator('.lyric-line[aria-current="true"]')).toContainText('첫 동기화 줄')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.locator('.lyric-line[aria-current="true"]')).toContainText('둘째 동기화 줄', { timeout: 6000 })
  await page.getByRole('button', { name: '일시 정지' }).click()
  await page.getByRole('button', { name: '10초 뒤로' }).click()
  await expect(page.locator('.lyric-line[aria-current="true"]')).toHaveCount(0)
})

test('LRC auto-scroll, wheel/keyboard pause, Follow and backward seek', async ({ page }) => {
  await page.goto('/')
  await choose(page, taggedWav({ lyrics: lrc }))
  const viewport = page.getByRole('region', { name: '동기화 가사' })
  await page.getByRole('button', { name: '0:25 가사 13', exact: true }).click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('25')
  await expect(page.locator('.lyric-line[aria-current="true"]')).toContainText('가사 13')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(200)
  const pageScroll = await page.evaluate(() => window.scrollY)
  await viewport.hover()
  await page.mouse.wheel(0, -150)
  await expect(page.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'false')
  await viewport.focus()
  await page.keyboard.press('Home')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0)
  // Seek while manual reading is active: highlight updates, viewport stays put.
  await page.getByLabel('재생 위치').press('End')
  await expect(page.locator('.lyric-line[aria-current="true"]')).toContainText('가사 16')
  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(0)
  await page.getByRole('button', { name: 'Follow' }).click()
  await expect(page.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(200)
  expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(pageScroll + 400)
  await page.getByRole('button', { name: '0:01 가사 1', exact: true }).click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('1')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeLessThan(60)
})

test('plain lyrics preserve text safely and absent lyrics are a normal empty state', async ({ page }) => {
  await page.goto('/')
  const lyrics = '<img src="x" onerror="alert(1)">\n그대로 표시\n\n다음 연'
  await choose(page, taggedWav({ lyrics }, 'fallback.wav'))
  await expect(page.getByRole('heading', { name: 'fallback', exact: true })).toBeVisible()
  await expect(page.locator('.plain-lyrics')).toHaveText(lyrics)
  await expect(page.locator('.lyrics-panel img')).toHaveCount(0)
  await page.locator('.plain-lyrics').click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('0')
  await choose(page, taggedWav({ title: '   ' }, '태그 없는 파일.wav'))
  await expect(page.getByRole('heading', { name: '태그 없는 파일', exact: true })).toBeVisible()
  await expect(page.getByText('내장 가사가 없습니다', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('new selections reset metadata, artwork URL, lyrics and Follow/scroll state', async ({ page }) => {
  await page.addInitScript(() => {
    const revoke = URL.revokeObjectURL.bind(URL)
    Object.assign(window, { revokedArt: [] as string[] })
    URL.revokeObjectURL = (url) => { (window as unknown as { revokedArt: string[] }).revokedArt.push(url); revoke(url) }
  })
  await page.goto('/')
  await choose(page, taggedWav({ title: '이전 곡', artist: '이전 가수', album: '이전 앨범', artwork: true, lyrics: lrc }))
  const artwork = await page.locator('.track-artwork').getAttribute('src')
  await page.getByRole('button', { name: '0:25 가사 13', exact: true }).click()
  await page.getByRole('region', { name: '동기화 가사' }).dispatchEvent('wheel', { deltaY: 50 })
  await expect(page.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'false')
  await choose(page, taggedWav({ lyrics: lrc }, '새 파일.wav'))
  await expect(page.locator('.track-artwork, .track-artist, .track-album')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { revokedArt: string[] }).revokedArt)).toContain(artwork)
  await expect(page.getByRole('heading', { name: '새 파일', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.getByRole('region', { name: '동기화 가사' }).evaluate((element) => element.scrollTop)).toBe(0)
  await expect(page.getByLabel('재생 위치')).toHaveValue('0')
  await choose(page, taggedWav())
  await expect(page.locator('.lyric-line')).toHaveCount(0)
})

test('late metadata from a replaced track cannot overwrite the current selection', async ({ page }) => {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker
    let count = 0
    window.Worker = class extends OriginalWorker {
      private first = ++count === 1
      set onmessage(handler: ((this: Worker, event: MessageEvent) => void) | null) {
        super.onmessage = (event) => {
          if (this.first) {
            Object.assign(window, { oldMetadataReceived: true })
            setTimeout(() => handler?.call(this, event), 700)
          } else handler?.call(this, event)
        }
      }
    }
  })
  await page.goto('/')
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ title: '늦은 이전 곡', lyrics: lrc, artwork: true }))
  await page.waitForFunction(() => (window as unknown as { oldMetadataReceived?: boolean }).oldMetadataReceived)
  await choose(page, taggedWav({ title: '최종 곡' }))
  // Wait past the deliberately delayed old result, not for app readiness.
  await page.waitForTimeout(850)
  await expect(page.getByRole('heading', { name: '최종 곡', exact: true })).toBeVisible()
  await expect(page.locator('.track-artwork, .lyric-line')).toHaveCount(0)
})

test('unsupported frame timestamps remain plain and broken artwork keeps the record fallback', async ({ page }) => {
  await page.goto('/')
  await choose(page, taggedWav({ brokenArtwork: true, timestampFormat: 1, synchronized: [{ time: 50, text: '프레임 번호 가사' }] }))
  await expect(page.locator('.lyrics-badge')).toHaveText('동기화 정보 없음')
  await expect(page.locator('.plain-lyrics')).toHaveText('프레임 번호 가사')
  await expect(page.locator('.record')).toBeVisible()
  await expect(page.locator('.track-artwork')).toHaveCount(0)
})

test('offline app shell includes metadata worker and parses a newly selected tagged file', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await choose(page, taggedWav({ title: '오프라인 제목', artist: '오프라인 가수', lyrics: lrc, artwork: true }))
  await expect(page.getByRole('heading', { name: '오프라인 제목', exact: true })).toBeVisible()
  await expect(page.locator('.track-artwork')).toBeVisible()
  await page.getByRole('button', { name: '0:05 가사 3', exact: true }).click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('5')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
})

for (const width of [320, 412, 800]) {
  test(`metadata and lyrics remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 915 })
    await page.goto('/')
    await choose(page, taggedWav({ title: '제목'.repeat(80), artist: '가수'.repeat(80), album: '앨범'.repeat(80), artwork: true, lyrics: '[00:01]긴가사'.repeat(30) }))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(page.getByRole('region', { name: '동기화 가사' })).toBeVisible()
    await page.screenshot({ path: `test-results/phase2-${width}.png`, fullPage: true })
  })
}

test.describe('mobile lyrics', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  test('touch seek and manual touch scrolling pause Follow across unfolding', async ({ page }) => {
    await page.goto('/')
    await choose(page, taggedWav({ lyrics: lrc, artwork: true }))
    await page.getByRole('button', { name: '0:09 가사 5', exact: true }).tap()
    await expect(page.getByLabel('재생 위치')).toHaveValue('9')
    await page.getByRole('region', { name: '동기화 가사' }).dispatchEvent('touchmove')
    await expect(page.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'false')
    await page.setViewportSize({ width: 800, height: 915 })
    await page.getByRole('button', { name: 'Follow' }).tap()
    await expect(page.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.lyric-line[aria-current="true"]')).toContainText('가사 5')
  })
})
