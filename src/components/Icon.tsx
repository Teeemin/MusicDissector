import type { CSSProperties } from 'react'

const paths = {
  wave: <><path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" />,
  headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 13h3v8H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Zm16 0h-3v8h3a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2Z" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
  music: <><path d="M9 18V5l11-2v13M9 9l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2.5" /><ellipse cx="17" cy="16" rx="3" ry="2.5" /></>,
  play: <path d="m9 5 11 7-11 7Z" fill="currentColor" strokeLinejoin="round" />,
  pause: <><path d="M8 5v14M16 5v14" strokeWidth="5" /></>,
  back: <><path d="M3 9a9 9 0 1 1 0 7M3 4v5h5" /><text x="7.2" y="16" stroke="none" fill="currentColor" fontSize="9" fontWeight="700">10</text></>,
  forward: <><path d="M21 9a9 9 0 1 0 0 7m0-12v5h-5" /><text x="7.2" y="16" stroke="none" fill="currentColor" fontSize="9" fontWeight="700">10</text></>,
  volume: <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
  muted: <><path d="m11 4-6 5H2v6h3l6 5Zm5 5 5 6m0-6-5 6" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
} as const

export function Icon({ name, className, style }: { name: keyof typeof paths; className?: string; style?: CSSProperties }) {
  return <svg className={className} style={style} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
