import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { parseBuffer } from 'music-metadata'
import { supported, cacheModel, fakeInference } from './separationHarness'
import { taggedWav } from './audio'

export const exportTitle = '내보내기:테스트/곡'
export const frequencies = [110, 220, 330, 440, 550, 660] // Bass, Drums, Others, Vocals, Guitar, Piano
export async function prepareExport(page: Page) {
  await supported(page); await fakeInference(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '현재 믹스 내보내기', exact: true })).toBeDisabled()
  await cacheModel(page)
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ title: exportTitle, artist: '내보내기 가수', album: '내보내기 앨범', artwork: true, lyrics: '가사는 내보내지 않음' }, 'original.wav', 12))
  await expect(page.getByRole('heading', { name: exportTitle, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '분리 시작', exact: true }).click()
  await expect(page.locator('.separation-status')).toContainText('분리 완료', { timeout: 20_000 })
  await expect(page.getByRole('button', { name: '현재 믹스 내보내기', exact: true })).toBeEnabled()
}

export async function downloadAndInspect(page: Page, info: TestInfo, label = 'mix') {
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '현재 믹스 내보내기', exact: true }).click()
  const download = await downloading
  expect(await download.failure()).toBeNull()
  expect(download.suggestedFilename()).toBe('내보내기_테스트_곡 - MuDissector Mix.mp3')
  const path = info.outputPath(`${label}.mp3`)
  await download.saveAs(path)
  const bytes = await readFile(path)
  expect(bytes.byteLength).toBeGreaterThan(400_000)
  const metadata = await parseBuffer(bytes, { mimeType: 'audio/mpeg' }, { duration: true })
  expect(metadata.format.codec).toContain('MPEG')
  expect(metadata.format.sampleRate).toBe(44100)
  expect(metadata.format.numberOfChannels).toBe(2)
  expect(metadata.format.bitrate).toBe(320000)
  expect(metadata.common.title).toBe(exportTitle)
  expect(metadata.common.artist).toBe('내보내기 가수')
  expect(metadata.common.album).toBe('내보내기 앨범')
  expect(metadata.common.picture?.[0].format).toBe('image/png')
  expect(metadata.common.picture?.[0].data.byteLength).toBeGreaterThan(0)
  expect(metadata.common.lyrics ?? []).toEqual([])
  const route = `**/__export-fixture-${label}.mp3`
  await page.route(route, request => request.fulfill({ body: bytes, contentType: 'audio/mpeg' }))
  const measurement = await page.evaluate(async ({ url, frequencies }) => {
    const file = await (await fetch(url)).arrayBuffer()
    const context = new OfflineAudioContext(2, 1, 44100)
    const audio = await context.decodeAudioData(file)
    const amplitudes = Array.from({ length: audio.numberOfChannels }, (_, channel) => {
      const data = audio.getChannelData(channel)
      return frequencies.map(hz => {
        let sin = 0; let cos = 0
        const start = 2 * audio.sampleRate; const length = audio.sampleRate
        for (let i = 0; i < length; i++) {
          const angle = 2 * Math.PI * hz * i / audio.sampleRate
          sin += data[start + i] * Math.sin(angle); cos += data[start + i] * Math.cos(angle)
        }
        return 2 * Math.hypot(sin, cos) / length
      })
    })
    return { duration: audio.duration, channels: audio.numberOfChannels, sampleRate: audio.sampleRate, amplitudes }
  }, { url: `/__export-fixture-${label}.mp3`, frequencies })
  await page.unroute(route)
  expect(measurement.sampleRate).toBe(44100)
  expect(measurement.channels).toBe(2)
  expect(measurement.duration).toBeGreaterThanOrEqual(12)
  expect(measurement.duration).toBeLessThan(12.1)
  await info.attach(`${label}-measurement`, { body: JSON.stringify({ ...measurement, bytes: bytes.byteLength, bitrate: metadata.format.bitrate }), contentType: 'application/json' })
  return { ...measurement, bytes, path }
}

export function expectGains(amplitudes: number[][], gains: number[]) {
  for (let channel = 0; channel < 2; channel++) {
    for (let i = 0; i < gains.length; i++) {
      const expected = .05 * gains[i] * (channel ? .8 : 1)
      expect(amplitudes[channel][i]).toBeCloseTo(expected, 3)
    }
  }
}
