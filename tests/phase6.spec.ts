import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { taggedMp3, taggedWav } from './fixtures/audio'
import { MODEL } from '../src/separation/separationTypes'

// Browser integration uses six distinct synthetic outputs. Real ONNX execution is
// intentionally separate: scripts/verify-real-separation.mjs (no routine download).
test.use({ serviceWorkers: 'block' })

async function supported(page: Page) {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { configurable: true, value: {
    requestAdapter: async () => ({ limits: { maxStorageBuffersPerShaderStage: 8 }, features: new Set(['shader-f16']), info: { description: 'Test adapter' } }),
  } }))
}
async function cacheModel(page: Page) {
  // Headless incognito quota can be smaller than the pinned model despite ample
  // disk. Override only this browser test origin; production quota stays real.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(page.url()).origin, quotaSize: 2 * 1024 ** 3 })
  await cdp.detach()
  await page.evaluate(async (model) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('music-dissector-models', { create: true })
    const key = `${model.revision}-${model.file}`
    const file = await (await dir.getFileHandle(key, { create: true })).createWritable()
    await file.truncate(model.bytes); await file.close() // sparse fixture, NOT a real ONNX model
    const marker = await (await dir.getFileHandle(`${key}.json`, { create: true })).createWritable()
    await marker.write(JSON.stringify({ size: model.bytes, revision: model.revision })); await marker.close()
  }, MODEL)
  await page.reload()
  await expect(page.getByText('모델 설치됨 · 약 336 MiB', { exact: false })).toBeVisible()
}
async function fakeInference(page: Page, delay = 0) {
  await page.route('**/stemAudio.worker-*.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    self.onmessage = ({data}) => {
      if (data.kind === 'init') self.postMessage({kind: 'ready'});
      if (data.kind !== 'separate') return;
      const n = data.left.length;
      if (n !== data.right.length || n !== 44100 * 12) throw Error('Incorrect resampling/stereo');
      self.postMessage({kind: 'progress', stage: 'separating', completed: 1, total: 4});
      setTimeout(() => {
        const outputs = Array.from({length: 6}, (_, s) => {
          const out = new Float32Array(n * 2);
          for (let i=0; i<n; i++) { out[i] = .05 * Math.sin(i * 2 * Math.PI * (s+1)*110/44100); out[n+i] = out[i] * .8; }
          return out;
        });
        self.postMessage({kind: 'progress', stage: 'post-processing', completed: 4, total: 4});
        self.postMessage({kind: 'result', outputs}, outputs.map(a => a.buffer));
      }, ${delay});
    };
  ` }))
}
async function load(page: Page, name = 'stem-test.wav') {
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ lyrics: '[00:01]시작\n[00:05]다음 줄' }, name, 12))
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled()
}

interface Probe {
  original?: HTMLAudioElement
  gains: GainNode[]
  starts: { when: number; offset: number; rate: number; channels: number; sample: number }[]
  analyser: AnalyserNode | null
}
declare global { interface Window { separationProbe: Probe } }

test('MP3 duration enables 4:13 and 6:00; longer input explains the disabled button and clears on replacement', async ({ page }) => {
  await supported(page)
  // Exercise duration validation with a real, short playable MP3 and controlled
  // media duration. Long AI inference/analysis is intentionally not part of this test.
  await page.addInitScript(() => {
    const duration = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')!
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() {
      const actual = duration.get!.call(this)
      return Number.isFinite(actual) ? Number(document.documentElement.dataset.testDuration ?? actual) : actual
    } })
  })
  await page.goto('/'); await cacheModel(page)
  const button = page.getByRole('button', { name: '분리 시작', exact: true })
  const warning = page.getByText('최대 해부 길이는 6분입니다', { exact: true })
  for (const seconds of [196, 203, 253, 360, 360.001, 361, 253]) {
    await page.evaluate(value => { document.documentElement.dataset.testDuration = String(value) }, seconds)
    await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedMp3({ title: `duration-${seconds}` }))
    await expect(page.getByLabel('재생 위치')).toHaveAttribute('max', String(seconds))
    if (seconds <= 360) {
      await expect(button).toBeEnabled()
      await expect(warning).toHaveCount(0)
    } else {
      await expect(button).toBeDisabled()
      await expect(warning).toBeVisible()
      await expect(button).toHaveAttribute('aria-describedby', 'separation-duration-limit')
      await expect(warning).toHaveCSS('color', 'rgb(155, 69, 85)')
      expect(await warning.evaluate(el => el.previousElementSibling?.textContent)).toBe('분리 시작')
    }
  }
})

test('unsupported GPU never downloads the model and original playback still works', async ({ page }) => {
  let downloads = 0
  await page.route('https://huggingface.co/**', (route) => { downloads++; return route.abort() })
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }))
  await page.goto('/')
  await expect(page.getByText('이 기기/브라우저에서는 GPU 분리를 지원하지 않습니다.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '모델 다운로드', exact: true })).toBeDisabled()
  await load(page)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  expect(downloads).toBe(0)
})

test('WebGPU without shader-f16 cannot start the FP16 model', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: {
    requestAdapter: async () => ({ limits: { maxStorageBuffersPerShaderStage: 8 }, features: new Set() }),
  } }))
  await page.goto('/')
  await expect(page.getByText('이 GPU는 FP16 분리 모델을 지원하지 않습니다.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '모델 다운로드', exact: true })).toBeDisabled()
  await load(page)
  await expect(page.getByRole('button', { name: '분리 시작', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled()
})

test('explicit download failure, persistent OPFS cache and model deletion', async ({ page }) => {
  await supported(page)
  let downloads = 0
  await page.route(MODEL.url, (route) => { downloads++; return route.fulfill({ status: 503, body: 'Unavailable' }) })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '모델 다운로드', exact: true })).toBeEnabled()
  expect(downloads).toBe(0)
  await page.getByRole('button', { name: '모델 다운로드', exact: true }).click()
  await expect(page.locator('.separation-error')).toContainText('다운로드하거나 저장하지 못했습니다')
  expect(downloads).toBe(1)
  await page.unroute(MODEL.url)
  await page.route(MODEL.url, route => { downloads++; return route.fulfill({ body: Buffer.alloc(32), contentType: 'application/octet-stream' }) })
  await page.getByRole('button', { name: '모델 다운로드', exact: true }).click()
  await expect(page.locator('.separation-error')).toContainText('다운로드하거나 저장하지 못했습니다')
  expect(downloads).toBe(2)
  // Incomplete bytes must remove the partial file and never create a ready marker.
  expect(await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('music-dissector-models')
    const names = []; for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name)
    return names
  })).toEqual([])
  await cacheModel(page)
  await page.reload()
  await expect(page.getByRole('button', { name: '모델 삭제', exact: true })).toBeEnabled()
  expect(downloads).toBe(2)
  await page.getByRole('button', { name: '모델 삭제', exact: true }).click()
  await expect(page.getByRole('button', { name: '모델 다운로드', exact: true })).toBeEnabled()
  await page.reload()
  await expect(page.getByRole('button', { name: '모델 다운로드', exact: true })).toBeEnabled()
  expect(await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('music-dissector-models')
    const names = []; for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name)
    return names
  })).toEqual([])
})

test('six actual Web Audio sources share a clock; gains, Guitar routing, seek, lyrics and A/B work', async ({ page }) => {
  await supported(page); await fakeInference(page)
  await page.addInitScript(() => {
    const probe: Probe = window.separationProbe = { gains: [], starts: [], analyser: null }
    const gain = AudioContext.prototype.createGain
    AudioContext.prototype.createGain = function () {
      const node = gain.call(this); probe.gains.push(node)
      if (!probe.analyser) { probe.analyser = this.createAnalyser(); node.connect(probe.analyser) }
      return node
    }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
      probe.starts.push({ when, offset, rate: this.buffer!.sampleRate, channels: this.buffer!.numberOfChannels, sample: this.buffer!.getChannelData(0)[1] })
      if (duration === undefined) start.call(this, when, offset); else start.call(this, when, offset, duration)
    }
  })
  await page.goto('/'); await cacheModel(page); await load(page)
  await page.getByRole('button', { name: '분리 시작', exact: true }).click()
  await expect(page.locator('.separation-status')).toContainText('분리 완료', { timeout: 20000 })
  await expect(page.locator('.stem-channel[data-source="buffer"]')).toHaveCount(6)
  await page.getByRole('button', { name: 'Stem Mix', exact: true }).click()
  await page.getByRole('button', { name: '재생', exact: true }).click()
  const starts = await page.evaluate(() => window.separationProbe.starts)
  expect(starts).toHaveLength(6)
  expect(new Set(starts.map(s => s.when)).size).toBe(1)
  expect(new Set(starts.map(s => s.offset))).toEqual(new Set([0]))
  for (const [i, modelIndex] of [3, 4, 5, 1, 0, 2].entries()) {
    expect(starts[i]).toMatchObject({ rate: 44100, channels: 2 })
    expect(starts[i].sample).toBeCloseTo(.05 * Math.sin(2 * Math.PI * (modelIndex + 1) * 110 / 44100), 7)
  }
  const gains = () => page.evaluate(() => window.separationProbe.gains.slice(1).map(g => Math.round(g.gain.value * 100) / 100))
  const rms = () => page.evaluate(() => { const a = window.separationProbe.analyser!; const data = new Float32Array(a.fftSize); a.getFloatTimeDomainData(data); return Math.sqrt(data.reduce((s, x) => s + x*x, 0) / data.length) })
  await expect.poll(rms).toBeGreaterThan(.03)
  await page.getByRole('button', { name: 'Guitar Solo', exact: true }).click()
  await expect.poll(gains).toEqual([0, 1, 0, 0, 0, 0])
  await expect.poll(rms).toBeGreaterThan(.01)
  await page.getByRole('button', { name: 'Guitar Mute', exact: true }).click()
  await expect.poll(rms).toBeLessThan(.00001)
  await page.getByRole('button', { name: 'No Guitar', exact: true }).click()
  await expect.poll(gains).toEqual([1, 0, 1, 1, 1, 1])
  await page.getByRole('button', { name: 'Vocal Only', exact: true }).click()
  await expect.poll(gains).toEqual([1, 0, 0, 0, 0, 0])
  await page.getByRole('button', { name: 'Guitar Solo', exact: true }).click()
  await expect.poll(gains).toEqual([1, 1, 0, 0, 0, 0])
  await page.getByRole('slider', { name: 'Guitar 볼륨' }).fill('25')
  await expect.poll(gains).toEqual([1, .25, 0, 0, 0, 0])
  await page.getByRole('button', { name: '일시 정지' }).click()
  const paused = Number(await page.getByLabel('재생 위치').inputValue())
  await page.waitForTimeout(150)
  expect(Number(await page.getByLabel('재생 위치').inputValue())).toBe(paused)
  await page.getByLabel('재생 위치').fill('5')
  await page.getByRole('button', { name: '가사', exact: true }).click()
  await page.locator('.plain-lyrics').click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('5')
  await expect(page.locator('.plain-lyrics')).toContainText('다음 줄')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  const resumed = await page.evaluate(() => window.separationProbe.starts.slice(-6))
  expect(new Set(resumed.map(s => s.offset))).toEqual(new Set([5]))
  expect(new Set(resumed.map(s => s.when)).size).toBe(1)
  await page.getByRole('group', { name: '재생 소스' }).getByRole('button', { name: 'Original', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  expect(Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThanOrEqual(5)
  await load(page, 'replacement.wav')
  await expect(page.locator('.stem-channel[data-source="none"]')).toHaveCount(6)
  await expect(page.getByRole('button', { name: 'Stem Mix', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('재생 위치')).toHaveValue('0')
})

test('cancel and file replacement terminate the worker; new job recovers', async ({ page }) => {
  await supported(page); await fakeInference(page, 1500)
  await page.goto('/'); await cacheModel(page); await load(page)
  await page.getByRole('button', { name: '분리 시작', exact: true }).click()
  await expect(page.getByRole('progressbar', { name: '음원 분리 진행률' })).toHaveAttribute('value', '1', { timeout: 20000 })
  await page.getByRole('button', { name: '분리 취소', exact: true }).click()
  await expect(page.locator('.separation-status')).toContainText('취소')
  await page.waitForTimeout(1700)
  await expect(page.locator('.stem-channel[data-source="buffer"]')).toHaveCount(0)
  await page.getByRole('button', { name: '분리 시작', exact: true }).click()
  await expect(page.getByRole('progressbar', { name: '음원 분리 진행률' })).toHaveAttribute('value', '1')
  await load(page, 'new.wav')
  await page.waitForTimeout(1700)
  await expect(page.locator('.stem-channel[data-source="buffer"]')).toHaveCount(0)
  await expect(page.locator('.separation-status')).toContainText('모델 준비 후')
  await page.getByRole('button', { name: '분리 시작', exact: true }).click()
  await expect(page.locator('.separation-status')).toContainText('분리 완료', { timeout: 20000 })
  // Selecting Stem Mix while paused creates no transport yet. Re-separation
  // must still restore Original and keep the player usable after cancellation.
  await page.getByRole('button', { name: 'Stem Mix', exact: true }).click()
  await page.getByRole('button', { name: '분리 시작', exact: true }).click()
  await page.getByRole('button', { name: '분리 취소', exact: true }).click()
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  await expect(page.getByRole('group', { name: '재생 소스' })).toHaveCount(0)
})

test('editing a separated channel from Original auditions the mix at the same position', async ({ page }) => {
  await supported(page); await fakeInference(page)
  await page.addInitScript(() => {
    const probe: Probe = window.separationProbe = { gains: [], starts: [], analyser: null }
    const media = AudioContext.prototype.createMediaElementSource
    AudioContext.prototype.createMediaElementSource = function (audio) { probe.original = audio; return media.call(this, audio) }
    const gain = AudioContext.prototype.createGain
    AudioContext.prototype.createGain = function () {
      const node = gain.call(this); probe.gains.push(node)
      if (!probe.analyser) { probe.analyser = this.createAnalyser(); node.connect(probe.analyser) }
      return node
    }
  })
  await page.goto('/'); await cacheModel(page); await load(page)
  await page.getByRole('button', { name: '분리 시작', exact: true }).click()
  await expect(page.locator('.separation-status')).toContainText('분리 완료', { timeout: 20000 })
  const source = page.getByRole('group', { name: '재생 소스' })
  await expect(source.getByRole('button', { name: 'Original', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('재생 위치').fill('2')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  // Reproduce the reported path: adjust the mixer without visiting the player.
  await page.getByRole('slider', { name: 'Vocals 볼륨' }).fill('20')
  await expect(source.getByRole('button', { name: 'Stem Mix', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  expect(await page.evaluate(() => window.separationProbe.original?.paused)).toBe(true)
  expect(Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThanOrEqual(2)
  const gains = () => page.evaluate(() => window.separationProbe.gains.slice(1).map(g => Math.round(g.gain.value * 100) / 100))
  const rms = () => page.evaluate(() => { const a = window.separationProbe.analyser!; const samples = new Float32Array(a.fftSize); a.getFloatTimeDomainData(samples); return Math.sqrt(samples.reduce((sum, x) => sum + x*x, 0) / samples.length) })
  await expect.poll(gains).toEqual([.2, 1, 1, 1, 1, 1])
  await page.getByRole('button', { name: 'Vocals Solo', exact: true }).click()
  await expect.poll(rms).toBeGreaterThan(.002)
  await page.getByRole('slider', { name: 'Vocals 볼륨' }).fill('0')
  await expect.poll(rms).toBeLessThan(.00001)
  await page.getByRole('slider', { name: 'Vocals 볼륨' }).fill('100')
  await expect.poll(rms).toBeGreaterThan(.02)
  await source.getByRole('button', { name: 'Original', exact: true }).click()
  expect(await page.evaluate(() => window.separationProbe.original?.paused)).toBe(false)
  await page.getByRole('button', { name: 'No Guitar', exact: true }).click()
  await expect(source.getByRole('button', { name: 'Stem Mix', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(gains).toEqual([1, 0, 1, 1, 1, 1])
  await page.getByRole('button', { name: '일시 정지' }).click()
  await source.getByRole('button', { name: 'Original', exact: true }).click()
  await page.getByRole('button', { name: 'Guitar Mute', exact: true }).click()
  await expect(source.getByRole('button', { name: 'Stem Mix', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeVisible()
  await source.getByRole('button', { name: 'Original', exact: true }).click()
  await page.getByRole('button', { name: 'Stem Mix로 듣기', exact: true }).click()
  await expect(source.getByRole('button', { name: 'Stem Mix', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeVisible()
})

test('Stem Mix repeats all six sources together, keeps mix settings, and stops with Repeat off', async ({ page }) => {
  await supported(page); await fakeInference(page)
  await page.addInitScript(() => {
    const probe: Probe = window.separationProbe = { gains: [], starts: [], analyser: null }
    const gain = AudioContext.prototype.createGain
    AudioContext.prototype.createGain = function () {
      const node = gain.call(this); probe.gains.push(node)
      if (!probe.analyser) { probe.analyser = this.createAnalyser(); node.connect(probe.analyser) }
      return node
    }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
      probe.starts.push({ when, offset, rate: this.buffer!.sampleRate, channels: this.buffer!.numberOfChannels, sample: this.buffer!.getChannelData(0)[1] })
      if (duration === undefined) start.call(this, when, offset); else start.call(this, when, offset, duration)
    }
  })
  await page.goto('/'); await cacheModel(page); await load(page)
  await page.getByRole('button', { name: '분리 시작', exact: true }).click()
  await expect(page.locator('.separation-status')).toContainText('분리 완료', { timeout: 20000 })
  await page.getByRole('button', { name: 'Stem Mix', exact: true }).click()
  await page.getByRole('button', { name: 'No Guitar', exact: true }).click()
  await page.getByLabel('음량', { exact: true }).fill('0.5')
  const repeat = page.getByRole('button', { name: '반복 재생', exact: true })
  await repeat.click()
  await page.getByLabel('재생 위치').fill('11.4')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.separationProbe.starts.length)).toBe(12)
  const restarted = await page.evaluate(() => window.separationProbe.starts.slice(-6))
  expect(new Set(restarted.map(s => s.offset))).toEqual(new Set([0]))
  expect(new Set(restarted.map(s => s.when)).size).toBe(1)
  await expect(page.getByRole('button', { name: '일시 정지' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.separationProbe.gains.map(g => Math.round(g.gain.value * 100) / 100))).toEqual([.5, 1, 0, 1, 1, 1, 1])
  await expect.poll(() => page.evaluate(() => {
    const a = window.separationProbe.analyser!
    const samples = new Float32Array(a.fftSize); a.getFloatTimeDomainData(samples)
    return Math.max(...samples.map(Math.abs))
  })).toBeGreaterThan(.01)
  // Mode switches preserve the setting, but toggling while paused never starts audio.
  await page.getByRole('button', { name: '일시 정지' }).click()
  await page.getByRole('group', { name: '재생 소스' }).getByRole('button', { name: 'Original', exact: true }).click()
  await expect(repeat).toHaveAttribute('aria-pressed', 'true')
  expect(await page.getByLabel('재생 위치').inputValue()).not.toBe('12')
  await page.getByRole('button', { name: 'Stem Mix', exact: true }).click()
  await repeat.click()
  await page.getByLabel('재생 위치').fill('11.5')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeVisible()
  await expect(page.getByLabel('재생 위치')).toHaveValue('12')
  const endedCount = await page.evaluate(() => window.separationProbe.starts.length)
  await repeat.click()
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => window.separationProbe.starts.length)).toBe(endedCount)
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeVisible()
  await load(page, 'replacement-repeat.wav')
  await expect(repeat).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('재생 위치')).toHaveValue('0')
  await expect(page.getByRole('button', { name: 'Stem Mix', exact: true })).toHaveCount(0)
})
