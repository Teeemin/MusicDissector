export interface LyricLine {
  time: number // Seconds on the existing audio timeline.
  text: string
}

export type LyricsDocument =
  | { kind: 'none' }
  | { kind: 'plain'; text: string }
  | { kind: 'synchronized' | 'lrc'; lines: LyricLine[]; untimedText: string }

export interface EmbeddedLyrics {
  text?: string
  timeStampFormat?: number
  contentType?: number
  syncText?: { text: string; timestamp?: number }[]
}
