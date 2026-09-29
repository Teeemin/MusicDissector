import { useState, useSyncExternalStore } from 'react'
import { audioEngine } from '../audio/AudioEngine'
import { lyricsText } from '../lyrics/LyricsParser'
import type { LocalTrack } from '../types/audio'
import './LyricsPanel.css'

const getTrack = () => audioEngine.getSnapshot().track

function LyricsDisclosure({ track }: { track: LocalTrack | null }) {
  const [open, setOpen] = useState(false)
  const text = lyricsText(track?.lyrics ?? { kind: 'none' })
  return (
    <section className="lyrics-panel" aria-labelledby="lyrics-title">
      <div className="section-heading">
        <h2 id="lyrics-title"><span>03</span><button className="lyrics-toggle" type="button" aria-expanded={open} aria-controls="lyrics-content" onClick={() => setOpen(!open)}>
          가사 <span aria-hidden="true">{open ? '▲' : '▼'}</span>
        </button></h2>
      </div>
      <div className={`lyrics-collapse ${open ? 'is-open' : ''}`} aria-hidden={!open} inert={!open}>
        <div className="lyrics-collapse-inner">
          <div id="lyrics-content" className="lyrics-scroll" role="region" aria-label="가사 내용" tabIndex={open ? 0 : -1}>
            {track?.metadataStatus === 'loading' ? <p className="lyrics-empty" role="status">가사를 읽고 있습니다…</p>
              : text ? <p className="plain-lyrics">{text}</p>
                : <p className="lyrics-empty" role="status">포함된 가사가 없습니다.</p>}
          </div>
        </div>
      </div>
    </section>
  )
}

export function LyricsPanel() {
  // Subscribe to track changes only; playback ticks don't render or scroll lyrics.
  const track = useSyncExternalStore(audioEngine.subscribe, getTrack)
  return <LyricsDisclosure key={track?.id ?? 'empty'} track={track} />
}
