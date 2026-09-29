/** Last detected beat at or before the existing playback clock; -1 before the first. */
export function getCurrentBeatIndex(currentTime: number, beats: readonly number[]): number {
  if (!Number.isFinite(currentTime)) return -1
  let low = 0
  let high = beats.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (beats[mid] <= currentTime) low = mid + 1
    else high = mid
  }
  return low - 1
}
