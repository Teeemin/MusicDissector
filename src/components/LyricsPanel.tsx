import { audioEngine } from '../audio/AudioEngine'
import { findActiveLine } from '../lyrics/LyricsParser'
import { useLyricsFollow } from '../lyrics/useLyricsFollow'
import type { LyricsDocument } from '../lyrics/types'
import { usePlayback } from '../stores/playbackStore'
import { formatTime } from '../utils/format'
import './LyricsPanel.css'
import { useMemo } from 'react'
import { useChords } from '../analysis/useChords'
import { matchLyricChords } from '../analysis/chordUtils'

type TimedLyrics = Extract<LyricsDocument, { lines: unknown }>

function TimedLyricsView({ lyrics }: { lyrics: TimedLyrics }) {
  const { currentTime, duration, isReady } = usePlayback()
  const activeIndex = findActiveLine(lyrics.lines, currentTime)
  const { result } = useChords()
  const matches = useMemo(() => matchLyricChords(lyrics.lines, duration, result?.chords ?? []), [lyrics.lines, duration, result])
  const { viewportRef, following, pauseFollowing, resumeFollowing } = useLyricsFollow(activeIndex, result)

  return (
    <>
      <div className="lyrics-toolbar">
        <p>{following ? '현재 가사를 따라가고 있어요' : '자동 따라가기 일시 중지'} · 가사를 누르면 해당 위치로 이동해요.</p>
        <button className={`follow-button ${following ? 'is-following' : ''}`} aria-pressed={following} onClick={resumeFollowing}>Follow</button>
      </div>
      <div
        className="lyrics-scroll timed-lyrics"
        ref={viewportRef}
        role="region"
        aria-label="동기화 가사"
        tabIndex={0}
        onWheel={pauseFollowing}
        onTouchMove={pauseFollowing}
        onPointerDown={(event) => { if (event.target === event.currentTarget) pauseFollowing() }}
        onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pauseFollowing() }}
      >
        <ol className="lyrics-lines">
          {lyrics.lines.map((line, index) => (
            <li key={`${index}:${line.time}`}>
              {!!matches[index]?.length && <div className="lyric-chords" aria-label="이 가사 구간의 코드">
                {matches[index].map((chord) => <button type="button" className="lyric-chord" key={chord.start}
                  disabled={!isReady || chord.start > duration} aria-label={`${formatTime(chord.start)} ${chord.chord} 코드로 이동`}
                  onClick={() => audioEngine.seek(chord.start)}>{chord.chord}</button>)}
              </div>}
              <button
                className="lyric-line"
                data-active={index === activeIndex}
                aria-current={index === activeIndex ? 'true' : undefined}
                aria-label={`${formatTime(line.time)} ${line.text || '간주'}`}
                disabled={!isReady || line.time > duration}
                onClick={() => audioEngine.seek(line.time)}
              >
                <span className="lyric-time" aria-hidden="true">{formatTime(line.time)}</span>
                <span>{line.text || '♪'}</span>
              </button>
            </li>
          ))}
        </ol>
        {lyrics.untimedText && <div className="untimed-lyrics"><p className="lyrics-caption">동기화 정보 없음</p><p className="plain-lyrics">{lyrics.untimedText}</p></div>}
      </div>
    </>
  )
}

export function LyricsPanel() {
  const { track } = usePlayback()
  const lyrics = track?.lyrics ?? { kind: 'none' }
  const timed = lyrics.kind === 'lrc' || lyrics.kind === 'synchronized'
  const status = track?.metadataStatus === 'loading' ? '읽는 중' : timed ? lyrics.kind === 'lrc' ? 'LRC · 시간 동기화' : '내장 동기화 가사' : lyrics.kind === 'plain' ? '동기화 정보 없음' : '내장 가사'

  return (
    <section className="lyrics-panel" aria-labelledby="lyrics-title">
      <div className="section-heading"><h2 id="lyrics-title"><span>03</span> 가사</h2><span className="lyrics-badge">{status}</span></div>
      {timed ? <TimedLyricsView key={track!.id} lyrics={lyrics} />
        : lyrics.kind === 'plain' ? <div key={track!.id} className="lyrics-scroll" role="region" aria-label="일반 가사" tabIndex={0}><p className="plain-lyrics">{lyrics.text}</p></div>
          : <p className="lyrics-empty" role="status">{!track ? '음악을 선택하면 내장 가사를 확인할 수 있어요.' : track.metadataStatus === 'loading' ? '내장 가사를 읽고 있어요…' : track.metadataStatus === 'unavailable' ? '파일의 내장 정보를 읽지 못했어요. 음악 재생은 계속 사용할 수 있어요.' : '내장 가사가 없습니다'}</p>}
    </section>
  )
}
