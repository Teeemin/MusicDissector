import { MixExportError } from './exportTypes'

export function downloadMix(blob: Blob, filename: string) {
  let url: string | null = null
  const link = document.createElement('a')
  try {
    if (blob.size === 0) throw new MixExportError('download')
    url = URL.createObjectURL(blob)
    link.href = url; link.download = filename; link.hidden = true
    document.body.append(link)
    link.click()
  } catch {
    if (url) URL.revokeObjectURL(url)
    throw new MixExportError('download')
  } finally { link.remove() }
  // Keep the URL alive for asynchronous mobile download handoff, then release.
  // Neither the store nor the UI retains the Blob or rendered PCM.
  const revoke = () => { if (url) URL.revokeObjectURL(url); url = null; clearTimeout(timer); window.removeEventListener('pagehide', revoke) }
  const timer = setTimeout(revoke, 30_000)
  window.addEventListener('pagehide', revoke, { once: true })
}
