import type { CSSProperties } from 'react'
import { audioEngine } from '../audio/AudioEngine'
import { usePlayback } from '../stores/playbackStore'
import { formatTime } from '../utils/format'
import { Icon } from './Icon'
import { TrackArtwork } from './TrackArtwork'
import { AnalysisSummary } from './AnalysisSummary'
import { useMixer } from '../mixer/useMixer'

export function Player() {
  const { track, currentTime, duration, isPlaying, isReady, isLoading, isStarting, isBuffering, volume, muted, repeatEnabled, error, mode } = usePlayback()
  const { separationStatus } = useMixer()
  const progress = duration ? Math.min(100, currentTime / duration * 100) : 0
  const status = error ? '재생 오류' : isLoading ? '불러오는 중' : isStarting || isBuffering ? '재생 준비 중' : isPlaying ? '재생 중' : track ? '재생 준비 완료' : '음악을 기다리는 중'
  const controlsDisabled = !isReady

  return (
    <section className={`player-panel ${track ? 'has-track' : ''}`} aria-labelledby="player-title">
      <div className="section-heading">
        <h2 id="player-title"><span>02</span> 재생기</h2>
        <span className={`playback-status ${isPlaying ? 'is-playing' : ''}`} role="status"><span />{status}</span>
      </div>
      {separationStatus === 'ready' && <div className="playback-mode" role="group" aria-label="재생 소스">
        <button type="button" aria-pressed={mode === 'original'} onClick={() => void audioEngine.setMode('original')}>Original</button>
        <button type="button" aria-pressed={mode === 'stems'} onClick={() => void audioEngine.setMode('stems')}>Stem Mix</button>
      </div>}
      <div className="listening-stage">
        <TrackArtwork key={`${track?.id}:${track?.artworkUrl}`} artworkUrl={track?.artworkUrl} title={track?.name} isPlaying={isPlaying} />
        <div className="track-info">
          <h3 title={track?.name}>{track?.name ?? '당신의 음악을 들려주세요'}</h3>
          {track?.artist && <p className="track-artist">{track.artist}</p>}
          {track?.album && <p className="track-album">{track.album}</p>}
          <p className="track-format">{track ? `${track.format} AUDIO · 로컬 파일` : '파일을 선택하면 이곳에서 재생할 수 있어요.'}</p>
        </div>
        <AnalysisSummary />
      </div>

      {error && <p className="error-message player-error" role="alert"><Icon name="info" />{error}</p>}
      <div className="transport">
        <div className="seek-control">
          <label className="sr-only" htmlFor="seek">재생 위치</label>
          <input id="seek" className="range seek-range" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(currentTime, duration || 1)} disabled={controlsDisabled} onChange={(event) => audioEngine.seek(Number(event.target.value))} style={{ '--progress': `${progress}%` } as CSSProperties} aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`} />
          <div className="time-labels"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
        </div>
        <div className="playback-buttons">
          <div className="volume-control">
            <button className="icon-button" aria-label={muted ? '음소거 해제' : '음소거'} aria-pressed={muted} disabled={!track} onClick={() => audioEngine.toggleMute()}><Icon name={muted || volume === 0 ? 'muted' : 'volume'} /></button>
            <label className="sr-only" htmlFor="volume">음량</label>
            <input id="volume" className="range volume-range" type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} disabled={!track} onChange={(event) => audioEngine.setVolume(Number(event.target.value))} style={{ '--progress': `${muted ? 0 : volume * 100}%` } as CSSProperties} aria-valuetext={`${muted ? 0 : Math.round(volume * 100)}%`} />
          </div>
          <button className="skip-button" aria-label="10초 뒤로" title="10초 뒤로" disabled={controlsDisabled} onClick={() => audioEngine.skip(-10)}><Icon name="back" /></button>
          <button className="play-button" aria-label={isPlaying ? '일시 정지' : '재생'} title={isPlaying ? '일시 정지' : '재생'} disabled={controlsDisabled || isStarting} onClick={() => isPlaying ? audioEngine.pause() : void audioEngine.play()}><Icon name={isPlaying ? 'pause' : 'play'} /></button>
          <button className="skip-button" aria-label="10초 앞으로" title="10초 앞으로" disabled={controlsDisabled} onClick={() => audioEngine.skip(10)}><Icon name="forward" /></button>
          <button type="button" className="icon-button repeat-button" aria-label="반복 재생" title={repeatEnabled ? '반복 재생 끄기' : '반복 재생 켜기'} aria-pressed={repeatEnabled} onClick={() => audioEngine.toggleRepeat()}><Icon name="repeat" /></button>
        </div>
      </div>
    </section>
  )
}
