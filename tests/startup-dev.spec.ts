import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger, createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { analysisAudio } from './fixtures/analysisAudio'
import { id3Tag, taggedWav } from './fixtures/audio'

test.describe('development startup with a cold dependency cache', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ serviceWorkers: 'block' })
  let server: ViteDevServer
  let cacheDir: string
  let origin: string
  const messages: string[] = []

  test.beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'mudis-startup-'))
    const logger = createLogger('warn')
    logger.info = message => { messages.push(message) }
    server = await createServer({
      cacheDir,
      customLogger: logger,
      server: { host: '127.0.0.1', port: 0, strictPort: false },
      // Test-only entry: exercise real App unmount/mount and StrictMode effect
      // replay while the singleton audio session already holds a selected file.
      plugins: [{
        name: 'strict-mode-test-entry',
        resolveId(id) { if (id === '/__strict_test.tsx') return '\0strict-test' },
        load(id) {
          if (id !== '\0strict-test') return
          return `
            import { StrictMode, createElement, useEffect } from 'react';
            import { createRoot } from 'react-dom/client';
            import App from '/src/App.tsx';
            import '/src/index.css';
            const root = createRoot(document.getElementById('root'));
            let generation = 0;
            window.effectProbe = { setups: 0, cleanups: 0 };
            function Probe() {
              useEffect(() => {
                window.effectProbe.setups++;
                return () => { window.effectProbe.cleanups++; };
              }, []);
              return createElement(App);
            }
            window.remountApp = () => root.render(createElement(StrictMode, null,
              createElement(Probe, { key: ++generation })));
            window.remountApp();
          `
        },
      }],
    })
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing dev server address')
    origin = `http://127.0.0.1:${address.port}`
  })
  test.afterAll(async () => {
    await server?.close()
    if (cacheDir) await rm(cacheDir, { recursive: true, force: true })
  })

  test('first selection survives real metadata/BPM worker discovery without a dev reload', async ({ page }) => {
    test.setTimeout(60_000)
    let documents = 0
    const reloads: string[] = []
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) documents++ })
    page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
      if (String(payload).includes('"type":"full-reload"')) reloads.push(String(payload))
    }))
    await page.goto(origin)
    // A real rhythmic PCM file with real ID3 metadata; neither worker is mocked.
    const file = analysisAudio()
    const tags = id3Tag({ title: '첫 번째 선택', artist: '시작 가수', album: '시작 앨범', artwork: true })
    const chunk = Buffer.alloc(8); chunk.write('id3 '); chunk.writeUInt32LE(tags.length, 4)
    file.buffer = Buffer.concat([file.buffer, chunk, tags, Buffer.alloc(tags.length % 2)])
    file.buffer.writeUInt32LE(file.buffer.length - 8, 4)
    await page.getByLabel('음악 파일', { exact: true }).setInputFiles(file)
    await expect(page.getByRole('heading', { name: '첫 번째 선택', exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.track-artist')).toHaveText('시작 가수')
    await expect(page.locator('.track-album')).toHaveText('시작 앨범')
    await expect(page.locator('.track-artwork')).toBeVisible()
    await expect(page.locator('.analysis-status')).toHaveText('분석 완료 · 추정값', { timeout: 30_000 })
    expect(Number(await page.getByTestId('analysis-bpm').textContent())).toBeGreaterThanOrEqual(118)
    expect(Number(await page.getByTestId('analysis-bpm').textContent())).toBeLessThanOrEqual(122)
    await page.getByRole('button', { name: '재생', exact: true }).click()
    await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(.2)
    // The separation worker is also lazy. Fetch its real transformed dependency
    // graph, without loading a model or running GPU inference.
    await server.transformRequest('/src/workers/stemAudio.worker.ts')
    expect(documents).toBe(1)
    expect(reloads).toEqual([])
    expect(messages.filter(message => message.includes('optimized dependencies changed'))).toEqual([])
    await expect(page.getByRole('heading', { name: '첫 번째 선택', exact: true })).toBeVisible()
  })

  test('StrictMode replay and view remount do not own or reset the selected session', async ({ page }) => {
    const html = await server.transformIndexHtml('/__strict_test.html', '<div id="root"></div><script type="module" src="/__strict_test.tsx"></script>')
    await page.route('**/__strict_test.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto(`${origin}/__strict_test.html`)
    await expect.poll(() => page.evaluate(() => (window as unknown as { effectProbe: { setups: number } }).effectProbe?.setups)).toBe(2)
    await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ title: '유지할 세션', artwork: true }, 'strict.wav', 12))
    const title = page.getByRole('heading', { name: '유지할 세션', exact: true })
    await expect(title).toBeVisible()
    const artwork = await page.locator('.track-artwork').getAttribute('src')
    await page.getByLabel('재생 위치').fill('3')
    await page.getByRole('button', { name: '반복 재생', exact: true }).click()
    await page.getByRole('button', { name: '재생', exact: true }).click()
    await page.evaluate(() => (window as unknown as { remountApp: () => void }).remountApp())
    await expect.poll(() => page.evaluate(() => (window as unknown as { effectProbe: { setups: number; cleanups: number } }).effectProbe)).toEqual({ setups: 4, cleanups: 3 })
    await expect(title).toBeVisible()
    await expect(page.locator('.track-artwork')).toHaveAttribute('src', artwork!)
    await expect(page.getByRole('button', { name: '반복 재생', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '일시 정지', exact: true })).toBeVisible()
    await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(3)
  })
})
