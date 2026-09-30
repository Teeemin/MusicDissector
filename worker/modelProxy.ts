// Server-only upstream: no client URL, query string or header selects a target.
export const MODEL_ENDPOINT = '/api/model/bs-roformer-sw-6stem-fp16'
export const MODEL_UPSTREAM = 'https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/a744f80957374e1735ad70fa122670b7961da8cc/bs_roformer_sw_6stem_fp16.onnx'

function failure(status: number, message: string, headers?: Record<string, string>) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

/** Pass through the body stream; never materialize this 336 MiB file in memory. */
export async function modelProxy(request: Request, upstreamFetch: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname !== MODEL_ENDPOINT) return failure(404, 'Unknown API endpoint')
  if (request.method !== 'GET') return failure(405, 'Only GET is supported', { Allow: 'GET' })
  if (url.search) return failure(400, 'This endpoint does not accept query parameters')

  let upstream: Response
  try {
    upstream = await upstreamFetch(MODEL_UPSTREAM, {
      method: 'GET', redirect: 'follow', signal: request.signal,
      // No forwarding of client credentials, Range or conditional headers.
      headers: { 'Accept-Encoding': 'identity' },
    })
  } catch {
    return failure(502, 'Could not reach the model upstream')
  }
  if (!upstream.body) {
    return failure(upstream.status >= 400 ? upstream.status : 502, 'Model upstream returned no response body')
  }
  const headers = new Headers({
    // OPFS is the persistent cache. Avoid another full model in HTTP/PWA caches.
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  for (const name of ['Content-Type', 'Content-Length', 'ETag', 'Last-Modified', 'Content-Encoding']) {
    const value = upstream.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream')
  return new Response(upstream.body, { status: upstream.status, headers })
}
