import type { StemId } from '../mixer/mixerTypes'

export const MODEL = {
  revision: 'a744f80957374e1735ad70fa122670b7961da8cc',
  name: 'BS-RoFormer-SW 6-stem FP16',
  file: 'bs_roformer_sw_6stem_fp16.onnx',
  bytes: 352778874,
  sha256: 'd3d2bac77a7023282cb5f35a5807179e34076b60589867b572275f1a8ec36444',
  url: '/api/model/bs-roformer-sw-6stem-fp16',
} as const
export const STEM_OUTPUT_ORDER: StemId[] = ['bass', 'drums', 'others', 'vocals', 'guitar', 'piano']
export const SAMPLE_RATE = 44100
export const CHUNK_SAMPLES = 176400
export const OVERLAP = 44100
export const STEP = CHUNK_SAMPLES - OVERLAP
export const STFT_SETTINGS = { nFft: 2048, hopLength: 512, winLength: 2048 }
export const MAX_SECONDS = 360
export type SeparationStage = 'idle' | 'model-loading' | 'audio-decoding' | 'separating' | 'post-processing' | 'complete' | 'error' | 'cancelled'
export type SeparationErrorCode = 'unsupported' | 'download' | 'model-load' | 'audio-decode' | 'memory' | 'inference' | 'cancelled'
export class SeparationError extends Error {
  code: SeparationErrorCode
  constructor(code: SeparationErrorCode, message?: string) { super(message ?? code); this.code = code }
}
export const ERROR_MESSAGES: Record<SeparationErrorCode, string> = {
  unsupported: '이 기기/브라우저에서는 GPU 분리를 지원하지 않습니다. 기존 재생·분석은 계속 사용할 수 있어요.',
  download: '모델을 다운로드하거나 저장하지 못했습니다. 네트워크와 저장 공간을 확인해 주세요.',
  'model-load': 'GPU에 모델을 불러오지 못했습니다. 다른 앱을 닫고 다시 시도해 주세요.',
  'audio-decode': '분리할 음원을 읽지 못했습니다. 다른 음악 파일을 선택해 주세요.',
  memory: '분리에 필요한 메모리 또는 저장 공간이 부족합니다. 더 짧은 음원으로 시도해 주세요.',
  inference: 'GPU 분리에 실패했습니다. 원본 재생은 계속할 수 있어요.',
  cancelled: '분리를 취소했습니다.',
}
export interface SeparationProgress { stage: SeparationStage; completed: number; total: number }
export interface SeparationOptions { signal?: AbortSignal; onProgress?: (progress: SeparationProgress) => void }
export function chunkCount(length: number) { return Math.max(1, Math.ceil((length - OVERLAP) / STEP)) }
export function progressFraction(completed: number, total: number) { return total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0 }
export function classifyError(error: unknown, fallback: SeparationErrorCode): SeparationErrorCode {
  if (error instanceof SeparationError) return error.code
  if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /out of memory|allocation|quota|memory access|insufficient memory/i.test(message) ? 'memory' : fallback
}
