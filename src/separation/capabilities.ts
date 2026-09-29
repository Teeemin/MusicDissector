export interface SeparationCapability { supported: boolean; reason: string; adapter: string }
export async function detectSeparationCapability(): Promise<SeparationCapability> {
  const fail = (reason: string): SeparationCapability => ({ supported: false, reason, adapter: '' })
  if (!isSecureContext) return fail('HTTPS 또는 localhost에서 열어 주세요.')
  if (!navigator.gpu) return fail('이 기기/브라우저에서는 GPU 분리를 지원하지 않습니다.')
  if (!navigator.storage?.getDirectory || typeof Worker === 'undefined' || typeof OfflineAudioContext === 'undefined') return fail('이 브라우저는 필요한 로컬 저장소/오디오 기능을 지원하지 않습니다.')
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter || adapter.limits.maxStorageBuffersPerShaderStage < 8) return fail('사용 가능한 WebGPU 장치가 없습니다.')
    if (!adapter.features.has('shader-f16')) return fail('이 GPU는 FP16 분리 모델을 지원하지 않습니다.')
    return { supported: true, reason: '', adapter: adapter.info?.description || adapter.info?.device || 'WebGPU' }
  } catch { return fail('WebGPU 장치를 초기화하지 못했습니다.') }
}
