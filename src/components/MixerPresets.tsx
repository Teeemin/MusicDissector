import { mixerStore } from '../mixer/mixerStore'
import { MIXER_PRESETS } from '../mixer/mixerTypes'
import type { MixerPresetId } from '../mixer/mixerTypes'

export function MixerPresets({ active, disabled }: { active: MixerPresetId | null; disabled: boolean }) {
  return (
    <div className="mixer-presets" role="group" aria-label="Quick Presets">
      {MIXER_PRESETS.map(({ id, label }) => <button key={id} className="preset-button" disabled={disabled} aria-pressed={active === id} onClick={() => mixerStore.applyPreset(id)}>{label}</button>)}
    </div>
  )
}
