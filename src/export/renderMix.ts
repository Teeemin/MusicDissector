import { STEM_DEFINITIONS } from '../mixer/mixerTypes'
import { EXPORT_SAMPLE_RATE, MixExportError, yieldForExport } from './exportTypes'
import type { ExportStem } from './exportTypes'

const SCAN_FRAMES = 262144

export async function validateStems(stems: readonly ExportStem[], signal: AbortSignal) {
  signal.throwIfAborted()
  if (stems.length !== 6 || STEM_DEFINITIONS.some(({ id }) => !stems.some(stem => stem.id === id))) throw new MixExportError('no-stems')
  const first = stems[0].buffer
  if (!(first instanceof AudioBuffer) || first.length <= 0) throw new MixExportError('invalid-stems')
  for (const { buffer, gain } of stems) {
    if (!(buffer instanceof AudioBuffer) || buffer.sampleRate !== EXPORT_SAMPLE_RATE
      || ![1, 2].includes(buffer.numberOfChannels) || buffer.numberOfChannels !== first.numberOfChannels
      || buffer.length !== first.length || !Number.isFinite(gain) || gain < 0 || gain > 1) throw new MixExportError('invalid-stems')
    // Validate even muted stems; bad input must not silently disappear.
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel)
      for (let start = 0; start < samples.length; start += SCAN_FRAMES) {
        const end = Math.min(start + SCAN_FRAMES, samples.length)
        for (let i = start; i < end; i++) if (!Number.isFinite(samples[i])) throw new MixExportError('invalid-stems')
        await yieldForExport(signal)
      }
    }
  }
  return first.length
}

/** Measure both channels, then attenuate in-place only when necessary. */
export async function protectPeak(buffer: AudioBuffer, signal: AbortSignal) {
  let peak = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel)
    for (let start = 0; start < samples.length; start += SCAN_FRAMES) {
      const end = Math.min(start + SCAN_FRAMES, samples.length)
      for (let i = start; i < end; i++) {
        if (!Number.isFinite(samples[i])) throw new MixExportError('non-finite')
        peak = Math.max(peak, Math.abs(samples[i]))
      }
      await yieldForExport(signal)
    }
  }
  const gain = peak > .99 ? .99 / peak : 1
  if (gain < 1) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel)
      for (let start = 0; start < samples.length; start += SCAN_FRAMES) {
        const end = Math.min(start + SCAN_FRAMES, samples.length)
        for (let i = start; i < end; i++) samples[i] *= gain
        await yieldForExport(signal)
      }
    }
  }
  return { peak, gain }
}

export async function renderMix(stems: readonly ExportStem[], signal: AbortSignal): Promise<AudioBuffer> {
  const length = await validateStems(stems, signal)
  const sources: AudioBufferSourceNode[] = []
  const gains: GainNode[] = []
  let rendered: AudioBuffer
  try {
    const context = new OfflineAudioContext(2, length, EXPORT_SAMPLE_RATE)
    for (const stem of stems) {
      const source = context.createBufferSource(); sources.push(source)
      const gain = context.createGain(); gains.push(gain)
      source.buffer = stem.buffer
      gain.gain.value = stem.gain
      source.connect(gain); gain.connect(context.destination)
      source.start(0)
    }
    rendered = await context.startRendering()
    // OfflineAudioContext has no close/abort API. Let rendering settle, release
    // its nodes, and discard the result if the session changed in the meantime.
    signal.throwIfAborted()
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof MixExportError) throw error
    throw new MixExportError('render')
  } finally {
    sources.forEach(source => { source.disconnect(); source.buffer = null })
    gains.forEach(gain => gain.disconnect())
  }
  await protectPeak(rendered, signal)
  return rendered
}
