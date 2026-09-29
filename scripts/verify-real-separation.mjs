// Optional hardware/runtime check; never runs with the ordinary unit suite.
// Usage: MODEL_PATH=/tmp/model.onnx APP_URL=http://127.0.0.1:5180 node scripts/verify-real-separation.mjs
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { createReadStream, statSync, writeFileSync } from 'node:fs'
import { chordAudio } from '../tests/fixtures/chordAudio.ts'
const modelPath = process.env.MODEL_PATH
if (!modelPath) throw new Error('Set MODEL_PATH to the separately downloaded FP16 model (not a git file)')
const revision = 'a744f80957374e1735ad70fa122670b7961da8cc'
const key = `${revision}-bs_roformer_sw_6stem_fp16.onnx`
const size = statSync(modelPath).size
if (size !== 352778874) throw new Error('Wrong model file size')
const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Access-Control-Allow-Origin': '*' }); createReadStream(modelPath).pipe(res) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const modelUrl = `http://127.0.0.1:${server.address().port}/model`
const browser = await chromium.launch({ args: process.env.SOFTWARE_GPU === '1' ? ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [], timeout: 30000 }).catch((error) => { server.close(); throw error })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGE ERROR', e.message) })
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 600)) })
try {
  await page.addInitScript(() => {
    const start = AudioBufferSourceNode.prototype.start
    window.stemProbeBuffers = []
    AudioBufferSourceNode.prototype.start = function (...args) { if (this.buffer) window.stemProbeBuffers.push(this.buffer); return start.apply(this, args) }
  })
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5180')
  const gpu = await page.evaluate(async () => { const a = await navigator.gpu?.requestAdapter(); return { available: !!a, fp16: a?.features.has('shader-f16') ?? false, vendor: a?.info.vendor, architecture: a?.info.architecture, device: a?.info.device, description: a?.info.description } })
  console.log('WebGPU', gpu)
  if (!gpu.available || !gpu.fp16) {
    if (gpu.available) await page.getByText('이 GPU는 FP16 분리 모델을 지원하지 않습니다.', { exact: false }).waitFor({ state: 'visible' })
    await page.locator('.separation-panel').screenshot({ path: '/tmp/music-fp16-unsupported.png' })
    writeFileSync('/tmp/music-real-separation.json', JSON.stringify({ passed: false, status: 'unsupported', gpu, modelBytes: size }, null, 2))
    throw new Error(!gpu.available ? 'No WebGPU adapter; run on a supported GPU browser' : 'This adapter lacks shader-f16; use an FP16-capable WebGPU device')
  }
  await page.evaluate(async ({ key, size, revision, modelUrl }) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('music-dissector-models', { create: true })
    const writer = await (await dir.getFileHandle(key, { create: true })).createWritable()
    const response = await fetch(modelUrl)
    await response.body.pipeTo(writer)
    const marker = await (await dir.getFileHandle(`${key}.json`, { create: true })).createWritable()
    await marker.write(JSON.stringify({ revision, size })); await marker.close()
  }, { key, size, revision, modelUrl })
  await page.reload()
  const fixture = chordAudio()
  fixture.buffer = fixture.buffer.subarray(0, 44 + 22050 * 4 * 2)
  fixture.buffer.writeUInt32LE(fixture.buffer.length - 8, 4); fixture.buffer.writeUInt32LE(fixture.buffer.length - 44, 40)
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(fixture)
  await page.getByRole('button', { name: '분리 시작', exact: true }).click()
  const started = Date.now()
  for (;;) {
    const status = await page.locator('.separation-status').textContent()
    const error = await page.locator('.separation-error').count() ? await page.locator('.separation-error').textContent() : ''
    console.log(`${Math.round((Date.now() - started) / 1000)}s`, status, error)
    if (error) throw new Error(error)
    if (status.includes('분리 완료')) break
    if (Date.now() - started > 15 * 60 * 1000) throw new Error('Real-model timeout')
    await new Promise((r) => setTimeout(r, 5000))
  }
  await page.getByRole('button', { name: 'Stem Mix', exact: true }).click()
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await new Promise((r) => setTimeout(r, 400))
  console.log('Playback status', await page.locator('.playback-status').textContent(), await page.locator('.player-error').allTextContents())
  const stems = await page.evaluate(() => window.stemProbeBuffers.slice(-6).map((b) => {
    let energy = 0; let finite = true
    for (let c = 0; c < b.numberOfChannels; c++) for (const value of b.getChannelData(c)) { energy += value * value; if (!Number.isFinite(value)) finite = false }
    return { channels: b.numberOfChannels, length: b.length, sampleRate: b.sampleRate, rms: Math.sqrt(energy / (b.length * b.numberOfChannels)), finite }
  }))
  const passed = stems.length === 6 && stems.every((s) => s.finite && s.channels === 2 && s.length === 176400 && s.sampleRate === 44100) && stems.some((s) => s.rms > .00001) && errors.length === 0
  const report = { passed, gpu, modelBytes: size, elapsedMs: Date.now() - started, stems, errors }
  writeFileSync('/tmp/music-real-separation.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  if (!passed) throw new Error('Invalid or silent output')
  await page.screenshot({ path: '/tmp/music-real-separation.png', fullPage: true })
} finally { await browser.close(); server.close() }
