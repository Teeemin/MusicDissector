import type { StemAudioSource, StemId } from '../mixer/mixerTypes'

export type StemResult =
  | { kind: 'mock'; processed: false; stems: Record<StemId, null> }
  | { kind: 'separated'; processed: true; stems: Record<StemId, StemAudioSource> }

export interface StemSeparationEngine {
  separate(file: File, options?: { signal?: AbortSignal }): Promise<StemResult>
}
