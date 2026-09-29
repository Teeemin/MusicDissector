import { expect, test } from '@playwright/test'
import { normalizeChord, normalizePitchName } from '../src/analysis/pitchNames'
import { getChordAtTime, getChordIndexAtTime, getPreviousChord, getNextChord, getChordsInRange, matchLyricChords } from '../src/analysis/chordUtils'
import { CHORD_ENGINE_VERSION, validChordResult } from '../src/analysis/chordTypes'
import type { ChordAnalysisResult, ChordEngine, ChordOptions } from '../src/analysis/chordTypes'
import { scoreChroma, smoothChordFrames } from '../src/analysis/chordDetection'
import { ChordStore } from '../src/analysis/chordStore'
import type { ResultCache } from '../src/analysis/analysisCache'

const result = (): ChordAnalysisResult => ({ engineVersion: CHORD_ENGINE_VERSION, analyzedAt: 123, chords: [
  { start: 0, end: 2, chord: 'C', confidence: .9 }, { start: 2, end: 4, chord: 'Am' },
  { start: 4, end: 6, chord: 'F' }, { start: 6, end: 8, chord: 'N' },
] })
const file = (name = 'audio.wav') => new File(['audio'], name)
const settle = () => new Promise((r) => setTimeout(r, 0))
function cache() {
  const map = new Map<string, ChordAnalysisResult>()
  const storage: ResultCache<ChordAnalysisResult> = { get: async (key) => map.get(key) ?? null, put: async (key, r) => { map.set(key, r) } }
  return { map, storage }
}
test('shared key/chord normalization uses sharps and preserves all supported qualities', () => {
  expect(['Db', 'Eb', 'Gb', 'Ab', 'Bb', 'Cb', 'B#', 'F♯'].map(normalizePitchName)).toEqual(['C#', 'D#', 'F#', 'G#', 'A#', 'B', 'C', 'F#'])
  expect(['Dbm', 'E♭maj7', 'Gbm7', 'Ab7', 'Bbsus4', 'Cmin7', 'Cmin', 'Cmaj', 'Cdim', 'Caug', 'Csus2', 'No Chord'].map(normalizeChord))
    .toEqual(['C#m', 'D#maj7', 'F#m7', 'G#7', 'A#sus4', 'Cm7', 'Cm', 'C', 'Cdim', 'Caug', 'Csus2', 'N'])
  expect(normalizeChord('C13')).toBeNull(); expect(normalizePitchName('H')).toBeNull()
})
test('segment contract validates intervals, confidence, spelling and algorithm version', () => {
  expect(validChordResult(result())).toBe(true)
  for (const chords of [[{ start: 1, end: 1, chord: 'C' }], [{ start: NaN, end: 3, chord: 'C' }], [{ start: 0, end: 2, chord: 'Db' }], [{ start: 0, end: 2, chord: 'C', confidence: 2 }], [result().chords[1], result().chords[0]]]) {
    expect(validChordResult({ ...result(), chords })).toBe(false)
  }
  expect(validChordResult({ ...result(), engineVersion: 'old' })).toBe(false)
})
test('binary lookup handles exact ends, backwards seeks, gaps, no-chord and empty arrays', () => {
  const chords = result().chords
  expect([-1, 0, 1.999, 2, 4, 6, 8, NaN].map((t) => getChordIndexAtTime(t, chords))).toEqual([-1, 0, 0, 1, 2, 3, -1, -1])
  expect(getChordAtTime(6, chords)?.chord).toBe('N')
  expect(getPreviousChord(2, chords)?.chord).toBe('C')
  expect(getNextChord(2, chords)?.chord).toBe('F')
  expect(getPreviousChord(0, chords)).toBeNull()
  expect(getNextChord(-1, chords)?.chord).toBe('C')
  expect(getNextChord(8, chords)).toBeNull()
  expect(getPreviousChord(8, chords)?.chord).toBe('N')
  const gaps = [chords[0], chords[2]]
  expect(getChordAtTime(3, gaps)).toBeNull()
  expect(getPreviousChord(3, gaps)?.chord).toBe('C')
  expect(getNextChord(3, gaps)?.chord).toBe('F')
  expect(getChordAtTime(0, [])).toBeNull()
})
test('lyric overlap uses half-open ranges, multiple chords, final duration and duplicate starts', () => {
  expect(getChordsInRange(1, 4, result().chords).map((s) => s.chord)).toEqual(['C', 'Am'])
  expect(getChordsInRange(2, 2, result().chords)).toEqual([])
  const lines = [{ time: 1, text: 'one' }, { time: 3, text: 'two' }, { time: 3, text: 'translation' }, { time: 6, text: 'silence' }]
  expect(matchLyricChords(lines, 8, result().chords).map((a) => a.map((s) => s.chord))).toEqual([['C', 'Am'], ['Am', 'F'], ['Am', 'F'], []])
})
const qualities: [string, number[]][] = [['C', [0, 4, 7]], ['Cm', [0, 3, 7]], ['C7', [0, 4, 7, 10]], ['Cmaj7', [0, 4, 7, 11]], ['Cm7', [0, 3, 7, 10]], ['Csus2', [0, 2, 7]], ['Csus4', [0, 5, 7]], ['Cdim', [0, 3, 6]], ['Caug', [0, 4, 8]]]
for (const [chord, pitches] of qualities) {
  test(`template + smoothing recognizes ${chord} from independent chroma evidence`, () => {
    const chroma = Array.from({ length: 12 }, (_, p) => pitches.includes(p) ? 1 : 0)
    const segments = smoothChordFrames(Array.from({ length: 20 }, () => scoreChroma(chroma, .1)), 2)
    expect(segments).toEqual([expect.objectContaining({ start: 0, end: 2, chord })])
  })
}
test('silence, broadband noise and lone tones remain N; brief glitches are smoothed', () => {
  for (const [chroma, rms, flatness] of [[new Array(12).fill(0), 0, 0], [new Array(12).fill(1), .1, .8], [[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], .1, 0]] as [number[], number, number][]) {
    expect(smoothChordFrames([scoreChroma(chroma, rms, flatness)], .1)[0].chord).toBe('N')
  }
  const c = scoreChroma([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], .1)
  const am = scoreChroma([1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], .1)
  const scores = Array.from({ length: 30 }, (_, i) => i === 10 ? am : c)
  expect(smoothChordFrames(scores, 3).map((s) => s.chord)).toEqual(['C'])
  const silence = scoreChroma(new Array(12).fill(0), 0)
  const withSilence = scores.map((s, i) => i === 15 ? silence : s)
  expect(smoothChordFrames(withSilence, 3).some((s) => s.chord === 'N' && s.start === 1.5)).toBe(true)
})
test('cache persists chords/version/time and retry bypasses cache without Phase 4 conflicts', async () => {
  const { map, storage } = cache(); let calls = 0
  const store = new ChordStore({ analyze: async () => ({ ...result(), analyzedAt: ++calls }) }, storage, async () => 'key', async () => {})
  store.selectFile(file(), 1); await settle()
  expect(map.get('key')?.chords).toEqual(result().chords)
  store.selectFile(file(), 2)
  expect(store.getSnapshot().result).toBeNull()
  await settle(); expect(store.getSnapshot().cached).toBe(true); expect(calls).toBe(1)
  store.reanalyze(); await settle()
  expect(calls).toBe(2); expect(map.get('key')?.analyzedAt).toBe(2)
  store.clear(); expect(store.getSnapshot().status).toBe('idle')
})
test('late success, stage/error and disposal never replace the new selection', async () => {
  const jobs: { resolve: (r: ChordAnalysisResult) => void; reject: (e: Error) => void; options: ChordOptions }[] = []
  const engine: ChordEngine = { analyze: (_f, options) => new Promise((resolve, reject) => jobs.push({ resolve, reject, options })) }
  const store = new ChordStore(engine, cache().storage, async (f) => f.name, async () => {})
  store.selectFile(file('a.wav'), 1); await settle()
  store.selectFile(file('b.wav'), 2); await settle()
  expect(jobs[0].options.signal.aborted).toBe(true)
  jobs[1].resolve(result()); await settle()
  jobs[0].options.onStage('extracting'); jobs[0].resolve({ ...result(), chords: [] }); await settle()
  expect(store.getSnapshot().result?.chords).toEqual(result().chords)
  store.selectFile(file('c.wav'), 3); await settle()
  expect(store.getSnapshot().result).toBeNull()
  store.clear(); jobs[2].reject(new Error('late')); await settle()
  expect(store.getSnapshot().status).toBe('idle')
})
test('late cache and cache errors cannot contaminate tracks; analysis errors can retry', async () => {
  let resolveCache!: (r: ChordAnalysisResult) => void; let reads = 0; let fail = true
  const storage: ResultCache<ChordAnalysisResult> = { get: () => ++reads === 1 ? new Promise((r) => { resolveCache = r }) : Promise.reject(new Error('blocked')), put: async () => { throw new Error('quota') } }
  const store = new ChordStore({ analyze: async () => { if (fail) throw new Error('analysis'); return result() } }, storage, async (f) => f.name, async () => {})
  store.selectFile(file('a.wav'), 1); await settle()
  store.selectFile(file('b.wav'), 2); await settle()
  resolveCache(result()); await settle()
  expect(store.getSnapshot().status).toBe('error'); expect(store.getSnapshot().result).toBeNull()
  fail = false; store.reanalyze(); await settle()
  expect(store.getSnapshot().status).toBe('complete'); expect(store.getSnapshot().trackId).toBe(2)
  store.clear()
})
