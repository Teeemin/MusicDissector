import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { taggedWav } from './audio'
import { MODEL } from '../../src/separation/separationTypes'

export async function supported(page: Page) {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { configurable: true, value: {
    requestAdapter: async () => ({ limits: { maxStorageBuffersPerShaderStage: 8 }, features: new Set(['shader-f16']), info: { description: 'Test adapter' } }),
  } }))
}
export async function cacheModel(page: Page) {
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
export async function fakeInference(page: Page, delay = 0, amplitude = .05) {
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
          for (let i=0; i<n; i++) { out[i] = ${amplitude} * Math.sin(i * 2 * Math.PI * (s+1)*110/44100); out[n+i] = out[i] * .8; }
          return out;
        });
        self.postMessage({kind: 'progress', stage: 'post-processing', completed: 4, total: 4});
        self.postMessage({kind: 'result', outputs}, outputs.map(a => a.buffer));
      }, ${delay});
    };
  ` }))
}
export async function load(page: Page, name = 'stem-test.wav') {
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ lyrics: '[00:01]시작\n[00:05]다음 줄' }, name, 12))
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled()
}

