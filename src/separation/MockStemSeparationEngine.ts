import type { StemResult, StemSeparationEngine } from './StemSeparationEngine'

export class MockStemSeparationEngine implements StemSeparationEngine {
  separate(_file: File, options?: { signal?: AbortSignal }): Promise<StemResult> {
    if (options?.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
    // No file decoding, copies, inference, artificial delay or fabricated progress.
    return Promise.resolve({
      kind: 'mock',
      processed: false,
      stems: { vocals: null, guitar: null, piano: null, drums: null, bass: null, others: null },
    })
  }
}
