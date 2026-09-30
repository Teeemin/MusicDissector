import { STEM_DEFINITIONS } from '../mixer/mixerTypes'
import type { StemChannels, StemId } from '../mixer/mixerTypes'
import type { MusicAnalysisResult } from '../analysis/analysisTypes'
import { validResult } from '../analysis/analysisTypes'
import type { StemResult } from '../separation/StemSeparationEngine'

export const PROJECT_VERSION = 1
export const PROJECT_DIRECTORY = 'music-dissector-projects'
export const PROJECT_DATABASE = 'music-dissector-projects'
export const PROJECT_LOCK = 'music-dissector-projects-v1'
export const validProjectId = (id: string) => /^p-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
export type MixerSettings = Record<StemId, { volume: number; muted: boolean; solo: boolean }>
export type StemFormat = 'flac-pcm24' | 'wav-float32'
export interface StoredStem { file: string; format: StemFormat; bytes: number; frames: number; channels: number; sampleRate: number }
export interface ProjectRecord {
  id: string
  version: typeof PROJECT_VERSION
  appVersion: string
  title: string
  artist: string | null
  album: string | null
  duration: number
  originalFilename: string
  originalType: string
  originalLastModified: number
  originalBytes: number
  savedAt: number
  updatedAt: number
  bytes: number
  artwork: { bytes: number; type: string } | null
  lyrics: string
  analysis: MusicAnalysisResult | null
  stems: Record<StemId, StoredStem>
  mixer: MixerSettings
}
export interface LoadedProject {
  record: ProjectRecord
  original: File
  artwork: Blob | null
  result: Extract<StemResult, { processed: true }>
}
export interface ProjectEntry { id: string; title: string; artist: string | null; savedAt: number; bytes: number; issue: string | null }
export interface ProjectProgress { completed: number; total: number; label: string }
export function mixerSettings(channels: StemChannels): MixerSettings {
  return Object.fromEntries(STEM_DEFINITIONS.map(({ id }) => [id, { volume: channels[id].volume, muted: channels[id].muted, solo: channels[id].solo }])) as MixerSettings
}
export function validMixer(value: unknown): value is MixerSettings {
  if (!value || typeof value !== 'object') return false
  return STEM_DEFINITIONS.every(({ id }) => {
    const v = (value as MixerSettings)[id]
    return v && Number.isFinite(v.volume) && v.volume >= 0 && v.volume <= 1 && typeof v.muted === 'boolean' && typeof v.solo === 'boolean'
  })
}
/** Validate persisted data before allocating buffers or changing the active session. */
export function validProject(value: unknown): value is ProjectRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as ProjectRecord
  if (typeof r.id !== 'string' || !validProjectId(r.id) || r.version !== PROJECT_VERSION || !validMixer(r.mixer)) return false
  if (typeof r.title !== 'string' || typeof r.appVersion !== 'string' || typeof r.originalFilename !== 'string' || typeof r.originalType !== 'string' || typeof r.lyrics !== 'string') return false
  if (![r.artist, r.album].every(v => v === null || typeof v === 'string') || !Number.isFinite(r.duration) || r.duration <= 0 || r.duration > 360.1) return false
  if (![r.savedAt, r.updatedAt, r.originalLastModified].every(v => Number.isFinite(v) && v >= 0)) return false
  if (!Number.isSafeInteger(r.originalBytes) || r.originalBytes <= 0 || r.originalBytes > 128 * 1024 ** 2 || !Number.isSafeInteger(r.bytes)) return false
  if (r.artwork && (!Number.isSafeInteger(r.artwork.bytes) || r.artwork.bytes <= 0 || r.artwork.bytes > 128 * 1024 ** 2 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'].includes(r.artwork.type))) return false
  if (r.analysis !== null && !validResult(r.analysis)) return false
  if (!r.stems) return false
  let bytes = r.originalBytes + (r.artwork?.bytes ?? 0)
  const first = r.stems.vocals
  for (const { id } of STEM_DEFINITIONS) {
    const stem = r.stems[id]
    if (!stem || !['flac-pcm24', 'wav-float32'].includes(stem.format) || stem.file !== `${id}.${stem.format === 'flac-pcm24' ? 'flac' : 'wav'}`) return false
    if (![1, 2].includes(stem.channels) || stem.sampleRate !== 44100 || !Number.isInteger(stem.frames) || stem.frames <= 0 || stem.frames > 44100 * 360) return false
    if (!Number.isSafeInteger(stem.bytes) || stem.bytes <= 0 || stem.bytes > stem.frames * stem.channels * 4 + 1048576) return false
    if (stem.frames !== first.frames || stem.channels !== first.channels || Math.abs(stem.frames / stem.sampleRate - r.duration) > .1) return false
    bytes += stem.bytes
  }
  return r.bytes === bytes
}
