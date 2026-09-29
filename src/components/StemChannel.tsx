import type { CSSProperties } from 'react'
import { mixerActions } from '../mixer/mixerActions'
import type { StemChannelState } from '../mixer/mixerTypes'

export function StemChannel({ channel, gain, disabled }: { channel: StemChannelState; gain: number; disabled: boolean }) {
  const percent = Math.round(channel.volume * 100)
  return (
    <div className={`stem-channel ${gain === 0 ? 'is-excluded' : ''}`} role="group" aria-label={`${channel.label} 채널`} data-stem={channel.id} data-source={channel.source ? 'buffer' : 'none'} data-effective-gain={gain}>
      <div className="stem-channel-heading"><h3>{channel.label}</h3><span className="stem-setting-status">{gain === 0 ? '제외 설정' : '활성 설정'}</span></div>
      <div className="stem-controls">
        <label className="sr-only" htmlFor={`stem-volume-${channel.id}`}>{channel.label} 볼륨</label>
        <input id={`stem-volume-${channel.id}`} type="range" className="range stem-volume" min="0" max="100" step="1" value={percent} disabled={disabled} aria-valuetext={`${percent}%`} style={{ '--progress': `${percent}%` } as CSSProperties} onChange={(event) => mixerActions.setVolume(channel.id, Number(event.target.value) / 100)} />
        <output className="stem-percentage" htmlFor={`stem-volume-${channel.id}`}>{percent}%</output>
        <button className="stem-toggle mute-toggle" aria-label={`${channel.label} Mute`} aria-pressed={channel.muted} disabled={disabled} onClick={() => mixerActions.toggleMute(channel.id)}>Mute</button>
        <button className="stem-toggle solo-toggle" aria-label={`${channel.label} Solo`} aria-pressed={channel.solo} disabled={disabled} onClick={() => mixerActions.toggleSolo(channel.id)}>Solo</button>
      </div>
    </div>
  )
}
