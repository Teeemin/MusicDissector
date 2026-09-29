import type { StemAudioSource, StemId } from '../mixer/mixerTypes'
import type { SeparationOptions } from './separationTypes'

export type StemResult =
  | { kind: 'mock'; processed: false; stems: Record<StemId, null> }
  | { kind: 'separated'; processed: true; stems: Record<StemId, StemAudioSource> }

export interface StemSeparationEngine {
  separate(file: File, options?: SeparationOptions): Promise<StemResult>
}
