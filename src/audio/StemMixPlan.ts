import { effectiveGain } from '../mixer/mixerRules'
import { STEM_DEFINITIONS } from '../mixer/mixerTypes'
import type { MixerState } from '../mixer/mixerTypes'

/** Future backend contract: all buffers use this ONE AudioContext time and ONE
 * track offset when scheduling source.start(contextTime, offsetSeconds).
 * Pause/seek recreates all buffer sources at a shared time, never six media clocks.
 * No backend is instantiated and no nodes are scheduled in Phase 3.
 */
export interface SharedStemStart {
  contextTime: number
  offsetSeconds: number
}

/** Pure routing description for a future source -> per-stem GainNode -> master.
 * Null sources are deliberately retained; they are not copies of the original.
 */
export function createStemMixPlan(state: MixerState) {
  return {
    trackId: state.trackId,
    channels: STEM_DEFINITIONS.map(({ id }) => ({ id, source: state.channels[id].source, gain: effectiveGain(state.channels, id) })),
  }
}
