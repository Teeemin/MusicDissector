import { modelProxy } from './modelProxy'

interface Env { ASSETS: { fetch(request: Request): Promise<Response> } }

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/api' || path.startsWith('/api/')) return modelProxy(request)
    return env.ASSETS.fetch(request)
  },
}
