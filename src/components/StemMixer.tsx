import { activePreset, effectiveGain } from '../mixer/mixerRules'
import { STEM_DEFINITIONS } from '../mixer/mixerTypes'
import { useMixer } from '../mixer/useMixer'
import { MixerPresets } from './MixerPresets'
import { StemChannel } from './StemChannel'
import './StemMixer.css'
import { SeparationPanel } from './SeparationPanel'
import { usePlayback } from '../stores/playbackStore'
import { ProjectSaveControls } from './SavedProjects'
import { audioEngine } from '../audio/AudioEngine'
import { MixExport } from './MixExport'

export function StemMixer() {
  const { trackId, channels, error, separationStatus } = useMixer()
  const { mode } = usePlayback()
  const disabled = trackId === null
  return (
    <section className="mixer-panel" aria-labelledby="mixer-title" aria-describedby="mixer-note">
      <div className="section-heading"><h2 id="mixer-title"><span>04</span> Dissector</h2>{separationStatus === 'ready' && <span className="mixer-badge">6 stems 준비됨</span>}</div>
      <div className="mixer-intro"><p id="mixer-note">{separationStatus === 'ready' ? mode === 'stems' ? '현재 Stem Mix · 채널 설정이 소리에 적용됩니다. 재생기에서 Original을 선택하면 원본과 비교할 수 있어요.' : '현재 Original · 원본을 듣고 있습니다. 채널이나 프리셋을 조절하면 Stem Mix로 전환되어 소리에 적용됩니다.' : '아직 stem 음원이 없습니다. 아래 설정은 현재 재생되는 원본 소리에 적용되지 않습니다.'}</p><a className="mixer-player-link" href="#player-title">재생기로 이동 ↑</a></div>
      <SeparationPanel />
      {separationStatus === 'ready' && mode === 'original' && <div className="separation-actions"><button type="button" onClick={() => void audioEngine.setMode('stems')}>Stem Mix로 듣기</button></div>}
      <MixerPresets active={activePreset(channels)} disabled={disabled} />
      <div className="stem-grid">{STEM_DEFINITIONS.map(({ id }) => <StemChannel key={id} channel={channels[id]} gain={effectiveGain(channels, id)} disabled={disabled} />)}</div>
      <p className="mixer-help">{disabled ? '음악 파일을 선택하면 믹서 설정을 조절할 수 있어요.' : 'Solo는 여러 채널을 함께 선택할 수 있어요. Mute는 Solo보다 우선합니다.'}</p>
      <ProjectSaveControls />
      <MixExport />
      {error && <p className="error-message" role="alert">{error}</p>}
    </section>
  )
}
