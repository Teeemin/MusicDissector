import { expect, test } from '@playwright/test'
import { AnalysisStore } from '../src/analysis/analysisStore'
import { ANALYSIS_VERSION, validResult } from '../src/analysis/analysisTypes'
import type { AnalysisEngine, AnalysisOptions, MusicAnalysisResult } from '../src/analysis/analysisTypes'
import type { AnalysisCache } from '../src/analysis/analysisCache'
import { fingerprint } from '../src/analysis/analysisCache'
import { getCurrentBeatIndex } from '../src/analysis/beatTimeline'

const result = (): MusicAnalysisResult => ({ bpm: 123.94, beats: [.47, .95, 1.44], key: 'A', scale: 'minor', confidence: { bpm: 3, key: .8 }, engineVersion: ANALYSIS_VERSION })
const file = (name = 'song.wav') => new File(['audio'], name, { lastModified: 123 })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
function memoryCache() {
  const map = new Map<string, MusicAnalysisResult>()
  const cache: AnalysisCache = { get: async (key) => map.get(key) ?? null, put: async (key, value) => { map.set(key, value) } }
  return { map, cache }
}

test('result contract rejects invalid timestamps, stale engine and invalid values', () => {
  expect(validResult(result())).toBe(true)
  for (const patch of [{ bpm: NaN }, { beats: [1, .5] }, { beats: [NaN] }, { engineVersion: 'old' }, { key: 'H' }, { scale: null }, { confidence: { bpm: Infinity } }]) {
    expect(validResult({ ...result(), ...patch })).toBe(false)
  }
  expect(validResult({ ...result(), bpm: null, beats: [], key: null, scale: null })).toBe(true)
})

test('beat lookup handles exact beats, seeks, bounds and empty results', () => {
  const beats = [.47, .95, 1.44]
  expect([-1, 0, .47, .94, .95, 99].map((t) => getCurrentBeatIndex(t, beats))).toEqual([-1, -1, 0, 0, 1, 2])
  expect(getCurrentBeatIndex(2, [])).toBe(-1)
  expect(getCurrentBeatIndex(NaN, beats)).toBe(-1)
})

test('fingerprint distinguishes same-name files, identity and sampled content', async () => {
  const a = await fingerprint(file())
  expect(await fingerprint(file())).toBe(a)
  expect(await fingerprint(new File(['other'], 'song.wav', { lastModified: 123 }))).not.toBe(a)
  expect(await fingerprint(new File(['audio'], 'song.wav', { lastModified: 124 }))).not.toBe(a)
})

test('cache preserves beat timestamps and reanalysis bypasses and replaces it', async () => {
  let calls = 0
  const { cache, map } = memoryCache()
  const engine: AnalysisEngine = { analyze: async () => ({ ...result(), bpm: 120 + ++calls }) }
  const store = new AnalysisStore(engine, cache, async () => 'same')
  store.selectFile(file(), 1)
  await settle()
  expect(store.getSnapshot().result?.beats).toEqual(result().beats)
  expect(map.get('same')?.engineVersion).toBe(ANALYSIS_VERSION)
  store.selectFile(file(), 2)
  expect(store.getSnapshot().result).toBeNull()
  await settle()
  expect(store.getSnapshot().cached).toBe(true)
  expect(calls).toBe(1)
  store.reanalyze()
  await settle()
  expect(calls).toBe(2)
  expect(map.get('same')?.bpm).toBe(122)
  store.clear()
})

test('late analysis completion, errors and progress cannot overwrite a new track or disposal', async () => {
  const jobs: { resolve: (r: MusicAnalysisResult) => void; reject: (e: Error) => void; options: AnalysisOptions }[] = []
  const engine: AnalysisEngine = { analyze: (_f, options) => new Promise((resolve, reject) => jobs.push({ resolve, reject, options })) }
  const { cache } = memoryCache()
  const store = new AnalysisStore(engine, cache, async (f) => f.name)
  store.selectFile(file('first.wav'), 1); await settle()
  store.selectFile(file('second.wav'), 2); await settle()
  expect(jobs[0].options.signal.aborted).toBe(true)
  jobs[1].resolve(result()); await settle()
  jobs[0].options.onStage('key'); jobs[0].resolve({ ...result(), bpm: 90 }); await settle()
  expect(store.getSnapshot().result?.bpm).toBe(123.94)
  store.selectFile(file('third.wav'), 3); await settle()
  expect(store.getSnapshot().result).toBeNull()
  store.clear(); jobs[2].reject(new Error('late failure')); await settle()
  expect(store.getSnapshot().status).toBe('idle')
})

test('late cache cannot overwrite new track; cache failures still analyze', async () => {
  let resolveCache!: (r: MusicAnalysisResult) => void
  let reads = 0
  const cache: AnalysisCache = { get: () => ++reads === 1 ? new Promise((r) => { resolveCache = r }) : Promise.reject(new Error('denied')), put: async () => { throw new Error('quota') } }
  const store = new AnalysisStore({ analyze: async () => ({ ...result(), bpm: 90 }) }, cache, async (f) => f.name)
  store.selectFile(file('a.wav'), 1); await settle()
  store.selectFile(file('b.wav'), 2); await settle()
  resolveCache(result()); await settle()
  expect(store.getSnapshot().trackId).toBe(2)
  expect(store.getSnapshot().result?.bpm).toBe(90)
  expect(store.getSnapshot().status).toBe('complete')
  store.clear()
})

test('analysis errors reset results and can recover on retry', async () => {
  let fail = true
  const store = new AnalysisStore({ analyze: async () => { if (fail) throw new Error('decode'); return result() } }, memoryCache().cache, async () => 'key')
  store.selectFile(file(), 1); await settle()
  expect(store.getSnapshot().status).toBe('error')
  expect(store.getSnapshot().result).toBeNull()
  fail = false; store.reanalyze(); await settle()
  expect(store.getSnapshot().status).toBe('complete')
  store.clear()
})
