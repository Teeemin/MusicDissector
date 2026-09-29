import { useEffect, useRef, useState } from 'react'

export function useLyricsFollow(activeIndex: number, layoutKey: unknown = null) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !following) return
    const active = viewport.querySelector<HTMLElement>('[data-active="true"]')
    const line = active?.closest('li') ?? active
    const top = line
      ? viewport.scrollTop + line.getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientHeight / 2 + line.offsetHeight / 2
      : 0
    // Scroll this panel only; never move the player or the page on lyric changes.
    viewport.scrollTo({ top: Math.max(0, top), behavior: 'instant' })
  }, [activeIndex, following, layoutKey])

  function pauseFollowing() {
    setFollowing(false)
  }

  return { viewportRef, following, pauseFollowing, resumeFollowing: () => setFollowing(true) }
}
