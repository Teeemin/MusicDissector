import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preview } from 'vite'
import { viteModelProxy } from '../worker/viteModelProxy'
import { MODEL_UPSTREAM } from '../worker/modelProxy'
import { MODEL } from '../src/separation/separationTypes'
import { supported } from './fixtures/separationHarness'

test.use({ serviceWorkers: 'block' })

test('same-origin streaming preserves byte progress, cancellation, OPFS promotion, cache reuse and deletion', async ({ playwright }) => {
  test.setTimeout(120_000)
  // Vite preview sets NODE_ENV=production in this process. Restore it so a
  // reused Playwright worker still runs later dev/StrictMode tests in dev mode.
  const previousNodeEnv = process.env.NODE_ENV
  // Chromium's incognito OPFS uses an in-memory filesystem with a separate size
  // cap. A fresh disposable disk profile exercises real full-size promotion.
  const profile = await mkdtemp(join(tmpdir(), 'mudis-model-download-'))
  const context = await playwright.chromium.launchPersistentContext(profile, { serviceWorkers: 'block' })
  const page = await context.newPage()
  const jobs: { release: () => void; cancelled: boolean }[] = []
  // Generated zeroes, never the real 336 MiB model. One bounded chunk in flight;
  // the test explicitly gates the producer after chunk one (no timer/delay).
  const upstream: typeof fetch = async (url, init) => {
    expect(url).toBe(MODEL_UPSTREAM)
    expect(init?.redirect).toBe('follow')
    const job = { release: () => {}, cancelled: false }
    const gate = new Promise<void>(resolve => { job.release = resolve })
    jobs.push(job)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent > 0) await gate
        if (init?.signal?.aborted) { controller.error(new DOMException('Aborted', 'AbortError')); return }
        const chunk = new Uint8Array(Math.min(1024 ** 2, MODEL.bytes - sent))
        sent += chunk.byteLength
        controller.enqueue(chunk)
        if (sent === MODEL.bytes) controller.close()
      },
      cancel() { job.cancelled = true; job.release() },
    })
    init?.signal?.addEventListener('abort', () => { job.cancelled = true; job.release() }, { once: true })
    return new Response(body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(MODEL.bytes) } })
  }
  const server = await preview({ configFile: false, plugins: [viteModelProxy(upstream)], preview: { host: '127.0.0.1', port: 0, strictPort: false } })
  const address = server.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Missing preview server address')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 2 * 1024 ** 3 })
    await cdp.detach()
    await supported(page)
    const external: string[] = []
    const endpoints: string[] = []
    page.on('request', req => {
      if (/huggingface|hf\.co|xethub/.test(req.url())) external.push(req.url())
      if (new URL(req.url()).pathname === MODEL.url) endpoints.push(req.url())
    })
    // Any accidental direct remote model request fails immediately, never downloads.
    await page.route(/https:\/\/(?:[^/]*\.)?(?:huggingface\.co|hf\.co|xethub\.hf\.co)\//, route => route.abort())
    await page.goto(origin)
    const download = page.getByRole('button', { name: '모델 다운로드', exact: true })
    await expect(download).toBeEnabled()
    expect(jobs).toHaveLength(0)
    await download.click()
    const progress = page.getByRole('progressbar', { name: '모델 다운로드 진행률' })
    await expect.poll(async () => Number(await progress.getAttribute('value'))).toBeGreaterThan(0)
    expect(Number(await progress.getAttribute('value'))).toBeLessThan(MODEL.bytes)
    expect(jobs).toHaveLength(1)
    await page.getByRole('button', { name: '다운로드 취소', exact: true }).click()
    await expect(download).toBeEnabled()
    await expect.poll(() => jobs[0].cancelled).toBe(true)
    const files = () => page.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('music-dissector-models')
      const names: string[] = []
      for await (const [name] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) names.push(name)
      return names.sort()
    })
    await expect.poll(files).toEqual([])

    await download.click()
    await expect.poll(async () => Number(await progress.getAttribute('value'))).toBeGreaterThan(0)
    expect(jobs).toHaveLength(2)
    expect(await files()).toContain(`${MODEL.revision}-${MODEL.file}.part`)
    jobs[1].release()
    const remove = page.getByRole('button', { name: '모델 삭제', exact: true })
    await expect(remove.or(page.locator('.separation-error'))).toBeVisible({ timeout: 90_000 })
    await expect(remove).toBeEnabled()
    const key = `${MODEL.revision}-${MODEL.file}`
    expect(await files()).toEqual([key, `${key}.json`])
    expect(await page.evaluate(async key => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('music-dissector-models')
      return {
        bytes: (await (await dir.getFileHandle(key)).getFile()).size,
        marker: JSON.parse(await (await (await dir.getFileHandle(`${key}.json`)).getFile()).text()),
      }
    }, key)).toEqual({ bytes: MODEL.bytes, marker: { revision: MODEL.revision, size: MODEL.bytes } })
    await page.reload()
    await expect(page.getByRole('button', { name: '모델 삭제', exact: true })).toBeEnabled()
    expect(jobs).toHaveLength(2)
    await page.getByRole('button', { name: '모델 삭제', exact: true }).click()
    await expect(download).toBeEnabled()
    expect(await files()).toEqual([])
    expect(external).toEqual([])
    expect(endpoints).toEqual([`${origin}${MODEL.url}`, `${origin}${MODEL.url}`])
  } finally {
    jobs.forEach(job => job.release())
    server.httpServer.closeAllConnections()
    await new Promise<void>(resolve => server.httpServer.close(() => resolve()))
    await context.close()
    await rm(profile, { recursive: true, force: true })
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
})
