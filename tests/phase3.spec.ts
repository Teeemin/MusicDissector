import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { taggedWav } from './fixtures/audio'

const labels = ['Vocals', 'Guitar', 'Piano', 'Drums', 'Bass', 'Others']
async function load(page: Page, title = '믹서 테스트') {
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ title, artist: '테스트 가수', artwork: true, lyrics: '[00:01]첫 줄\n[00:05]다음 줄' }))
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled()
}

test('six channels, volume, mute, solo and multi-solo are accessible and independent', async ({ page }) => {
  await page.goto('/')
  for (const label of labels) {
    await expect(page.getByRole('group', { name: `${label} 채널`, exact: true })).toBeVisible()
    await expect(page.getByRole('slider', { name: `${label} 볼륨` })).toBeDisabled()
  }
  await load(page)
  await expect(page.getByText('아직 stem 음원이 없습니다.', { exact: false })).toBeVisible()
  const volume = page.getByRole('slider', { name: 'Vocals 볼륨' })
  await volume.press('Home')
  await volume.press('ArrowRight')
  await expect(volume).toHaveValue('1')
  await expect(page.locator('[data-stem="vocals"] output')).toHaveText('1%')
  await page.getByRole('button', { name: 'Vocals Solo', exact: true }).click()
  await page.getByRole('button', { name: 'Guitar Solo', exact: true }).click()
  await expect(page.locator('[data-stem="vocals"]')).toHaveAttribute('data-effective-gain', '0.01')
  await expect(page.locator('[data-stem="guitar"]')).toHaveAttribute('data-effective-gain', '1')
  await expect(page.locator('[data-stem="piano"]')).toHaveAttribute('data-effective-gain', '0')
  await page.getByRole('button', { name: 'Vocals Mute', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Vocals Solo', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-stem="vocals"]')).toHaveAttribute('data-effective-gain', '0')
  await page.getByRole('button', { name: 'Vocals Mute', exact: true }).click()
  await expect(page.locator('[data-stem="vocals"]')).toHaveAttribute('data-effective-gain', '0.01')
  await expect(page.locator('.stem-channel[data-source="none"]')).toHaveCount(6)
})

test('all presets work after custom edits and can be edited again', async ({ page }) => {
  await page.goto('/')
  await load(page)
  for (const preset of ['Vocal Only', 'No Vocal', 'No Guitar', 'No Piano', 'Original']) {
    await page.getByRole('button', { name: 'Bass Solo', exact: true }).click()
    await page.getByRole('slider', { name: 'Drums 볼륨' }).press('Home')
    await page.getByRole('button', { name: preset, exact: true }).click()
    await expect(page.getByRole('button', { name: preset, exact: true })).toHaveAttribute('aria-pressed', 'true')
    for (const label of labels) {
      await expect(page.getByRole('slider', { name: `${label} 볼륨` })).toHaveValue('100')
      const excluded = preset === 'Vocal Only' ? label !== 'Vocals' : preset === 'No Vocal' ? label === 'Vocals' : preset === 'No Guitar' ? label === 'Guitar' : preset === 'No Piano' ? label === 'Piano' : false
      await expect(page.getByRole('group', { name: `${label} 채널`, exact: true })).toHaveAttribute('data-effective-gain', excluded ? '0' : '1')
    }
  }
  await page.getByRole('button', { name: 'No Vocal', exact: true }).click()
  await page.getByRole('slider', { name: 'Guitar 볼륨' }).press('ArrowLeft')
  await expect(page.getByRole('slider', { name: 'Guitar 볼륨' })).toHaveValue('99')
  await expect(page.locator('.preset-button[aria-pressed="true"]')).toHaveCount(0)
})

