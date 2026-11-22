import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight, FileCog, HardDrive, Cpu, ListChecks, MonitorCog, Power, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { verdictMeta } from '@/data/mock'
import { api, fmtValue, type AuditReport, type Finding, type Target, type Verdict } from '@/lib/api'
import { useSettings } from '@/lib/settings'
import { NumberTicker } from '@/components/ui/number-ticker'

type Kind = Target['kind']
const kindIcon: Record<Kind, typeof Cpu> = { registry: FileCog, bcd: Wrench, service: ListChecks, power: Power, task: HardDrive, nvidia: MonitorCog, device_registry: Cpu }
const kindLabel: Record<Kind, string> = { registry: 'Registry', bcd: 'Boot config', service: 'Service', power: 'Power plan', task: 'Scheduled task', nvidia: 'NVIDIA profile', device_registry: 'Device' }
const order: Verdict[] = ['harmful', 'conflict', 'risk', 'placebo', 'keep']
const rail: Record<Verdict, string> = { harmful: 'bg-bad', conflict: 'bg-warn', risk: 'bg-warn/60', placebo: 'bg-muted-foreground/40', keep: 'bg-good' }

export default function Audit() {
  const [filter, setFilter] = useState<Verdict | 'all'>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const settings = useSettings()
  const [elapsed, setElapsed] = useState(0)
  const elevated = useRef(false)
  const load = useCallback(async (asAdmin = false) => {
    elevated.current = asAdmin
    const t = performance.now()
    const r = await api.audit(asAdmin)
    setElapsed((performance.now() - t) / 1000)
    setReport(r)
  }, [])
  useEffect(() => { load().catch((e) => setError(String(e))) }, [load])
  const findings = (report?.findings ?? []).filter((f) => !hidden.has(f.id))
  const counts = new Map<string, number>()
  for (const f of findings) for (const s of f.sources.length ? f.sources : ['Other / unknown']) counts.set(s, (counts.get(s) ?? 0) + 1)
  const sources = [...counts].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n)
  const resetTo = async (list: Finding[]) => {
    setBusy(true)
    try {
      const b = await api.apply(`Audit: reset ${list.length} item${list.length === 1 ? '' : 's'} to Windows default`, list.map((f) => ({ target: f.target, value: f.windows_default })), settings.restorePoint)
      if (b.state !== 'applied') setError(`Rolled back: ${b.error}`)
      // After Check as admin, drop the reset items instead of rerunning an audit that loses boot settings.
      else if (elevated.current) setReport((r) => r && { ...r, findings: r.findings.filter((f) => !list.includes(f)) })
      if (b.state !== 'applied' || !elevated.current) await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const list = findings.filter((f) => filter === 'all' || f.verdict === filter).sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict))
  const harmful = findings.filter((f) => f.verdict === 'harmful')

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every setting on this PC that differs from a clean Windows 11 install, matched against known optimizer signatures. Nothing changes until you choose an action.
          </p>
        </div>
        <Button disabled={busy || !harmful.length} onClick={() => resetTo(harmful)}>
          Reset {harmful.length} harmful to default
        </Button>
      </header>

      {error && <div className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-2.5 text-sm text-bad">{error}</div>}
      {!!report?.errors.length && (
        <div className="flex items-center gap-3 rounded-lg border border-warn/30 bg-warn/5 px-4 py-2.5 text-sm text-warn">
          <span className="min-w-0 flex-1">{report.errors.length} setting{report.errors.length === 1 ? '' : 's'} could not be read: {report.errors.slice(0, 3).join('; ')}</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { setError(null); load(true).catch((e) => setError(String(e))) }}>Check as admin</Button>
        </div>
      )}

      <section className="panel grid grid-cols-[auto_1fr] gap-8 p-5">
        <div className="pr-8 border-r">
          <div className="text-xs text-muted-foreground">Settings checked</div>
          <NumberTicker value={report?.checked ?? 0} className="text-[32px] leading-tight font-semibold tracking-tight" />
          <div className="text-xs text-muted-foreground">in {elapsed.toFixed(1)} s, read only</div>
        </div>
        <div>
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {order.map((v) => (
              <motion.div key={v} initial={{ flexGrow: 0 }} animate={{ flexGrow: findings.filter((f) => f.verdict === v).length }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} className={cn('basis-0', rail[v])} />
            ))}
          </div>
          <div className="mt-4 text-xs text-muted-foreground">Likely source</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5 rounded-md border bg-background/50 px-2 py-1 text-xs">
                {s.name}<span className="tabular-nums text-muted-foreground">{s.n}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-1.5">
        {(['all', ...order] as const).map((v) => {
          const n = v === 'all' ? findings.length : findings.filter((f) => f.verdict === v).length
          return (
            <button key={v} onClick={() => setFilter(v)} className={cn('relative h-8 rounded-md px-3 text-sm transition-colors', filter === v ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {filter === v && <motion.span layoutId="audit-filter" transition={{ type: 'spring', stiffness: 500, damping: 40 }} className="absolute inset-0 rounded-md border border-foreground/15 bg-accent" />}
              <span className="relative">{v === 'all' ? 'All' : verdictMeta[v].label} <span className="ml-1 tabular-nums text-muted-foreground">{n}</span></span>
            </button>
          )
        })}
      </div>

      <div className="panel divide-y overflow-hidden">
        {list.map((f) => {
          const Icon = kindIcon[f.target.kind]
          const isOpen = open === f.id
          const done = f.ours
          return (
            <div key={f.id}>
              <button onClick={() => setOpen(isOpen ? null : f.id)} className="relative flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-accent/40">
                <span className={cn('absolute top-3 bottom-3 left-0 w-0.5 rounded-full', done ? 'bg-good' : rail[f.verdict])} />
                <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate text-sm font-medium', done && 'text-muted-foreground line-through')}>{f.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{kindLabel[f.target.kind]}{f.ours ? ', set by graze-tune' : f.sources.length ? `, likely ${f.sources.join(' or ')}` : ''}</div>
                </div>
                {done ? (
                  <span className="text-xs font-medium text-good">Set by graze-tune</span>
                ) : (
                  <span className={cn('rounded border px-2 py-0.5 text-xs font-medium', verdictMeta[f.verdict].tone)}>{verdictMeta[f.verdict].label}</span>
                )}
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                    <div className="grid grid-cols-[1fr_auto] gap-6 border-t bg-background/40 px-5 py-4 pl-[68px]">
                      <div className="space-y-3">
                        <p className="max-w-[68ch] text-sm leading-relaxed">{f.why}</p>
                        <code className="block break-all rounded-md border bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">{f.location}</code>
                        <div className="flex gap-8 text-sm">
                          <div><div className="text-xs text-muted-foreground">On this PC</div><div className="font-mono">{fmtValue(f.current)}</div></div>
                          <div><div className="text-xs text-muted-foreground">Windows default</div><div className="font-mono">{fmtValue(f.windows_default)}</div></div>
                        </div>
                      </div>
                      <div className="flex w-44 flex-col gap-2">
                        <Button size="sm" variant={f.verdict === 'harmful' ? 'default' : 'outline'} disabled={busy} onClick={() => resetTo([f])}>Reset to default</Button>
                        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setHidden(new Set([...hidden, f.id]))}>Keep as is</Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}
