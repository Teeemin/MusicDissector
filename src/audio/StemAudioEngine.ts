import { STEM_DEFINITIONS } from '../mixer/mixerTypes'
import type { MixerState } from '../mixer/mixerTypes'
import { effectiveGain } from '../mixer/mixerRules'

/** Six buffer sources on ONE existing AudioContext, started at the same sample time. */
export class StemAudioEngine {
  private context: AudioContext
  private master: GainNode
  private gains: GainNode[]
  private sources: AudioBufferSourceNode[] = []
  private state: MixerState
  private offset = 0
  private startedAt = 0
  constructor(context: AudioContext, state: MixerState) {
    this.context = context; this.state = state
    this.master = context.createGain(); this.master.connect(context.destination)
    this.gains = STEM_DEFINITIONS.map(() => { const gain = context.createGain(); gain.connect(this.master); return gain })
    this.updateMix(state)
  }
  get duration() { return this.state.channels.vocals.source?.buffer.duration ?? 0 }
  get playing() { return this.sources.length > 0 }
  get currentTime() { return Math.min(this.duration, this.offset + (this.playing ? Math.max(0, this.context.currentTime - this.startedAt) : 0)) }
  updateMix(state: MixerState) {
    this.state = state
    STEM_DEFINITIONS.forEach(({ id }, i) => this.gains[i].gain.setTargetAtTime(effectiveGain(state.channels, id), this.context.currentTime, .008))
  }
  setVolume(volume: number, muted: boolean) { this.master.gain.setTargetAtTime(muted ? 0 : volume, this.context.currentTime, .008) }
  play(offset = this.offset) {
    this.stop()
    this.offset = Math.max(0, Math.min(offset, this.duration))
    this.startedAt = this.context.currentTime + .02
    try {
      for (let i = 0; i < STEM_DEFINITIONS.length; i++) {
        const buffer = this.state.channels[STEM_DEFINITIONS[i].id].source?.buffer
        if (!buffer) throw new Error('Missing stem buffer')
        const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.gains[i])
        this.sources.push(source); source.start(this.startedAt, this.offset)
      }
    } catch (error) { this.stop(); throw error }
  }
  pause() { const time = this.currentTime; this.stop(); this.offset = time; return time }
  seek(time: number) { const playing = this.playing; this.stop(); this.offset = Math.max(0, Math.min(time, this.duration)); if (playing && this.offset < this.duration) this.play(this.offset) }
  private stop() { for (const source of this.sources) { try { source.stop() } catch { /* Already ended. */ } source.disconnect(); source.buffer = null }; this.sources = [] }
  dispose() { this.stop(); this.gains.forEach((g) => g.disconnect()); this.master.disconnect() }
}
