import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Connect, Plugin } from 'vite'
import { modelProxy } from './modelProxy.ts'

/** Local HTTP adapter for the same handler used by the deployed Worker. */
export function viteModelProxy(upstreamFetch: typeof fetch = fetch): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) { next(); return }
    const controller = new AbortController()
    const abort = () => { if (!res.writableFinished) controller.abort() }
    res.once('close', abort)
    void (async () => {
      try {
        const response = await modelProxy(new Request(url, { method: req.method, signal: controller.signal }), upstreamFetch)
        if (controller.signal.aborted) { await response.body?.cancel(); return }
        res.writeHead(response.status, Object.fromEntries(response.headers))
        if (response.body) await pipeline(Readable.fromWeb(response.body), res, { signal: controller.signal })
        else res.end()
      } catch {
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ error: 'Model stream failed' }))
        } else res.destroy()
      } finally { res.off('close', abort) }
    })()
  }
  return {
    name: 'same-origin-model-proxy',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}
