export const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const naturals: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Shared sharp convention for global key and chord roots. */
export function normalizePitchName(input: string): string | null {
  const match = /^([A-Ga-g])([#b♯♭]?)$/.exec(input.trim())
  if (!match) return null
  const accidental = ['#', '♯'].includes(match[2]) ? 1 : ['b', '♭'].includes(match[2]) ? -1 : 0
  return PITCH_NAMES[(naturals[match[1].toUpperCase()] + accidental + 12) % 12]
}

export function normalizeChord(input: string): string | null {
  if (['N', 'No Chord', '-'].includes(input.trim())) return 'N'
  const match = /^([A-Ga-g][#b♯♭]?)(maj7|min7|m7|sus2|sus4|dim|aug|7|maj|min|m|M)?$/.exec(input.trim())
  if (!match) return null
  const root = normalizePitchName(match[1])
  const suffix = { min7: 'm7', min: 'm', maj: '', M: '' }[match[2]] ?? match[2] ?? ''
  return root ? root + suffix : null
}