test('replacement resets mixer while rejected files preserve controls and lyrics remain usable', async ({ page }) => {
  await page.goto('/')
  await load(page)
  await page.getByRole('button', { name: 'Vocal Only', exact: true }).click()
  await page.getByRole('slider', { name: 'Vocals 볼륨' }).press('Home')
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('no') })
  await expect(page.getByRole('slider', { name: 'Vocals 볼륨' })).toHaveValue('0')
  await expect(page.getByRole('button', { name: 'Vocals Solo', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await load(page, '새로운 곡')
  for (const label of labels) {
    await expect(page.getByRole('slider', { name: `${label} 볼륨` })).toHaveValue('100')
    await expect(page.getByRole('button', { name: `${label} Mute`, exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('button', { name: `${label} Solo`, exact: true })).toHaveAttribute('aria-pressed', 'false')
  }
  await expect(page.getByRole('img', { name: '새로운 곡 앨범 아트' })).toBeVisible()
  await page.getByLabel('재생 위치').fill('5')
  await page.getByRole('button', { name: '가사', exact: true }).click()
  await page.locator('.plain-lyrics').click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('5')
  await expect(page.locator('.plain-lyrics')).toContainText('다음 줄')
})

test('mixer controls never duplicate or modify the original audio playback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { mixerProbe: { count: 0, bufferSources: 0, audio: null as HTMLAudioElement | null } })
    const probe = (window as unknown as { mixerProbe: { count: number; bufferSources: number; audio: HTMLAudioElement | null } }).mixerProbe
    window.Audio = new Proxy(window.Audio, { construct(target, args) { probe.count++; const audio = Reflect.construct(target, args) as HTMLAudioElement; probe.audio = audio; return audio } })
    const original = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function () { probe.bufferSources++; return original.call(this) }
  })
  await page.goto('/')
  await load(page)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  for (const label of labels) await page.getByRole('button', { name: `${label} Mute`, exact: true }).click()
  await page.getByRole('button', { name: 'Vocals Solo', exact: true }).click()
  await page.getByRole('slider', { name: 'Vocals 볼륨' }).press('Home')
  const snapshot = await page.evaluate(() => {
    const { count, bufferSources, audio } = (window as unknown as { mixerProbe: { count: number; bufferSources: number; audio: HTMLAudioElement } }).mixerProbe
    return { count, bufferSources, paused: audio.paused, volume: audio.volume, muted: audio.muted, time: audio.currentTime }
  })
  expect(snapshot).toMatchObject({ count: 1, bufferSources: 0, paused: false, volume: 1, muted: false })
  expect(snapshot.time).toBeGreaterThan(0)
  await page.getByRole('link', { name: '재생기로 이동' }).click()
  await expect(page.getByRole('heading', { name: '02 재생기' })).toBeInViewport()
  await page.getByRole('button', { name: '일시 정지' }).click()
  await page.getByLabel('재생 위치').press('Home')
  await page.getByRole('button', { name: '10초 앞으로' }).click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('10')
})

for (const width of [320, 412, 800]) {
  test(`mixer layout and touch targets at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 915 })
    await page.goto('/')
    await load(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const vocals = await page.locator('[data-stem="vocals"]').boundingBox()
    const guitar = await page.locator('[data-stem="guitar"]').boundingBox()
    if (width < 700) expect(guitar!.y).toBeGreaterThan(vocals!.y)
    else expect(guitar!.y).toBe(vocals!.y)
    for (const button of await page.locator('.stem-toggle, .preset-button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await page.locator('.mixer-panel').screenshot({ path: `test-results/phase3-${width}.png` })
  })
}

test.describe('mobile mixer', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  test('touch controls survive unfolding and offline restart', async ({ page, context }) => {
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await context.setOffline(true)
    await page.reload()
    await load(page)
    await page.getByRole('button', { name: 'No Piano', exact: true }).tap()
    await page.getByRole('button', { name: 'Vocals Solo', exact: true }).tap()
    await page.getByRole('slider', { name: 'Bass 볼륨' }).tap()
    const value = await page.getByRole('slider', { name: 'Bass 볼륨' }).inputValue()
    expect(Number(value)).toBeGreaterThan(35)
    expect(Number(value)).toBeLessThan(65)
    await page.setViewportSize({ width: 800, height: 915 })
    await expect(page.getByRole('slider', { name: 'Bass 볼륨' })).toHaveValue(value)
    await expect(page.getByRole('button', { name: 'Piano Mute', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Original', exact: true }).tap()
    await page.getByRole('button', { name: '재생', exact: true }).tap()
    await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  })
})
