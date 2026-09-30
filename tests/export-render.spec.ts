import { expect, test } from '@playwright/test'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { mixFilename } from '../src/export/mixSnapshot'

test.use({ serviceWorkers: 'block' })
let server: ViteDevServer
let origin: string
test.beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false } })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('No test server')
  origin = `http://127.0.0.1:${address.port}`
})
test.afterAll(async () => { await server?.close() })
test.beforeEach(async ({ page }) => { await page.goto(origin) })

test('offline mix starts every source at zero; attenuates peaks without altering relative stereo balance', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderMix } = await import('/src/export/renderMix.ts')
    const ids = ['vocals', 'guitar', 'piano', 'drums', 'bass', 'others']
    const stems = ids.map(id => {
      const buffer = new AudioBuffer({ length: 2048, numberOfChannels: 2, sampleRate: 44100 })
      buffer.getChannelData(0).fill(.5); buffer.getChannelData(1).fill(-.25)
      return { id, buffer, gain: 1 }
    })
    const output = await renderMix(stems, new AbortController().signal)
    return { left: Array.from(output.getChannelData(0)), right: Array.from(output.getChannelData(1)), length: output.length, rate: output.sampleRate }
  })
  expect(result.length).toBe(2048); expect(result.rate).toBe(44100)
  for (const value of result.left) expect(value).toBeCloseTo(.99, 7)
  for (const value of result.right) expect(value).toBeCloseTo(-.495, 7)
})

test('quiet output remains bit-identical, while non-finite output fails', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { protectPeak } = await import('/src/export/renderMix.ts')
    const buffer = new AudioBuffer({ length: 3, numberOfChannels: 2, sampleRate: 44100 })
    buffer.getChannelData(0).set([.25, -.5, 0]); buffer.getChannelData(1).set([0, .125, -.25])
    const before = [Array.from(buffer.getChannelData(0)), Array.from(buffer.getChannelData(1))]
    const stats = await protectPeak(buffer, new AbortController().signal)
    const after = [Array.from(buffer.getChannelData(0)), Array.from(buffer.getChannelData(1))]
    const errors = []
    for (const invalid of [NaN, Infinity, -Infinity]) {
      buffer.getChannelData(1)[2] = invalid
      try { await protectPeak(buffer, new AbortController().signal) } catch (e) { errors.push((e as { code: string }).code) }
    }
    return { before, after, stats, errors }
  })
  expect(result.before).toEqual(result.after)
  expect(result.stats).toEqual({ peak: .5, gain: 1 })
  expect(result.errors).toEqual(['non-finite', 'non-finite', 'non-finite'])
})

test('rejects missing, mismatched and corrupt stems, including muted invalid input; render failure is distinct', async ({ page }) => {
  const errors = await page.evaluate(async () => {
    const { validateStems, renderMix } = await import('/src/export/renderMix.ts')
    const make = () => ['vocals', 'guitar', 'piano', 'drums', 'bass', 'others'].map(id => ({ id, gain: 1, buffer: new AudioBuffer({ length: 16, numberOfChannels: 2, sampleRate: 44100 }) }))
    const bad = [make().slice(1), ...[0, 1, 2, 3, 4].map(type => {
      const stems = make()
      if (type < 3) stems[0].buffer = new AudioBuffer({ length: type === 0 ? 17 : 16, numberOfChannels: type === 1 ? 1 : 2, sampleRate: type === 2 ? 48000 : 44100 })
      else if (type === 3) { stems[0].gain = 0; stems[0].buffer.getChannelData(0)[1] = NaN }
      else stems[0].gain = Infinity
      return stems
    })]
    const result = []
    for (const stems of bad) {
      try { await validateStems(stems, new AbortController().signal) } catch (e) { result.push((e as { code: string }).code) }
    }
    OfflineAudioContext.prototype.startRendering = () => Promise.reject(new Error('Memory unavailable'))
    try { await renderMix(make(), new AbortController().signal) } catch (e) { result.push((e as { code: string }).code) }
    return result
  })
  expect(errors).toEqual(['no-stems', ...Array(5).fill('invalid-stems'), 'render'])
})

test('filename sanitization preserves readable Unicode and bounds UTF-8 length', () => {
  expect(mixFilename('  밤편지:라이브/2026?  ')).toBe('밤편지_라이브_2026_ - MuDissector Mix.mp3')
  expect(mixFilename('\n...')).toBe('Music - MuDissector Mix.mp3')
  expect(new TextEncoder().encode(mixFilename('곡'.repeat(200))).length).toBeLessThan(255)
})
