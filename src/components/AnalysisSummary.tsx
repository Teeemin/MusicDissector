import { useSyncExternalStore } from 'react'
import { analysisStore } from '../analysis/analysisStore'
import { getCurrentBeatIndex } from '../analysis/beatTimeline'
import { usePlayback } from '../stores/playbackStore'
import './AnalysisSummary.css'
import { ChordProgression } from './ChordDisplay'

export function AnalysisSummary() {
  const state = useSyncExternalStore(analysisStore.subscribe, analysisStore.getSnapshot)
  const { track, currentTime } = usePlayback()
  // A selection's playback and analysis stores notify independently in one task.
  const matching = state.trackId === track?.id
  const result = matching ? state.result : null
  const busy = matching && ['decoding', 'analyzing'].includes(state.status)
  const beat = getCurrentBeatIndex(currentTime, result?.beats ?? [])
  const status = !track ? '음원을 선택하면 분석합니다'
    : busy ? state.stage === 'bpm' ? 'BPM 분석 중' : state.stage === 'key' ? 'Key 분석 중' : '음원 준비 중'
    : state.status === 'error' ? '이 음원을 분석하지 못했습니다. 재생은 계속할 수 있어요.'
    : result ? result.bpm === null || result.key === null ? '일부 분석 정보를 확인하지 못했습니다'
      : state.cached ? '저장된 분석 결과' : '분석 완료 · 추정값' : '분석 대기'
  return (
    <section className="analysis-summary" aria-label="음원 분석">
      <dl className="analysis-values">
        <div><dt>BPM</dt><dd data-testid="analysis-bpm">{result?.bpm != null ? Math.round(result.bpm) : busy ? '분석 중' : '--'}</dd></div>
        <div><dt>KEY</dt><dd data-testid="analysis-key">{result?.key ? `${result.key} ${result.scale === 'major' ? 'Major' : 'Minor'}` : busy ? '분석 중' : '--'}</dd></div>
      </dl>
      <div className="analysis-details">
        <span data-testid="analysis-beats">{result?.beats.length ? `Beat ${beat + 1} / ${result.beats.length}` : 'Beat --'}</span>
        <button type="button" disabled={!track || busy} onClick={analysisStore.reanalyze}>다시 분석</button>
      </div>
      <p className="analysis-status" role="status">
        {busy && <span className="analysis-spinner" aria-hidden="true" />}
        <span>{status}</span>
      </p>
      <ChordProgression />
    </section>
  )
}
