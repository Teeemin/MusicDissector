import { useEffect, useSyncExternalStore } from 'react'
import { separationStore } from '../separation/separationStore'
import { MODEL, MAX_SECONDS, progressFraction } from '../separation/separationTypes'
import { usePlayback } from '../stores/playbackStore'
import './SeparationPanel.css'

export function SeparationPanel() {
  const state = useSyncExternalStore(separationStore.subscribe, separationStore.getSnapshot)
  const { track, duration } = usePlayback()
  useEffect(() => { void separationStore.initialize() }, [])
  const busy = !['idle', 'complete', 'error', 'cancelled'].includes(state.stage)
  const durationExceeded = duration > MAX_SECONDS
  const stageText = { idle: '모델 준비 후 분리를 시작하세요.', 'model-loading': '분리 준비 · 모델 불러오는 중', 'audio-decoding': '분리할 음원 준비 중', separating: 'AI Stem Separation 진행 중', 'post-processing': '분리 결과 준비 중', complete: '분리 완료 · Stem Mix에서 들어보세요.', error: '분리를 완료하지 못했습니다.', cancelled: '분리를 취소했습니다.' }[state.stage]
  return <section className="separation-panel" aria-label="AI Stem Separation">
    <div className="separation-heading"><h3>AI Stem Separation</h3><span>BS-RoFormer · 6 stems</span></div>
    <div className="model-manager">
      <p>{state.model === 'ready' ? '모델 설치됨 · 약 336 MiB' : state.model === 'downloading' ? '고음질 분리 모델 다운로드 중' : '고음질 분리 모델 · 약 336 MiB'}<small>최초 한 번 다운로드하여 기기에 저장합니다. 브라우저가 저장소를 비우면 다시 받을 수 있어요.</small></p>
      <div className="separation-actions">
        {state.model === 'ready' ? <button type="button" disabled={busy} onClick={() => void separationStore.deleteModel()}>모델 삭제</button>
          : state.model === 'downloading' ? <button type="button" onClick={separationStore.cancelDownload}>다운로드 취소</button>
            : <button type="button" disabled={!state.capability?.supported || state.model === 'checking'} onClick={() => void separationStore.download()}>모델 다운로드</button>}
      </div>
    </div>
    {state.model === 'downloading' && <div className="separation-progress"><progress aria-label="모델 다운로드 진행률" value={state.loaded} max={MODEL.bytes} /><span>{Math.floor(progressFraction(state.loaded, MODEL.bytes) * 100)}% · {(state.loaded / 1048576).toFixed(1)} / {(MODEL.bytes / 1048576).toFixed(1)} MiB</span></div>}
    {state.capability && !state.capability.supported && <p className="separation-note" role="status">{state.capability.reason} 기존 재생·가사·분석은 계속 사용할 수 있어요.</p>}
    <div className="separation-actions">
      <button type="button" className="separation-start" disabled={!track || !state.capability?.supported || state.model !== 'ready' || busy || durationExceeded}
        aria-describedby={durationExceeded ? 'separation-duration-limit' : undefined}
        onClick={() => void separationStore.start(duration)}>분리 시작</button>
      {durationExceeded && <span id="separation-duration-limit" className="separation-limit" role="status">최대 해부 길이는 {MAX_SECONDS / 60}분입니다</span>}
      {busy && <button type="button" onClick={separationStore.cancel}>분리 취소</button>}
      <p className="separation-status" role="status">{busy && <span className="analysis-spinner" aria-hidden="true" />}{stageText}</p>
    </div>
    {state.total > 0 && <div className="separation-progress"><progress aria-label="음원 분리 진행률" value={state.completed} max={state.total} /><span>{Math.floor(progressFraction(state.completed, state.total) * 100)}% · 처리한 청크 {state.completed} / {state.total}</span></div>}
    <p className="separation-note">모바일 메모리 보호를 위해 최대 {MAX_SECONDS / 60}분·128 MiB의 모노/스테레오 음원을 지원합니다. 분리 중에는 앱을 화면에 열어 두세요.</p>
    {state.error && <p className="separation-error" role="status">{state.error}</p>}
  </section>
}
