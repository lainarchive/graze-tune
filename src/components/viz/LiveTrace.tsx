import { useEffect, useRef, useState } from 'react'
import { useReducedMotionConfig } from 'motion/react'

const N = 180
const MAX = 26

// shortcut: simulated samples until the PresentMon bridge exists, swap for the live event stream.
function sample(i: number) {
  return 7.2 + Math.sin(i / 9) * 0.35 + (Math.random() - 0.5) * 0.9 + (i % 67 === 0 ? 5 + Math.random() * 3 : 0)
}

export function LiveTrace({ className }: { className?: string }) {
  const reduce = useReducedMotionConfig()
  const tick = useRef(0)
  const [data, setData] = useState(() => Array.from({ length: N }, (_, i) => sample(i)))

  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => {
      tick.current += 1
      setData((d) => [...d.slice(1), sample(N + tick.current)])
    }, 60)
    return () => clearInterval(id)
  }, [reduce])

  const w = 1000
  const h = 220
  const x = (i: number) => (i / (N - 1)) * w
  const y = (v: number) => h - (Math.min(v, MAX) / MAX) * h
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const last = data[data.length - 1] ?? 0
  const guides = [
    { ms: 16.7, label: '60 fps' },
    { ms: 8.3, label: '120 fps' },
  ]

  return (
    <div className={className}>
      <div className="relative h-full w-full graticule">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <defs>
            <linearGradient id="lt-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="lt-fade" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="white" stopOpacity="0" />
              <stop offset="12%" stopColor="white" stopOpacity="1" />
            </linearGradient>
            <mask id="lt-mask"><rect width={w} height={h} fill="url(#lt-fade)" /></mask>
          </defs>
          {guides.map((g) => (
            <line key={g.ms} x1="0" x2={w} y1={y(g.ms)} y2={y(g.ms)} stroke="var(--muted-foreground)" strokeOpacity="0.35" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
          ))}
          <g mask="url(#lt-mask)">
            <path d={`${line}L${w},${h}L0,${h}Z`} fill="url(#lt-fill)" />
            <path d={line} fill="none" stroke="var(--primary)" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
          <circle cx={w} cy={y(last)} r="3.5" fill="var(--primary)" vectorEffect="non-scaling-stroke" />
        </svg>
        {guides.map((g) => (
          <span key={g.ms} className="absolute left-2 -translate-y-full pb-0.5 text-[11px] text-muted-foreground" style={{ top: `${(y(g.ms) / h) * 100}%` }}>{g.label}</span>
        ))}
        <div className="absolute top-2 right-3 text-right">
          <div className="text-[11px] text-muted-foreground">Frametime now</div>
          <div className="text-lg font-semibold tabular-nums">{last.toFixed(2)} <span className="text-xs font-normal text-muted-foreground">ms</span></div>
        </div>
      </div>
    </div>
  )
}
