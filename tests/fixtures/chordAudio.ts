/** Original, untagged PCM with known voicings; independent of detector templates. */
export const FIXTURE_CHORDS = ['C', 'Cm', 'C7', 'Cmaj7', 'Cm7', 'Csus2', 'Csus4', 'Cdim', 'Caug', 'N', 'N']
const voicings = [[60, 64, 67], [60, 63, 67], [60, 64, 67, 70], [60, 64, 67, 71], [60, 63, 67, 70], [60, 62, 67], [60, 65, 67], [60, 63, 66], [60, 64, 68], [], []]
export function chordAudio() {
  const rate = 22050
  const samples = rate * voicings.length * 2
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40)
  let seed = 11
  for (let i = 0; i < samples; i++) {
    const time = i / rate
    const index = Math.floor(time / 2)
    const notes = voicings[index]
    const envelope = Math.min(1, (time % 2) * 50, (2 - time % 2) * 50)
    let sound = 0
    for (const note of notes) {
      const phase = 2 * Math.PI * (440 * 2 ** ((note - 69) / 12)) * time
      sound += (Math.sin(phase) + .12 * Math.sin(phase * 2) + .04 * Math.sin(phase * 3)) / notes.length
    }
    if (index === 10) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; sound = seed / 0xffffffff * 2 - 1 }
    buffer.writeInt16LE(Math.round(sound * envelope * 18000), 44 + i * 2)
  }
  return { name: 'chord-fixture.wav', mimeType: 'audio/wav', buffer }
}
