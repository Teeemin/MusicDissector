import { expect, test } from '@playwright/test'
import { findActiveLine, parseEmbeddedLyrics, parseLrc } from '../src/lyrics/LyricsParser'

test('LRC handles fractions, repeated times, sorting, offset and untimed text', () => {
  expect(parseLrc('[ar:Artist]\n[offset:500]\n[00:10.125]마지막\n[00:02.5][00:04.50]반복\n설명')).toEqual({
    kind: 'lrc', lines: [{ time: 2, text: '반복' }, { time: 4, text: '반복' }, { time: 9.625, text: '마지막' }], untimedText: '설명',
  })
})

test('duplicate timestamps keep both lines and empty timestamps keep instrumental gaps', () => {
  expect(parseLrc('[00:01]원문\n[00:01.00]번역\n[00:03]\n[00:04]끝')).toEqual({
    kind: 'lrc', lines: [{ time: 1, text: '원문\n번역' }, { time: 3, text: '' }, { time: 4, text: '끝' }], untimedText: '',
  })
})

test('plain, empty and invalid timestamps never gain invented synchronization', () => {
  expect(parseEmbeddedLyrics([])).toEqual({ kind: 'none' })
  expect(parseLrc('\uFEFF \0\r\n')).toEqual({ kind: 'none' })
  expect(parseLrc('한 줄\r\n\r\n[00:99]잘못된 시간')).toEqual({ kind: 'plain', text: '한 줄\n\n[00:99]잘못된 시간' })
})

test('SYLT milliseconds take precedence over LRC and plain text', () => {
  expect(parseEmbeddedLyrics([
    { text: '일반' }, { text: '[00:01]LRC' },
    { timeStampFormat: 2, syncText: [{ timestamp: 2500, text: '동기화' }] },
  ])).toEqual({ kind: 'synchronized', lines: [{ time: 2.5, text: '동기화' }], untimedText: '' })
})

test('SYLT frame timestamps and missing timestamps remain plain text', () => {
  expect(parseEmbeddedLyrics([{ timeStampFormat: 1, syncText: [{ timestamp: 120, text: '프레임 기반' }] }])).toEqual({ kind: 'plain', text: '프레임 기반' })
  expect(parseEmbeddedLyrics([{ timeStampFormat: 2, syncText: [{ text: '시간 없음' }, { timestamp: NaN, text: '잘못된 시간' }] }])).toEqual({ kind: 'plain', text: '시간 없음\n잘못된 시간' })
})

test('SYLT fragments join by explicit line boundaries without guessed timestamps', () => {
  expect(parseEmbeddedLyrics([{ timeStampFormat: 2, syncText: [
    { timestamp: 1000, text: '\n첫 ' }, { timestamp: 1200, text: '번째 줄' },
    { timestamp: 3000, text: '\n다음 줄' },
  ] }])).toEqual({ kind: 'synchronized', lines: [{ time: 1, text: '첫 번째 줄' }, { time: 3, text: '다음 줄' }], untimedText: '' })
})

test('active line respects boundaries, reverse seek and prelude', () => {
  const lines = [{ time: 2, text: '첫 줄' }, { time: 4, text: '둘째' }, { time: 8, text: '끝' }]
  expect(findActiveLine(lines, 0)).toBe(-1)
  expect(findActiveLine(lines, 4)).toBe(1)
  expect(findActiveLine(lines, 30)).toBe(2)
  expect(findActiveLine(lines, 3)).toBe(0)
  expect(findActiveLine([], 3)).toBe(-1)
})

test('LRC wins over unsupported SYLT timing and handles negative offsets', () => {
  expect(parseEmbeddedLyrics([{ timeStampFormat: 1, syncText: [{ timestamp: 1, text: 'frame' }] }, { text: '[offset:-1000]\n[00:01]실제 시간' }])).toEqual({ kind: 'lrc', lines: [{ time: 2, text: '실제 시간' }], untimedText: '' })
})
