import type { ChordSegment } from './chordTypes'
import type { LyricLine } from '../lyrics/types'

function upperBound(time: number, chords: readonly ChordSegment[]) {
  let lo = 0; let hi = chords.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (chords[mid].start <= time) lo = mid + 1; else hi = mid }
  return lo
}
/** Half-open [start, end): at the exact boundary the next segment is current. */
export function getChordIndexAtTime(time: number, chords: readonly ChordSegment[]): number {
  if (!Number.isFinite(time)) return -1
  const index = upperBound(time, chords) - 1
  return index >= 0 && time < chords[index].end ? index : -1
}
export const getChordAtTime = (time: number, chords: readonly ChordSegment[]) => chords[getChordIndexAtTime(time, chords)] ?? null
export function getPreviousChord(time: number, chords: readonly ChordSegment[]) {
  if (!Number.isFinite(time)) return null
  const current = getChordIndexAtTime(time, chords)
  return chords[current >= 0 ? current - 1 : upperBound(time, chords) - 1] ?? null
}
export function getNextChord(time: number, chords: readonly ChordSegment[]) {
  return Number.isFinite(time) ? chords[upperBound(time, chords)] ?? null : null
}
export function getChordsInRange(start: number, end: number, chords: readonly ChordSegment[]): ChordSegment[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []
  const result: ChordSegment[] = []
  for (let i = Math.max(0, upperBound(start, chords) - 1); i < chords.length && chords[i].start < end; i++) {
    if (chords[i].end > start) result.push(chords[i])
  }
  return result
}
/** Timed lyrics only. Equal-start lines share the same interval; no word alignment. */
export function matchLyricChords(lines: readonly LyricLine[], duration: number, chords: readonly ChordSegment[]) {
  let next = 0
  return lines.map((line, index) => {
    next = Math.max(next, index + 1)
    while (next < lines.length && lines[next].time <= line.time) next++
    return getChordsInRange(line.time, Math.min(lines[next]?.time ?? duration, duration), chords).filter((s) => s.chord !== 'N')
  })
}
