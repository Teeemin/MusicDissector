import { expect, test } from '@playwright/test'
import { taggedWav } from './fixtures/audio'

test('Repeat is off by default, toggles accessibly, persists across tracks and resets on reload', async ({ page }) => {
  await page.goto('/')
  const repeat = page.getByRole('button', { name: '반복 재생', exact: true })
  await expect(repeat).toHaveAttribute('aria-pressed', 'false')
  await repeat.click()
  await expect(repeat).toHaveAttribute('aria-pressed', 'true')
  await expect(repeat).toHaveCSS('background-color', 'rgb(3, 90, 166)')
  await expect(repeat).toHaveCSS('color', 'rgb(255, 255, 255)')
  await repeat.hover(); await page.mouse.down()
  await expect(repeat).toHaveCSS('transform', 'matrix(0.97, 0, 0, 0.97, 0, 0)')
  await page.mouse.move(0, 0); await page.mouse.up()
  await expect(repeat).toHaveCSS('transform', 'none')
  for (const name of ['first.wav', 'next.wav']) {
    await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({}, name, 3))
    await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled()
    await expect(repeat).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('재생 위치')).toHaveValue('0')
  }
  await repeat.click()
  await expect(repeat).toHaveAttribute('aria-pressed', 'false')
  await expect(repeat).not.toHaveCSS('background-color', 'rgb(3, 90, 166)')
  await repeat.click()
  await page.reload()
  await expect(repeat).toHaveAttribute('aria-pressed', 'false')
})

test('real Original repeats at the end; disabling Repeat restores natural end and paused seek stays paused', async ({ page }) => {
  await page.addInitScript(() => {
    window.Audio = new Proxy(window.Audio, { construct(target, args) {
      const audio = Reflect.construct(target, args) as HTMLAudioElement
      Object.assign(window, { repeatAudio: audio })
      return audio
    } })
  })
  await page.goto('/')
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({}, 'repeat.wav', 4))
  const play = page.getByRole('button', { name: '재생', exact: true })
  const pause = page.getByRole('button', { name: '일시 정지', exact: true })
  const seek = page.getByLabel('재생 위치')
  const repeat = page.getByRole('button', { name: '반복 재생', exact: true })
  await expect(play).toBeEnabled()
  await repeat.click()
  for (let cycle = 0; cycle < 2; cycle++) {
    await seek.fill('3.4')
    if (cycle === 0) await play.click()
    await expect.poll(async () => Number(await seek.inputValue())).toBeLessThan(1)
    await expect(pause).toBeVisible()
    expect(await page.evaluate(() => {
      const audio = (window as unknown as { repeatAudio: HTMLAudioElement }).repeatAudio
      return { loop: audio.loop, paused: audio.paused, ended: audio.ended }
    })).toEqual({ loop: true, paused: false, ended: false })
  }
  await repeat.click()
  await seek.fill('3.5')
  await expect(play).toBeVisible()
  await expect(seek).toHaveValue('4')
  expect(await page.evaluate(() => (window as unknown as { repeatAudio: HTMLAudioElement }).repeatAudio.ended)).toBe(true)
  await repeat.click()
  // Enabling Repeat at the end is a preference change, not a play command.
  await expect(play).toBeVisible()
  await seek.fill('2')
  await page.waitForTimeout(200)
  await expect(seek).toHaveValue('2')
  await expect(play).toBeVisible()
})

for (const width of [320, 360, 412, 700, 800, 1280]) {
  test(`compact player keeps controls in order and usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ title: '테스트 음악', artist: '테스트 가수', album: '테스트 앨범', artwork: true }))
    await expect(page.getByRole('heading', { name: '테스트 음악', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled()
    await expect(page.getByText('FROM YOUR DEVICE', { exact: true })).toHaveCount(0)
    await expect(page.getByText('ORIGINAL AUDIO', { exact: true })).toHaveCount(0)
    const controls = page.locator('.playback-buttons')
    const boxes = await Promise.all((await controls.locator(':scope > *').all()).map(element => element.boundingBox()))
    expect(boxes).toHaveLength(5)
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i]!.y + boxes[i]!.height / 2).toBeCloseTo(boxes[2]!.y + boxes[2]!.height / 2, 0)
      if (i > 0) expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.width - .1)
    }
    for (const button of await controls.getByRole('button').all()) {
      const box = await button.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
    const volume = page.getByLabel('음량', { exact: true })
    const volumeBox = await volume.boundingBox()
    expect(volumeBox!.width).toBeGreaterThanOrEqual(24)
    expect(volumeBox!.height).toBeGreaterThanOrEqual(44)
    expect(boxes[2]!.width).toBe(60)
    const panel = await page.locator('.player-panel').boundingBox()
    expect(boxes[0]!.x).toBeGreaterThan(panel!.x)
    expect(boxes[4]!.x + boxes[4]!.width).toBeLessThan(panel!.x + panel!.width)
    expect(Math.abs(boxes[2]!.x + boxes[2]!.width / 2 - (panel!.x + panel!.width / 2))).toBeLessThanOrEqual(13)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    // The relocated slider remains a real, operable input.
    await volume.fill('0.35')
    await expect(volume).toHaveValue('0.35')
    await page.getByRole('button', { name: '음소거', exact: true }).click()
    await expect(volume).toHaveValue('0')
    await page.getByRole('button', { name: '음소거 해제' }).click()
    await expect(volume).toHaveValue('0.35')
    await page.locator('.player-panel').screenshot({ path: `test-results/player-compact-${width}.png` })
  })
}
