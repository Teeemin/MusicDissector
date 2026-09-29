import { extractMetadata } from './extractMetadata'
import type { MetadataResponse } from './types'

self.onmessage = async (event: MessageEvent<File>) => {
  let response: MetadataResponse
  try {
    response = { ok: true, result: await extractMetadata(event.data) }
  } catch {
    response = { ok: false }
  }
  self.postMessage(response)
}
