import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

// Dependency-free PNG generation for the same vector-style mark as favicon.svg.
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const name = Buffer.from(type)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([size, name, data, crc])
}

function icon(size, maskable = false) {
  const raw = Buffer.alloc((size * 3 + 1) * size)
  const heights = [0.11, 0.25, 0.39, 0.25, 0.11]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size
      const ny = (y + 0.5) / size
      const dx = Math.max(Math.abs(nx - 0.5) - 0.26, 0)
      const dy = Math.max(Math.abs(ny - 0.5) - 0.26, 0)
      const inside = maskable || dx * dx + dy * dy < 0.15 ** 2
      const wave = heights.some((height, index) => {
        const bx = Math.abs(nx - (0.32 + index * 0.09))
        const by = Math.max(Math.abs(ny - 0.5) - height / 2 + 0.018, 0)
        return bx * bx + by * by <= 0.018 ** 2
      })
      const color = wave ? [255, 255, 255] : inside ? [109, 167, 242] : [255, 255, 255]
      const offset = y * (size * 3 + 1) + 1 + x * 3
      raw.set(color, offset)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const directory = new URL('../public/icons/', import.meta.url)
mkdirSync(directory, { recursive: true })
for (const [name, size, maskable] of [['icon-192', 192, false], ['icon-512', 512, false], ['maskable-512', 512, true], ['apple-touch-icon', 180, false]]) {
  writeFileSync(new URL(`${name}.png`, directory), icon(size, maskable))
}
