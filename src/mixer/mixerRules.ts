import { MIXER_PRESETS, STEM_DEFINITIONS } from './mixerTypes'
import type { MixerPresetId, StemChannels, StemId } from './mixerTypes'

export function createChannels(): StemChannels {
  return Object.fromEntries(STEM_DEFINITIONS.map(({ id, label }) => [id, {
    id, label, volume: 1, muted: false, solo: false, source: null, status: 'unprocessed', error: null,
  }])) as StemChannels
}

/** Mute always wins. Any Solo (including a muted Solo) excludes non-solo stems.
 * This is a future stem gain, NOT a gain applied to the current original audio.
 */
export function effectiveGain(channels: StemChannels, id: StemId): number {
  const anySolo = STEM_DEFINITIONS.some((stem) => channels[stem.id].solo)
  const channel = channels[id]
  return channel.muted || (anySolo && !channel.solo) ? 0 : channel.volume
}

export function withPreset(channels: StemChannels, preset: MixerPresetId): StemChannels {
  const next = { ...channels }
  for (const { id } of STEM_DEFINITIONS) {
    next[id] = { ...channels[id], volume: 1, muted: false, solo: false }
  }
  if (preset === 'vocal-only') next.vocals.solo = true
  if (preset === 'no-vocal') next.vocals.muted = true
  if (preset === 'no-guitar') next.guitar.muted = true
  if (preset === 'no-piano') next.piano.muted = true
  return next
}

export function activePreset(channels: StemChannels): MixerPresetId | null {
  for (const { id } of MIXER_PRESETS) {
    const expected = withPreset(channels, id)
    if (STEM_DEFINITIONS.every(({ id: stem }) => channels[stem].volume === expected[stem].volume
      && channels[stem].muted === expected[stem].muted && channels[stem].solo === expected[stem].solo)) return id
  }
  return null
}
