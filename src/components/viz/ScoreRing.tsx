import { motion } from 'motion/react'
import { NumberTicker } from '@/components/ui/number-ticker'

export function ScoreRing({ value, size = 168, label }: { value: number; size?: number; label: string }) {
  const stroke = 12
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const arc = 0.75
  const tone = value >= 75 ? 'var(--good)' : value >= 50 ? 'var(--warn)' : 'var(--bad)'
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="rotate-[135deg]">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * arc} ${c}`} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round"
          initial={{ strokeDasharray: `0 ${c}` }}
          animate={{ strokeDasharray: `${c * arc * (value / 100)} ${c}` }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
        <NumberTicker value={value} className="text-5xl font-semibold tracking-tight" />
        <span className="mt-0.5 text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}

export function Spark({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(...values)
  const min = Math.min(...values)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 26}`).join('')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
