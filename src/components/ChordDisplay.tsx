import { useEffect, useRef, useState } from 'react'
import { useChords } from '../analysis/useChords'
import { chordStore } from '../analysis/chordStore'
import { getChordAtTime, getChordIndexAtTime, getNextChord, getPreviousChord } from '../analysis/chordUtils'
import type { ChordSegment } from '../analysis/chordTypes'
import { usePlayback } from '../stores/playbackStore'
import { audioEngine } from '../audio/AudioEngine'
import { formatTime } from '../utils/format'
import './ChordDisplay.css'

const EMPTY: ChordSegment[] = []
const label = (chord?: ChordSegment | null) => !chord || chord.chord === 'N' ? '—' : chord.chord

export function CurrentChord() {
  const { result } = useChords()
  const { currentTime, track } = usePlayback()
  const chords = result?.chords ?? EMPTY
  if (!track) return null
  return <div className="current-chord-strip" aria-label="현재 코드 추정">
    <div><span>이전</span><strong data-testid="previous-chord">{label(getPreviousChord(currentTime, chords))}</strong></div>
    <div className="current-chord-main"><span>현재 코드 · 추정</span><strong data-testid="current-chord">{label(getChordAtTime(currentTime, chords))}</strong></div>
    <div><span>다음</span><strong data-testid="next-chord">{label(getNextChord(currentTime, chords))}</strong></div>
  </div>
}

function Timeline({ chords }: { chords: ChordSegment[] }) {
  const { currentTime, isReady } = usePlayback()
  const index = getChordIndexAtTime(currentTime, chords)
  const viewport = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  useEffect(() => {
    const box = viewport.current
    if (!box || !following) return
    const active = box.querySelector<HTMLElement>('[aria-current="true"]')
    const left = active ? box.scrollLeft + active.getBoundingClientRect().left - box.getBoundingClientRect().left - box.clientWidth / 2 + active.offsetWidth / 2 : 0
    box.scrollTo({ left: Math.max(0, left), behavior: 'instant' })
  }, [index, following])
  return <>
    <div className="chord-timeline-tools"><span>{following ? '현재 코드를 따라가는 중' : '코드 따라가기 일시 중지'}</span>
      <button type="button" aria-label="코드 따라가기" aria-pressed={following} onClick={() => setFollowing(true)}>따라가기</button></div>
    <div className="chord-timeline" ref={viewport} role="region" aria-label="코드 타임라인" tabIndex={0}
      onWheel={() => setFollowing(false)} onTouchMove={() => setFollowing(false)}
      onPointerDown={(e) => { if (e.target === e.currentTarget) setFollowing(false) }}
      onKeyDown={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', ' '].includes(e.key)) setFollowing(false) }}>
      <ol>{chords.map((chord, i) => <li key={`${i}:${chord.start}`}>
        <button type="button" disabled={!isReady} aria-current={index === i ? 'true' : undefined}
          aria-label={`${formatTime(chord.start)} 코드 ${chord.chord === 'N' ? '없음' : chord.chord}`}
          onClick={() => audioEngine.seek(chord.start)}>
          <strong>{label(chord)}</strong><span>{formatTime(chord.start)}</span>
        </button>
      </li>)}</ol>
    </div>
  </>
}

export function ChordProgression() {
  const { result, status, cached, trackId } = useChords()
  const { track } = usePlayback()
  const busy = !!track && !['idle', 'complete', 'error'].includes(status)
  const text = !track ? '음원을 선택하면 코드를 분석합니다'
    : status === 'waiting' ? '코드 분석 대기 중'
    : status === 'decoding' ? '코드 분석용 음원 준비 중'
    : status === 'extracting' ? '코드 특징 추출 중'
    : status === 'detecting' ? '코드 진행 분석 중'
    : status === 'error' ? '코드를 분석하지 못했습니다. 재생은 계속할 수 있어요.'
    : result ? result.chords.every((s) => s.chord === 'N') ? '확인할 수 있는 코드가 없습니다'
      : cached ? '저장된 코드 분석 · 추정값' : '코드 분석 완료 · 추정값' : '코드 분석 대기 중'
  return <section className="chord-progression" aria-label="코드 진행 분석">
    <div className="chord-progression-heading"><span>CHORDS</span>
      <button type="button" disabled={!track || busy} onClick={chordStore.reanalyze}>코드 재분석</button></div>
    <p className="chord-status" role="status">{busy && <span className="analysis-spinner" aria-hidden="true" />}<span>{text}</span></p>
    {!!result?.chords.length && <Timeline key={`${trackId}:${result.analyzedAt}`} chords={result.chords} />}
  </section>
}
