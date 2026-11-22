import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowUpRight, Cpu, Gpu, HardDrive, MemoryStick, Network, Power } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NumberTicker } from '@/components/ui/number-ticker'
import { LiveTrace } from '@/components/viz/LiveTrace'
import { ScoreRing, Spark } from '@/components/viz/ScoreRing'
import { cn } from '@/lib/utils'
import { after, before, health, latencyBudget, net, nextSteps, stats, verdictMeta } from '@/data/mock'
import { api, type SystemInfo, type Verdict } from '@/lib/api'

const verdictColor: Record<Verdict, string> = { harmful: 'var(--bad)', conflict: 'var(--warn)', risk: 'color-mix(in oklab, var(--warn) 60%, var(--muted))', placebo: 'var(--muted-foreground)', keep: 'var(--good)' }

export default function Overview({ go }: { go: (s: string) => void }) {
  const [run, setRun] = useState<'before' | 'after'>('after')
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [findings, setFindings] = useState<{ verdict: Verdict }[]>([])
  useEffect(() => {
    api.systemInfo().then(setSys)
    api.audit().then((r) => setFindings(r.findings))
  }, [])
  const data = run === 'after' ? after : before
  const s = stats(data)
  const b = stats(before)
  const cmp = run === 'after'
  const spark = (d: { ms: number }[], f: (v: number) => number) => d.filter((_, i) => i % 8 === 0).map((x) => f(x.ms))

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Good evening</h1>
          <p className="mt-1 text-sm text-muted-foreground">Last session: Valorant, 4 min 12 s at 1080p. Your CPU is the bottleneck in 87% of frames.</p>
        </div>
        <div className="flex gap-2">
          <Segmented value={run} onChange={setRun} options={[['before', 'Baseline'], ['after', 'Now']]} />
          <Button onClick={() => go('benchmarks')}>Run benchmark</Button>
        </div>
      </header>

      <div className="grid grid-cols-[300px_1fr] gap-5">
        <section className="panel flex flex-col items-center p-5">
          <ScoreRing value={health.score} label="Latency health" />
          <div className="-mt-3 w-full space-y-2.5">
            {health.parts.map((p, i) => (
              <div key={p.label}>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">{p.label}</span><span className="tabular-nums">{p.value}</span></div>
                <div className="mt-1 h-1 rounded-full bg-muted">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${p.value}%` }} transition={{ duration: 0.9, delay: 0.25 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                    className={cn('h-full rounded-full', p.value >= 75 ? 'bg-good' : p.value >= 50 ? 'bg-warn' : 'bg-bad')} />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4">
            <div>
              <h2 className="font-medium">Live frametime</h2>
              <p className="text-xs text-muted-foreground">PresentMon, VALORANT-Win64-Shipping.exe</p>
            </div>
            <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">RTX 3050, 71% busy</span>
          </div>
          <LiveTrace className="mt-2 min-h-56 flex-1" />
        </section>
      </div>

      <div className="grid grid-cols-4 gap-5">
        <Metric label="Average" value={s.fps} unit="fps" delta={cmp ? s.fps - b.fps : undefined} spark={spark(data, (v) => 1000 / v)} />
        <Metric label="1% low" value={s.low1} unit="fps" delta={cmp ? s.low1 - b.low1 : undefined} spark={spark(data, (v) => -v)} />
        <Metric label="Frametime p99" value={s.p99} decimals={1} unit="ms" delta={cmp ? s.p99 - b.p99 : undefined} lowerIsBetter spark={spark(data, (v) => v)} />
        <Metric label="Jitter" value={net[run].jitter} decimals={1} unit="ms" sub={`Ping ${net[run].ping} ms`} delta={cmp ? net.after.jitter - net.before.jitter : undefined} lowerIsBetter spark={[9, 8, 11, 7, 9, 6, 4, 3, 2.4, 2.2, 2.1]} />
      </div>

      <section className="panel p-5">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="font-medium">Where your input latency goes</h2>
            <p className="text-xs text-muted-foreground">Estimated time from mouse click to the frame on screen</p>
          </div>
          <span className="text-3xl font-semibold tracking-tight tabular-nums">
            <NumberTicker value={latencyBudget.reduce((a, x) => a + x.ms, 0)} decimalPlaces={1} /><span className="ml-1 text-sm font-normal text-muted-foreground">ms</span>
          </span>
        </div>
        <div className="mt-4 flex h-11 gap-1">
          {latencyBudget.map((x, i) => (
            <motion.div key={x.stage} initial={{ flexGrow: 0.001 }} animate={{ flexGrow: x.ms }} transition={{ duration: 0.8, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              className={cn('group relative flex basis-0 items-center overflow-hidden rounded-md px-2.5 text-xs font-semibold tabular-nums',
                i === 1 ? 'bg-[repeating-linear-gradient(135deg,var(--primary)_0_8px,color-mix(in_oklab,var(--primary),black_12%)_8px_16px)] text-primary-foreground' : 'bg-raised text-muted-foreground ring-1 ring-border ring-inset')}>
              {x.ms.toFixed(1)}
            </motion.div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-5 gap-4 text-xs">
          {latencyBudget.map((x, i) => (
            <div key={x.stage}>
              <div className={cn('font-medium', i === 1 && 'text-primary')}>{x.stage}</div>
              <div className="text-muted-foreground">{x.note}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-[1.25fr_1fr_1fr] gap-5">
        <section className="panel p-5">
          <h2 className="font-medium">Do these next</h2>
          <p className="text-xs text-muted-foreground">Ranked by measured gain on similar 4-thread systems</p>
          <div className="mt-3 space-y-2">
            {nextSteps.map((n, i) => (
              <button key={n.title} onClick={() => go(n.go)} className="group flex w-full items-center gap-3 rounded-lg border bg-background/40 px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{n.detail}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-good">{n.gain}</span>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
              </button>
            ))}
          </div>
        </section>
        <section className="panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Audit</h2>
            <button onClick={() => go('audit')} className="text-xs text-primary hover:underline">Review all</button>
          </div>
          <div className="mt-3 flex items-center gap-5">
            <Donut findings={findings} />
            <ul className="space-y-1.5 text-xs">
              {(Object.keys(verdictMeta) as Verdict[]).map((v) => (
                <li key={v} className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: verdictColor[v] }} />
                  <span className="w-24 text-muted-foreground">{verdictMeta[v].label}</span>
                  <span className="tabular-nums">{findings.filter((f) => f.verdict === v).length}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="panel p-5">
          <h2 className="font-medium">This PC</h2>
          <ul className="mt-3 space-y-2.5 text-sm">
            {([[Cpu, sys ? `${sys.cpu}, ${sys.threads} threads` : '…'], ...(sys?.gpus ?? []).map((g) => [Gpu, g] as const), [MemoryStick, sys ? `${Math.round(sys.ram_bytes / 2 ** 30)} GB RAM` : '…'], [HardDrive, sys?.board ? `${sys.board}, BIOS ${sys.bios}` : '…'], [Network, sys?.os ?? '…'], [Power, sys?.power_plan || '…']] as const).map(([I, v]) => (
              <li key={v} className="flex items-center gap-2.5"><I className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{v}</span></li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

function Donut({ findings }: { findings: { verdict: Verdict }[] }) {
  const r = 34
  const c = 2 * Math.PI * r
  const order: Verdict[] = ['harmful', 'conflict', 'risk', 'placebo', 'keep']
  let off = 0
  return (
    <div className="relative size-24 shrink-0">
      <svg viewBox="0 0 84 84" className="size-24 -rotate-90">
        {order.map((v, i) => {
          const n = findings.filter((f) => f.verdict === v).length
          const len = (n / (findings.length || 1)) * c
          const el = (
            <motion.circle key={v} cx="42" cy="42" r={r} fill="none" stroke={verdictColor[v]} strokeWidth="9"
              initial={{ strokeDasharray: `0 ${c}` }} animate={{ strokeDasharray: `${Math.max(len - 2, 0)} ${c}` }}
              transition={{ duration: 0.6, delay: 0.2 + i * 0.07 }} strokeDashoffset={-off} />
          )
          off += len
          return el
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tabular-nums">{findings.length}</span>
        <span className="text-[10px] text-muted-foreground">findings</span>
      </div>
    </div>
  )
}

function Metric({ label, value, unit, decimals = 0, delta, lowerIsBetter, spark, sub }: { label: string; value: number; unit: string; decimals?: number; delta?: number; lowerIsBetter?: boolean; spark: number[]; sub?: string }) {
  const good = delta !== undefined && (lowerIsBetter ? delta < 0 : delta > 0)
  return (
    <div className="panel relative overflow-hidden px-5 py-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        {sub && <span className="text-xs">{sub}</span>}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <NumberTicker key={value} value={value} decimalPlaces={decimals} className="text-[32px] leading-none font-semibold tracking-tight" />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
      <div className={cn('mt-2 h-4 text-xs font-medium tabular-nums', good ? 'text-good' : 'text-bad')}>
        {delta !== undefined ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)} ${unit} vs baseline` : <span className="text-muted-foreground">Baseline run</span>}
      </div>
      <Spark values={spark} className={cn('absolute right-4 bottom-4 h-8 w-24 opacity-70', good ? 'text-good' : 'text-muted-foreground')} />
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="relative inline-flex h-9 rounded-md border bg-muted p-0.5">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} className={cn('relative rounded px-3 text-sm transition-colors', value === v ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {value === v && <motion.span layoutId="seg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} className="absolute inset-0 rounded bg-background shadow-sm" />}
          <span className="relative">{l}</span>
        </button>
      ))}
    </div>
  )
}
