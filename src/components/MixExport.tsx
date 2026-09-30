import { useSyncExternalStore } from 'react'
import { exportStore } from '../export/exportStore'
import { EXPORT_ERRORS } from '../export/exportTypes'
import { useMixer } from '../mixer/useMixer'
import { usePlayback } from '../stores/playbackStore'
import './MixExport.css'

export function MixExport() {
  const state = useSyncExternalStore(exportStore.subscribe, exportStore.getSnapshot)
  const mix = useMixer()
  const { track } = usePlayback()
  const ready = !!track && mix.trackId === track.id && mix.separationStatus === 'ready'
  const cancelled = state.error === 'cancelled' || state.error === 'session-changed'
  const labels = { idle: '', mixing: '믹스 생성 중...', encoding: 'MP3 인코딩 중...', download: '다운로드 준비 중...' }
  return <div className="mix-export" aria-label="현재 믹스 내보내기">
    <div className="mix-export-actions">
      <button type="button" disabled={!ready || state.busy} onClick={() => void exportStore.start()}>현재 믹스 내보내기</button>
      {state.busy && <button type="button" onClick={exportStore.cancel}>내보내기 취소</button>}
    </div>
    <small>현재 채널 설정으로 MP3를 다운로드합니다. 프로젝트 저장과는 별개이며, 재생기 전체 음량은 반영하지 않습니다.</small>
    {state.busy && <p role="status"><span className="analysis-spinner" aria-hidden="true" />{labels[state.stage]}</p>}
    {!state.busy && state.message && <p role="status">{state.message}</p>}
    {!state.busy && state.error && <p className={cancelled ? undefined : 'mix-export-error'} role={cancelled ? 'status' : 'alert'}>{EXPORT_ERRORS[state.error]}</p>}
  </div>
}
