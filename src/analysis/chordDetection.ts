import { PITCH_NAMES } from './pitchNames'
import type { ChordSegment } from './chordTypes'

export const CHORD_FRAME_SIZE = 8192
export const CHORD_HOP_SIZE = 4410
export const CHORD_HOP_SECONDS = .1
export const CHORD_QUALITIES = [
  { suffix: '', intervals: [0, 4, 7] }, { suffix: 'm', intervals: [0, 3, 7] },
  { suffix: '7', intervals: [0, 4, 7, 10] }, { suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { suffix: 'm7', intervals: [0, 3, 7, 10] }, { suffix: 'sus2', intervals: [0, 2, 7] },
  { suffix: 'sus4', intervals: [0, 5, 7] }, { suffix: 'dim', intervals: [0, 3, 6] },
  { suffix: 'aug', intervals: [0, 4, 8] },
] as const
export const CHORD_TEMPLATES = PITCH_NAMES.flatMap((root, pitch) => CHORD_QUALITIES.map(({ suffix, intervals }) => ({
  chord: root + suffix, notes: intervals.map((n) => (n + pitch) % 12), penalty: intervals.length === 4 ? .025 : 0,
})))
const N = CHORD_TEMPLATES.length
const STATES = N + 1

/** HPCP in C-first order. Cosine template evidence, not a calibrated probability. */
export function scoreChroma(chroma: readonly number[], rms: number, flatness = 0): Float32Array {
  const scores = new Float32Array(STATES).fill(-4)
  scores[N] = .68
  const mass = chroma.reduce((a, b) => a + b, 0)
  const norm = Math.sqrt(chroma.reduce((a, b) => a + b * b, 0))
  if (rms < 1e-5 || !norm || flatness > .65) { scores[N] = 1; return scores }
  const peak = Math.max(...chroma)
  for (let i = 0; i < N; i++) {
    const t = CHORD_TEMPLATES[i]
    const energy = t.notes.reduce((sum, pitch) => sum + chroma[pitch], 0)
    const cosine = energy / (norm * Math.sqrt(t.notes.length))
    // All constituent notes need evidence; don't label a lone tone as a triad.
    if (cosine >= .78 && energy / mass >= .68 && t.notes.every((p) => chroma[p] >= peak * .12)) scores[i] = cosine - t.penalty
  }
  return scores
}

/** Uniform transition penalty permits O(frames × states), with compact backpointers. */
export function smoothChordFrames(scores: readonly Float32Array[], duration: number): ChordSegment[] {
  if (!scores.length || duration <= 0) return []
  const back = new Uint8Array(scores.length * STATES)
  let previous = new Float32Array(scores[0])
  for (let f = 1; f < scores.length; f++) {
    let best = 0
    for (let s = 1; s < STATES; s++) if (previous[s] > previous[best]) best = s
    const current = new Float32Array(STATES)
    for (let s = 0; s < STATES; s++) {
      const stay = previous[s]
      const change = previous[best] - .35
      const from = stay >= change ? s : best
      current[s] = previous[from] - (from === s ? 0 : .35) + scores[f][s]
      back[f * STATES + s] = from
    }
    previous = current
  }
  let best = 0
  for (let s = 1; s < STATES; s++) if (previous[s] > previous[best]) best = s
  const path = new Uint8Array(scores.length)
  for (let f = scores.length - 1; f >= 0; f--) { path[f] = best; best = back[f * STATES + best] }
  // Debounce runs under 300 ms. Bridge uncertain crossfade frames only;
  // the hard N evidence for actual silence/noise must remain intact.
  for (let start = 0; start < path.length;) {
    let end = start + 1
    while (end < path.length && path[end] === path[start]) end++
    if (end - start < 3 && path[start] !== N && start > 0 && end < path.length && path[start - 1] === path[end]) path.fill(path[end], start, end)
    if (end - start < 3 && path[start] === N && start > 0 && end < path.length && path[start - 1] !== N && path[end] !== N
      && scores.slice(start, end).every((s) => s[N] < 1)) {
      const middle = Math.ceil((start + end) / 2)
      path.fill(path[start - 1], start, middle)
      path.fill(path[end], middle, end)
    }
    start = end
  }
  const chords: ChordSegment[] = []
  for (let start = 0; start < path.length;) {
    let end = start + 1
    while (end < path.length && path[end] === path[start]) end++
    const state = path[start]
    let confidence = 0
    for (let f = start; f < end; f++) confidence += Math.max(0, Math.min(1, scores[f][state]))
    chords.push({ start: start * CHORD_HOP_SECONDS, end: Math.min(duration, end * CHORD_HOP_SECONDS), chord: state === N ? 'N' : CHORD_TEMPLATES[state].chord, confidence: confidence / (end - start) })
    start = end
  }
  return chords
}
