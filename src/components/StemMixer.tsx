import { activePreset, effectiveGain } from '../mixer/mixerRules'
import { STEM_DEFINITIONS } from '../mixer/mixerTypes'
import { useMixer } from '../mixer/useMixer'
import { MixerPresets } from './MixerPresets'
import { StemChannel } from './StemChannel'
import './StemMixer.css'

export function StemMixer() {
  const { trackId, channels, error } = useMixer()
  const disabled = trackId === null
  return (
    <section className="mixer-panel" aria-labelledby="mixer-title" aria-describedby="mixer-note">
      <div className="section-heading"><h2 id="mixer-title"><span>04</span> Stem Mixer</h2><span className="mixer-badge">설정 미리보기</span></div>
      <div className="mixer-intro"><p id="mixer-note">아직 stem 음원이 없습니다. 아래 설정은 현재 재생되는 원본 소리에 적용되지 않습니다.</p><a className="mixer-player-link" href="#player-title">재생기로 이동 ↑</a></div>
      <MixerPresets active={activePreset(channels)} disabled={disabled} />
      <div className="stem-grid">{STEM_DEFINITIONS.map(({ id }) => <StemChannel key={id} channel={channels[id]} gain={effectiveGain(channels, id)} disabled={disabled} />)}</div>
      <p className="mixer-help">{disabled ? '음악 파일을 선택하면 믹서 설정을 조절할 수 있어요.' : 'Solo는 여러 채널을 함께 선택할 수 있어요. Mute는 Solo보다 우선합니다.'}</p>
      {error && <p className="error-message" role="alert">{error}</p>}
    </section>
  )
}
