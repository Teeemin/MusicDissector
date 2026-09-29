import { expect, test } from '@playwright/test'
import { MixerStore } from '../src/mixer/mixerStore'
import { activePreset, createChannels, effectiveGain, withPreset } from '../src/mixer/mixerRules'
import { STEM_DEFINITIONS } from '../src/mixer/mixerTypes'
import { MockStemSeparationEngine } from '../src/separation/MockStemSeparationEngine'
import type { StemResult, StemSeparationEngine } from '../src/separation/StemSeparationEngine'
import { createStemMixPlan } from '../src/audio/StemMixPlan'

const file = () => new File(['test'], 'track.wav')
const mockResult = (): StemResult => ({ kind: 'mock', processed: false, stems: { vocals: null, guitar: null, piano: null, drums: null, bass: null, others: null } })

test('mock exposes exactly six absent sources and respects cancellation', async () => {
  const engine = new MockStemSeparationEngine()
  const result = await engine.separate(file())
  expect(result).toEqual(mockResult())
  const controller = new AbortController()
  controller.abort()
  await expect(engine.separate(file(), { signal: controller.signal })).rejects.toThrow('Aborted')
})

test('volume clamp, mute, solo and multi-solo follow explicit mute-first rules', () => {
  const store = new MixerStore()
  store.selectFile(file(), 1)
  store.setVolume('vocals', .42)
  store.toggleSolo('vocals')
  store.toggleSolo('guitar')
  expect(effectiveGain(store.getSnapshot().channels, 'vocals')).toBe(.42)
  expect(effectiveGain(store.getSnapshot().channels, 'guitar')).toBe(1)
  expect(effectiveGain(store.getSnapshot().channels, 'piano')).toBe(0)
  store.toggleMute('vocals')
  expect(effectiveGain(store.getSnapshot().channels, 'vocals')).toBe(0)
  store.toggleSolo('guitar')
  expect(STEM_DEFINITIONS.every(({ id }) => effectiveGain(store.getSnapshot().channels, id) === 0)).toBe(true)
  store.toggleSolo('vocals')
  expect(effectiveGain(store.getSnapshot().channels, 'guitar')).toBe(1)
  store.setVolume('bass', -2)
  expect(store.getSnapshot().channels.bass.volume).toBe(0)
  store.setVolume('bass', 2)
  expect(store.getSnapshot().channels.bass.volume).toBe(1)
  store.setVolume('bass', NaN)
  expect(store.getSnapshot().channels.bass.volume).toBe(1)
  store.clear()
})

for (const preset of ['original', 'vocal-only', 'no-vocal', 'no-guitar', 'no-piano'] as const) {
  test(`${preset} clears previous settings and matches intended channel gains`, () => {
    const previous = createChannels()
    previous.bass.volume = .12
    previous.drums.muted = true
    previous.piano.solo = true
    const channels = withPreset(previous, preset)
    expect(activePreset(channels)).toBe(preset)
    for (const { id } of STEM_DEFINITIONS) {
      const excluded = (preset === 'vocal-only' && id !== 'vocals')
        || (preset === 'no-vocal' && id === 'vocals')
        || (preset === 'no-guitar' && id === 'guitar')
        || (preset === 'no-piano' && id === 'piano')
      expect(effectiveGain(channels, id)).toBe(excluded ? 0 : 1)
      expect(channels[id].volume).toBe(1)
    }
    expect(previous.bass.volume).toBe(.12)
    channels.others.volume = .5
    expect(activePreset(channels)).toBeNull()
  })
}

test('new track and disposal reset all controls and sources; idle edits are ignored', async () => {
  const store = new MixerStore()
  store.setVolume('vocals', .5)
  expect(store.getSnapshot().channels.vocals.volume).toBe(1)
  store.selectFile(file(), 1)
  await Promise.resolve()
  store.applyPreset('vocal-only')
  store.setVolume('guitar', .2)
  store.selectFile(file(), 2)
  expect(store.getSnapshot().channels).toEqual(createChannels())
  await Promise.resolve()
  expect(store.getSnapshot().separationStatus).toBe('unprocessed')
  expect(createStemMixPlan(store.getSnapshot()).channels.every((channel) => channel.source === null)).toBe(true)
  store.clear()
  expect(store.getSnapshot()).toEqual({ trackId: null, channels: createChannels(), separationStatus: 'idle', error: null })
})

test('late separation results/errors cannot replace the selected track or its edits', async () => {
  const tasks: { resolve: (result: StemResult) => void; reject: (error: Error) => void; signal?: AbortSignal }[] = []
  const engine: StemSeparationEngine = { separate: (_file, options) => new Promise((resolve, reject) => tasks.push({ resolve, reject, signal: options?.signal })) }
  const store = new MixerStore(engine)
  store.selectFile(file(), 1)
  store.selectFile(file(), 2)
  expect(tasks[0].signal!.aborted).toBe(true)
  store.setVolume('piano', .37)
  tasks[1].resolve(mockResult())
  await Promise.resolve()
  tasks[0].reject(new Error('Old failure'))
  await Promise.resolve()
  expect(store.getSnapshot().trackId).toBe(2)
  expect(store.getSnapshot().channels.piano.volume).toBe(.37)
  expect(store.getSnapshot().error).toBeNull()
  store.selectFile(file(), 3)
  store.clear()
  tasks[2].resolve(mockResult())
  await Promise.resolve()
  expect(store.getSnapshot().trackId).toBeNull()
})

test('separation failure leaves controls available and next selection clears the error', async () => {
  let fail = true
  const engine: StemSeparationEngine = { separate: () => fail ? Promise.reject(new Error('failure')) : Promise.resolve(mockResult()) }
  const store = new MixerStore(engine)
  store.selectFile(file(), 1)
  await Promise.resolve()
  expect(store.getSnapshot().separationStatus).toBe('error')
  store.toggleMute('bass')
  expect(store.getSnapshot().channels.bass.muted).toBe(true)
  fail = false
  store.selectFile(file(), 2)
  await Promise.resolve()
  expect(store.getSnapshot().error).toBeNull()
  expect(store.getSnapshot().channels.bass.muted).toBe(false)
  store.clear()
})
