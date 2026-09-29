/** Deterministic, actual PCM: 120 BPM transients over a C-major cadence. No tags. */
export function analysisAudio(silent = false, seconds = 24) {
  const rate = 22050
  const length = rate * seconds
  const buffer = Buffer.alloc(44 + length * 2)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36)
  buffer.writeUInt32LE(length * 2, 40)
  const chords = [[261.6256, 329.6276, 391.9954], [261.6256, 329.6276, 391.9954], [261.6256, 349.2282, 440], [246.9417, 293.6648, 391.9954]]
  let seed = 1
  for (let i = 0; i < length; i++) {
    const t = i / rate
    const phase = t % .5
    const chord = chords[Math.floor(t / 2) % chords.length]
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const noise = seed / 0xffffffff * 2 - 1
    const tone = chord.reduce((sum, hz) => sum + Math.sin(2 * Math.PI * hz * t) + .2 * Math.sin(4 * Math.PI * hz * t), 0) / 4
    const beat = Math.exp(-phase * 65) * (noise * .35 + Math.sin(2 * Math.PI * 75 * phase) * .55)
    const sample = silent ? 0 : tone * .32 * (.7 + .3 * Math.exp(-phase * 8)) + beat * .65
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 28000), 44 + i * 2)
  }
  return { name: silent ? 'silence.wav' : 'fixture.wav', mimeType: 'audio/wav', buffer }
}
