import type { EmbeddedLyrics, LyricLine, LyricsDocument } from './types'

function clean(text: string) {
  return text.replaceAll('\0', '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
}

function normalize(lines: LyricLine[]): LyricLine[] {
  const merged = new Map<number, string[]>()
  for (const line of lines) {
    if (!Number.isFinite(line.time) || line.time < 0) continue
    const text = line.text.trim()
    const group = merged.get(line.time) ?? []
    if (!group.includes(text)) group.push(text)
    merged.set(line.time, group)
  }
  return [...merged].sort(([a], [b]) => a - b).map(([time, texts]) => ({ time, text: texts.filter(Boolean).join('\n') }))
}

export function parseLrc(input: string): LyricsDocument {
  const text = clean(input)
  // Positive LRC offset advances lyrics; no beat-based or guessed timestamps.
  const offsets = [...text.matchAll(/^\s*\[offset:([+-]?\d+)\]\s*$/gim)]
  const offset = offsets.length ? Number(offsets.at(-1)![1]) / 1000 : 0
  const lines: LyricLine[] = []
  const untimed: string[] = []
  for (const rawLine of text.split('\n')) {
    const matches = [...rawLine.matchAll(/\[(\d+):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)]
    if (matches.length) {
      const lineText = rawLine.replace(/\[\d+:[0-5]\d(?:[.:]\d{1,3})?\]/g, '').replace(/<\d+:[0-5]\d(?:[.:]\d{1,3})?>/g, '').trim()
      for (const match of matches) {
        const seconds = Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] ?? '0'}`)
        lines.push({ time: Math.max(0, seconds - offset), text: lineText })
      }
    } else if (!/^\s*\[(?:ar|ti|al|by|au|length|offset|re|ve):.*\]\s*$/i.test(rawLine)) {
      untimed.push(rawLine)
    }
  }
  if (lines.length) return { kind: 'lrc', lines: normalize(lines), untimedText: untimed.join('\n').trim() }
  return text.trim() ? { kind: 'plain', text: text.trim() } : { kind: 'none' }
}

function parseSynchronized(tag: EmbeddedLyrics): LyricsDocument {
  const entries = tag.syncText ?? []
  // SYLT can store MPEG frame numbers. They are not milliseconds: preserve text
  // without enabling seek until an exact frame-to-time mapping is available.
  if (tag.timeStampFormat !== 2) {
    const text = entries.map((entry) => clean(entry.text)).join('\n').trim()
    return text ? { kind: 'plain', text } : { kind: 'none' }
  }
  const lines: LyricLine[] = []
  const untimed: string[] = []
  const usesLineBreaks = entries.some((entry) => /[\r\n]/.test(entry.text))
  let pending: LyricLine | null = null
  for (const entry of entries) {
    const text = clean(entry.text)
    if (entry.timestamp === undefined || !Number.isFinite(entry.timestamp) || entry.timestamp < 0) {
      if (pending) { lines.push(pending); pending = null }
      if (text.trim()) untimed.push(text)
      continue
    }
    const time = entry.timestamp / 1000
    if (!usesLineBreaks) { lines.push({ time, text }); continue }
    // SYLT syllables belonging to one line retain that line's first timestamp.
    const parts = text.split('\n')
    for (let i = 0; i < parts.length; i++) {
      if (i > 0 && pending) { lines.push(pending); pending = null }
      if (parts[i]) {
        if (pending) pending.text += parts[i]
        else pending = { time, text: parts[i] }
      }
    }
  }
  if (pending) lines.push(pending)
  const normalized = normalize(lines)
  return normalized.length
    ? { kind: 'synchronized', lines: normalized, untimedText: untimed.join('\n').trim() }
    : untimed.length ? { kind: 'plain', text: untimed.join('\n').trim() } : { kind: 'none' }
}

/** Prefer usable SYLT, then LRC, then unsynchronized text. */
export function parseEmbeddedLyrics(tags: EmbeddedLyrics[]): LyricsDocument {
  const candidates: LyricsDocument[] = []
  for (const tag of tags) {
    if (tag.contentType !== undefined && ![1, 2].includes(tag.contentType)) continue
    if (tag.syncText?.length) candidates.push(parseSynchronized(tag))
    if (typeof tag.text === 'string') candidates.push(parseLrc(tag.text))
  }
  for (const kind of ['synchronized', 'lrc', 'plain'] as const) {
    const candidate = candidates.find((item) => item.kind === kind)
    if (candidate) return candidate
  }
  return { kind: 'none' }
}

/** Read embedded content without attaching any playback behavior to timestamps. */
export function lyricsText(lyrics: LyricsDocument): string {
  if (lyrics.kind === 'none') return ''
  if (lyrics.kind === 'plain') return lyrics.text
  return [lyrics.lines.map(line => line.text).join('\n'), lyrics.untimedText].filter(Boolean).join('\n\n')
}
