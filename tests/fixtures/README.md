# Audio fixtures

These are original synthetic 440 Hz tones, not songs or copyrighted recordings.

- `tone.mp3`: 8-second tone; test helpers prepend real ID3v2.3 tags (USLT, SYLT, APIC).
- `tagged.flac`, `tagged.m4a`: the same tone with title/artist/album, LRC lyrics, and the project's generated icon as artwork.
- `audio.ts`: creates playable PCM WAV files with real RIFF/ID3 metadata and lyrics.

Regenerate the binary files with FFmpeg installed:

```sh
node scripts/generate-audio-fixtures.mjs
```

`FFMPEG_PATH` may specify a binary path. FFmpeg is only needed to regenerate these fixtures, not to run the app or tests. No test fixtures are copied into the production app.
