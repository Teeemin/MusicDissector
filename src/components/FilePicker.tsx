import { useRef, useState } from 'react'
import { audioEngine } from '../audio/AudioEngine'
import { usePlayback } from '../stores/playbackStore'
import { formatFileSize } from '../utils/format'
import { Icon } from './Icon'

export function FilePicker() {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { track } = usePlayback()

  function selectFiles(files: FileList | null) {
    if (!files?.length) return
    if (files.length > 1) {
      setError('음악 파일을 한 번에 하나씩 선택해 주세요.')
      return
    }
    setError(audioEngine.loadFile(files[0]))
  }

  return (
    <>
      <div
        className={`drop-zone ${dragging ? 'is-dragging' : ''} ${track ? 'with-track' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); dragDepth.current++; setDragging(true) }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDragLeave={(event) => { event.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setDragging(false) }}
        onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); selectFiles(event.dataTransfer.files) }}
      >
        <div className="upload-art" aria-hidden="true"><span className="upload-art-back" /><span className="upload-art-front"><Icon name="music" /></span><span className="upload-art-plus">+</span></div>
        <h3>{dragging ? '여기에 놓아주세요' : '어떤 음악을 들어볼까요?'}</h3>
        <p>음악 파일을 끌어다 놓거나<br />기기에서 직접 선택해 주세요.</p>
        <button className="primary-button" onClick={() => inputRef.current?.click()}><Icon name="folder" />{track ? '다른 음악 선택' : '음악 파일 선택'}<Icon name="arrow" /></button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label="음악 파일"
          accept=".mp3,.wav,.flac,.m4a,audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/x-flac,audio/mp4,audio/x-m4a"
          onChange={(event) => { selectFiles(event.target.files); event.target.value = '' }}
        />
        <div className="format-list" aria-label="지원 파일 형식"><span>MP3</span><span>WAV</span><span>FLAC</span><span>M4A</span></div>
      </div>
      {error && <p className="error-message" role="alert"><Icon name="info" />{error}</p>}
      <div className={`selected-file ${track ? 'has-file' : ''}`}>
        <span className="file-icon"><Icon name="music" /></span>
        <div className="file-copy"><p title={track?.fileName}>{track?.fileName ?? '아직 선택한 음악이 없어요'}</p><span>{track ? `${track.format} · ${formatFileSize(track.size)} · 로컬 파일` : '내 기기에 있는 음악으로 시작하세요'}</span></div>
        {track && <Icon name="check" className="file-check" />}
      </div>
      <p className="session-note">앱을 다시 열면 음악 파일을 다시 선택해 주세요.</p>
    </>
  )
}
