import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Development-only fixture generation. Tests use the checked-in files directly.
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
const destination = (name) => fileURLToPath(new URL(`../tests/fixtures/${name}`, import.meta.url))
const source = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=8']
const cover = fileURLToPath(new URL('../public/icons/icon-192.png', import.meta.url))
const metadata = ['-metadata', 'title=테스트 제목', '-metadata', 'artist=테스트 아티스트', '-metadata', 'album=테스트 앨범', '-metadata', 'lyrics=[00:01.00]첫 번째 줄\n[00:04.00]두 번째 줄']
const commands = [
  [...source, '-c:a', 'libmp3lame', '-b:a', '32k', '-id3v2_version', '0', '-write_id3v1', '0', destination('tone.mp3')],
  [...source, '-i', cover, '-map', '0:a', '-map', '1:v', '-c:a', 'flac', '-c:v', 'copy', '-disposition:v', 'attached_pic', ...metadata, destination('tagged.flac')],
  [...source, '-i', cover, '-map', '0:a', '-map', '1:v', '-c:a', 'aac', '-b:a', '32k', '-c:v', 'copy', '-disposition:v', 'attached_pic', ...metadata, destination('tagged.m4a')],
]
for (const args of commands) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Audio fixture generation failed')
}
