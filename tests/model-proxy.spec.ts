import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import worker from '../worker/index'
import { MODEL_ENDPOINT, MODEL_UPSTREAM, modelProxy } from '../worker/modelProxy'
import { MODEL } from '../src/separation/separationTypes'

const request = () => new Request(`https://musicdissector.example${MODEL_ENDPOINT}`)

test('model proxy returns the original stream before completion and preserves response headers', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller } })
  const headers = {
    'Content-Type': 'application/octet-stream', 'Content-Length': '6',
    ETag: '"pinned-model"', 'Last-Modified': 'Mon, 01 Jun 2026 00:00:00 GMT',
  }
  const upstream = new Response(body, { headers })
  // Catch accidental whole-body buffering even if a future test fixture closes.
  upstream.arrayBuffer = async () => { throw new Error('Must not buffer the model') }
  upstream.blob = async () => { throw new Error('Must not buffer the model') }
  const response = await modelProxy(request(), async (url, init) => {
    expect(url).toBe(MODEL_UPSTREAM)
    expect(init?.redirect).toBe('follow')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    return upstream
  })
  expect(response.status).toBe(200)
  expect(response.body).toBe(body)
  expect(upstream.bodyUsed).toBe(false)
  for (const [key, value] of Object.entries(headers)) expect(response.headers.get(key)).toBe(value)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
  const reader = response.body!.getReader()
  source.enqueue(new Uint8Array([1, 2, 3]))
  expect(await reader.read()).toEqual({ value: new Uint8Array([1, 2, 3]), done: false })
  // Producer only releases the rest after the consumer has received chunk one.
  source.enqueue(new Uint8Array([4, 5, 6])); source.close()
  expect(await reader.read()).toEqual({ value: new Uint8Array([4, 5, 6]), done: false })
  expect((await reader.read()).done).toBe(true)
})

test('upstream redirects are followed server-side without forwarding browser credentials', async () => {
  const paths: string[] = []
  const server = createServer((req, res) => {
    paths.push(req.url!)
    expect(req.headers.cookie).toBeUndefined()
    expect(req.headers.authorization).toBeUndefined()
    expect(req.headers.range).toBeUndefined()
    if (req.url === '/resolve') { res.writeHead(302, { Location: '/signed-file' }); res.end() }
    else { res.writeHead(200, { 'Content-Length': '6', 'Content-Type': 'application/octet-stream' }); res.end('abcdef') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing upstream address')
  try {
    const browserRequest = new Request(request(), { headers: { Cookie: 'private=secret', Authorization: 'Bearer secret', Range: 'bytes=0-2' } })
    const response = await modelProxy(browserRequest, (url, init) => {
      expect(url).toBe(MODEL_UPSTREAM)
      return fetch(`http://127.0.0.1:${address.port}/resolve`, init)
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('6')
    expect(response.headers.has('Location')).toBe(false)
    expect(await response.text()).toBe('abcdef')
    expect(paths).toEqual(['/resolve', '/signed-file'])
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

for (const status of [404, 429, 500, 503]) {
  test(`upstream ${status} remains ${status}, never a successful model response`, async () => {
    const response = await modelProxy(request(), async () => new Response('Upstream failure', { status }))
    expect(response.status).toBe(status)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('Upstream failure')
  })
}

test('network failure and missing upstream bodies return explicit HTTP errors', async () => {
  const unavailable = await modelProxy(request(), async () => { throw new TypeError('Failed to fetch') })
  expect(unavailable.status).toBe(502)
  expect(await unavailable.json()).toEqual({ error: 'Could not reach the model upstream' })
  for (const [status, expected] of [[200, 502], [204, 502], [404, 404], [503, 503]]) {
    const response = await modelProxy(request(), async () => new Response(null, { status }))
    expect(response.status).toBe(expected)
    expect(await response.json()).toEqual({ error: 'Model upstream returned no response body' })
  }
})

test('only the fixed GET endpoint is allowed; no query-driven proxy or API SPA fallback', async () => {
  let upstreamCalls = 0
  const upstream: typeof fetch = async () => { upstreamCalls++; throw new Error('Unexpected upstream fetch') }
  for (const [path, method, status] of [
    ['/api/model/other', 'GET', 404], ['/api/proxy?url=http://localhost', 'GET', 404],
    [MODEL_ENDPOINT, 'POST', 405], [MODEL_ENDPOINT, 'HEAD', 405],
    [`${MODEL_ENDPOINT}?url=https://example.com`, 'GET', 400],
  ] as const) {
    const response = await modelProxy(new Request(`https://app.example${path}`, { method }), upstream)
    expect(response.status).toBe(status)
    if (status === 405) expect(response.headers.get('Allow')).toBe('GET')
  }
  expect(upstreamCalls).toBe(0)
  const assets = { fetch: async () => new Response('static asset') }
  expect(await (await worker.fetch(new Request('https://app.example/player'), { ASSETS: assets })).text()).toBe('static asset')
  expect((await worker.fetch(new Request('https://app.example/api/unknown'), { ASSETS: assets })).status).toBe(404)
})

test('downstream cancellation and errors propagate through the unbuffered body', async () => {
  let cancelled = false
  const response = await modelProxy(request(), async () => new Response(new ReadableStream({ cancel() { cancelled = true } })))
  await response.body!.cancel()
  expect(cancelled).toBe(true)
  let source!: ReadableStreamDefaultController
  const broken = await modelProxy(request(), async () => new Response(new ReadableStream({ start(controller) { source = controller } })))
  const read = broken.body!.getReader().read()
  source.error(new Error('Upstream disconnected'))
  await expect(read).rejects.toThrow('Upstream disconnected')
})

test('same-origin URL changes no pinned model verification or OPFS identity', () => {
  expect(MODEL.url).toBe(MODEL_ENDPOINT)
  expect(MODEL.bytes).toBe(352778874)
  expect(MODEL.revision).toBe('a744f80957374e1735ad70fa122670b7961da8cc')
  expect(MODEL.sha256).toBe('d3d2bac77a7023282cb5f35a5807179e34076b60589867b572275f1a8ec36444')
  expect(MODEL_UPSTREAM).toBe(`https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/${MODEL.revision}/${MODEL.file}`)
})
