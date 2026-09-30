import { effectiveGain } from '../mixer/mixerRules'
import { STEM_DEFINITIONS } from '../mixer/mixerTypes'
import type { MixerState } from '../mixer/mixerTypes'
import type { LocalTrack } from '../types/audio'
import { MixExportError } from './exportTypes'
import type { MixSnapshot } from './exportTypes'

export function captureMix(track: LocalTrack | null, mix: MixerState): MixSnapshot {
  if (!track || track.id !== mix.trackId || mix.separationStatus !== 'ready') throw new MixExportError('no-stems')
  return {
    trackId: track.id,
    title: track.name.trim() || track.fileName.replace(/\.[^.]+$/, '').trim() || 'Music',
    artist: track.artist, album: track.album, artworkUrl: track.artworkUrl,
    stems: STEM_DEFINITIONS.map(({ id }) => {
      const buffer = mix.channels[id].source?.buffer
      if (!buffer) throw new MixExportError('no-stems')
      // Exactly the same pure gain rule as StemAudioEngine. Copy settings only;
      // keep references to immutable source buffers, never deep-copy six stems.
      return { id, buffer, gain: effectiveGain(mix.channels, id) }
    }),
  }
}

export function mixFilename(title: string): string {
  const clean = Array.from(title.normalize('NFC')).filter(char => char.codePointAt(0)! >= 32 && char !== '\x7f')
    .join('').replace(/[<>:"/\\|?*]/g, '_').trim().replace(/[. ]+$/g, '')
  // Leave room for the suffix even on filesystems with a 255-byte name limit.
  let safe = ''
  const encoder = new TextEncoder()
  for (const char of clean) {
    if (encoder.encode(safe + char).length > 180) break
    safe += char
  }
  return `${safe.trim().replace(/[. ]+$/g, '') || 'Music'} - MuDissector Mix.mp3`
}
