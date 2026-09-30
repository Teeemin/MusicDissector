import type { StemId } from '../mixer/mixerTypes'

export const EXPORT_SAMPLE_RATE = 44100
export type ExportStage = 'idle' | 'mixing' | 'encoding' | 'download'
export type ExportErrorCode = 'no-stems' | 'invalid-stems' | 'render' | 'non-finite' | 'encoder-init' | 'encoding' | 'download' | 'session-changed' | 'cancelled'
export const EXPORT_ERRORS: Record<ExportErrorCode, string> = {
  'no-stems': '내보낼 6개 stem이 준비되지 않았습니다.',
  'invalid-stems': 'Stem의 길이·채널·샘플레이트 또는 샘플 값이 올바르지 않습니다. 다시 분리하거나 프로젝트를 불러와 주세요.',
  render: '믹스를 생성하지 못했습니다. 메모리 여유를 확인하고 다시 시도해 주세요.',
  'non-finite': '믹스에 올바르지 않은 오디오 값이 있어 내보내기를 중단했습니다.',
  'encoder-init': 'MP3 인코더를 초기화하지 못했습니다. 다시 시도해 주세요.',
  encoding: 'MP3 인코딩에 실패했습니다. 다시 시도해 주세요.',
  download: '다운로드 파일을 생성하지 못했습니다. 다시 시도해 주세요.',
  'session-changed': '음원이 변경되어 이전 믹스의 내보내기를 취소했습니다.',
  cancelled: '믹스 내보내기를 취소했습니다.',
}
export class MixExportError extends Error {
  readonly code: ExportErrorCode
  constructor(code: ExportErrorCode) { super(EXPORT_ERRORS[code]); this.code = code }
}
export interface ExportStem { readonly id: StemId; readonly buffer: AudioBuffer; readonly gain: number }
export interface MixSnapshot {
  readonly trackId: number
  readonly title: string
  readonly artist: string | null
  readonly album: string | null
  readonly artworkUrl: string | null
  readonly stems: readonly ExportStem[]
}

/** Cooperatively scan large PCM buffers without monopolizing the UI thread. */
export async function yieldForExport(signal: AbortSignal) {
  signal.throwIfAborted()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  signal.throwIfAborted()
}
