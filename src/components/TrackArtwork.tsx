import { useState } from 'react'
import { Icon } from './Icon'

export function TrackArtwork({ artworkUrl, title, isPlaying }: { artworkUrl?: string | null; title?: string; isPlaying: boolean }) {
  const [failed, setFailed] = useState(false)
  if (artworkUrl && !failed) {
    return <img className="track-artwork" src={artworkUrl} alt={`${title ?? '현재 곡'} 앨범 아트`} onError={() => setFailed(true)} />
  }
  return (
    <div className={`record ${isPlaying ? 'is-playing' : ''}`} aria-hidden="true">
      <div className="record-grooves" /><div className="record-label"><Icon name="wave" /><span>STEMLAB</span><i /></div>
      <span className="record-shine" />
    </div>
  )
}
