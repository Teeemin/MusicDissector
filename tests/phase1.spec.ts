import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/** Real, decodable PCM audio; no mocked player state or media events. */
function wavFile(name = '나의 음악.wav', seconds = 24) {
  const sampleRate = 8000
  const samples = seconds * sampleRate
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 4000), 44 + i * 2)
  return { name, mimeType: 'audio/wav', buffer }
}

async function loadTrack(page: Page, name?: string) {
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(wavFile(name))
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled()
  await expect(page.getByLabel('재생 위치')).toHaveAttribute('max', '24')
}

test('real audio playback, pause, seek, skips, volume, end and replay', async ({ page }) => {
  const errors: string[] = []
  const uploads: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => { if (request.method() !== 'GET') uploads.push(request.url()) })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeDisabled()
  await page.screenshot({ path: 'test-results/stemlab-desktop-empty.png', fullPage: true })
  await loadTrack(page)
  await expect(page.getByRole('heading', { name: '나의 음악', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(0.1)
  await page.getByRole('button', { name: '일시 정지' }).click()
  await page.getByLabel('재생 위치').press('Home')
  await page.getByRole('button', { name: '10초 뒤로' }).click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('0')
  await page.getByRole('button', { name: '10초 앞으로' }).click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('10')
  await page.getByLabel('재생 위치').press('ArrowRight')
  await expect(page.getByLabel('재생 위치')).toHaveValue('10.1')
  await page.getByLabel('음량', { exact: true }).press('Home')
  await page.getByLabel('음량', { exact: true }).press('ArrowRight')
  await expect(page.getByLabel('음량', { exact: true })).toHaveValue('0.01')
  await page.getByRole('button', { name: '음소거', exact: true }).click()
  await expect(page.getByLabel('음량', { exact: true })).toHaveValue('0')
  await page.getByRole('button', { name: '음소거 해제' }).click()
  await expect(page.getByLabel('음량', { exact: true })).toHaveValue('0.01')
  await page.getByLabel('재생 위치').press('End')
  await expect(page.getByLabel('재생 위치')).toHaveValue('24')
  await page.getByRole('button', { name: '10초 앞으로' }).click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('24')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeLessThan(3)
  await page.getByRole('button', { name: '일시 정지' }).click()
  await page.getByLabel('재생 위치').press('End')
  await page.getByLabel('재생 위치').press('ArrowLeft')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeVisible()
  await expect(page.getByLabel('재생 위치')).toHaveValue('24')
  expect(errors).toEqual([])
  expect(uploads).toEqual([])
})

test('invalid, empty and corrupt files recover without fake playback', async ({ page }) => {
  await page.goto('/')
  await loadTrack(page)
  const input = page.getByLabel('음악 파일', { exact: true })
  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') })
  await expect(page.getByRole('alert')).toContainText('MP3, WAV, FLAC, M4A')
  await expect(page.getByRole('heading', { name: '나의 음악', exact: true })).toBeVisible()
  await input.setInputFiles({ name: 'empty.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(0) })
  await expect(page.getByRole('alert')).toContainText('빈 파일')
  await input.setInputFiles({ name: 'broken.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('This is not an audio stream') })
  await expect(page.getByRole('alert')).toContainText('이 파일을 재생할 수 없어요')
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeDisabled()
  await loadTrack(page)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('replacement, same-file selection and drag-and-drop release old file URLs', async ({ page }) => {
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL)
    Object.assign(window, { revokedUrls: [] as string[] })
    URL.revokeObjectURL = (url) => {
      (window as unknown as { revokedUrls: string[] }).revokedUrls.push(url)
      original(url)
    }
  })
  await page.goto('/')
  await loadTrack(page)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  await loadTrack(page, '두 번째 음악.WAV')
  await expect(page.getByLabel('재생 위치')).toHaveValue('0')
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeVisible()
  await loadTrack(page, '두 번째 음악.WAV')
  expect(await page.evaluate(() => (window as unknown as { revokedUrls: string[] }).revokedUrls.length)).toBe(2)
  const file = wavFile('드롭한 음악.wav')
  const transfer = await page.evaluateHandle(({ name, bytes }) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], name, { type: 'audio/wav' }))
    return data
  }, { name: file.name, bytes: [...file.buffer] })
  await page.locator('.drop-zone').dispatchEvent('drop', { dataTransfer: transfer })
  await transfer.dispose()
  await expect(page.getByRole('heading', { name: '드롭한 음악', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled()
})

for (const width of [320, 412, 800]) {
  test(`responsive layout, long filenames and keyboard seek at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 915 })
    await page.goto('/')
    await page.screenshot({ path: `test-results/stemlab-${width}-empty.png`, fullPage: true })
    await loadTrack(page, '매우_긴_이름의_음악_파일_'.repeat(12) + '.wav')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const library = await page.locator('.library-panel').boundingBox()
    const player = await page.locator('.player-panel').boundingBox()
    if (width < 700) expect(player!.y).toBeGreaterThan(library!.y + library!.height)
    else expect(player!.y).toBe(library!.y)
    await page.getByLabel('재생 위치').press('End')
    await expect(page.getByLabel('재생 위치')).toHaveValue('24')
    await page.getByRole('button', { name: '10초 뒤로' }).click()
    await expect(page.getByLabel('재생 위치')).toHaveValue('14')
    await page.screenshot({ path: `test-results/stemlab-${width}.png`, fullPage: true })
  })
}

test('installable manifest, icons and offline reload with local playback', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!
    return (await fetch(link.href)).json()
  })
  expect(manifest.name).toBe('StemLab')
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
    expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
    expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
  ]))
  for (const icon of manifest.icons) {
    const dimensions = await page.evaluate(async (src: string) => {
      const image = new Image()
      image.src = src
      await image.decode()
      return `${image.naturalWidth}x${image.naturalHeight}`
    }, icon.src)
    expect(dimensions).toBe(icon.sizes)
  }
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Page.enable')
  await expect.poll(async () => (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([])
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await loadTrack(page)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(0)
})

test('installation guidance opens and can be dismissed by keyboard', async ({ page }) => {
  // Suppress the optional browser prompt to exercise the manual-install fallback.
  await page.addInitScript(() => window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); event.stopImmediatePropagation() }))
  await page.goto('/')
  await page.getByRole('button', { name: '앱 설치', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('홈 화면에 추가')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test.describe('mobile touch playback', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })

  test('touch play and seek produce Web Audio output and survive unfolding', async ({ page }) => {
    await page.addInitScript(() => {
      const original = AudioContext.prototype.createMediaElementSource
      AudioContext.prototype.createMediaElementSource = function (element) {
        const source = original.call(this, element)
        const analyser = this.createAnalyser()
        source.connect(analyser)
        Object.assign(window, { audioProbe: analyser })
        return source
      }
    })
    await page.goto('/')
    await loadTrack(page)
    await page.getByRole('button', { name: '재생', exact: true }).tap()
    await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const probe = (window as unknown as { audioProbe?: AnalyserNode }).audioProbe
      if (!probe) return 0
      const samples = new Float32Array(probe.fftSize)
      probe.getFloatTimeDomainData(samples)
      return Math.max(...samples.map(Math.abs))
    })).toBeGreaterThan(0.05)
    await page.getByRole('button', { name: '일시 정지' }).tap()
    const seek = page.getByLabel('재생 위치')
    await seek.tap()
    await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(10)
    await expect.poll(async () => Number(await seek.inputValue())).toBeLessThan(14)
    const position = await seek.inputValue()
    await page.setViewportSize({ width: 800, height: 915 })
    await expect(seek).toHaveValue(position)
    await page.getByRole('button', { name: '재생', exact: true }).tap()
    await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
