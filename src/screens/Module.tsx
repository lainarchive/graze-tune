import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RotateCw, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { api, catalog, fmtTarget, fmtValue, isOn, readCurrent, type Tweak, type Value } from '@/lib/api'
import { useSettings } from '@/lib/settings'
import { moduleNav } from '@/data/nav'

const riskMeta = {
  safe: { label: 'Safe', tone: 'text-muted-foreground' },
  caution: { label: 'Check after applying', tone: 'text-warn' },
  'opt-in': { label: 'Security tradeoff', tone: 'text-bad' },
}

export default function Module({ id }: { id: string }) {
  const entry = moduleNav.flatMap((g) => g.items).find((m) => m.id === id)
  const Icon = entry?.icon
  const settings = useSettings()
  const tweaks = useMemo(() => catalog.tweak.filter((t) => t.module === id), [id])
  const [current, setCurrent] = useState<Record<string, (Value | null)[]>>({})
  const [want, setWant] = useState<Record<string, boolean>>({})
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [optIn, setOptIn] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setCurrent(await readCurrent(tweaks))
    setWant({})
  }, [tweaks])

  useEffect(() => { load() }, [load])

  const pending = tweaks.filter((t) => t.id in want && want[t.id] !== isOn(t, current[t.id]))
  const needsOptIn = pending.some((t) => t.risk === 'opt-in' && want[t.id])
  const applied = tweaks.filter((t) => isOn(t, current[t.id])).length
  const unreadable = tweaks.filter((t) => current[t.id]?.some((v) => v === null)).length

  const applyAll = async () => {
    setBusy(true)
    try {
      const changes = pending.flatMap((t) => t.changes.map((c) => ({ target: c.target, value: want[t.id] ? c.value : c.default, tweak: t.id })))
      const b = await api.apply(id, changes, settings.restorePoint)
      setResult(b.state === 'applied' ? `${b.entries.length} value${b.entries.length === 1 ? '' : 's'} written${pending.some((t) => t.restart) ? ', restart to finish' : ''}` : `Rolled back: ${b.error}`)
      setReview(false)
      await load()
    } catch (e) {
      setResult(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex gap-4">
          {Icon && (
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-gradient-to-b from-primary/20 to-primary/5 text-primary">
              <Icon className="size-6" />
            </div>
          )}
          <div>
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{entry?.label ?? id}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{entry?.hint}. Each switch shows the current value on this PC and what it changes to.</p>
          </div>
        </div>
        <Button disabled={!pending.length} onClick={() => { setOptIn(false); setReview(true) }}>
          {pending.length ? `Review ${pending.length} change${pending.length > 1 ? 's' : ''}` : 'No changes'}
        </Button>
      </header>

      <div className="grid grid-cols-4 gap-5">
        {[
          ['Applied', `${applied} of ${tweaks.length}`],
          ['Pending', `${pending.length} change${pending.length === 1 ? '' : 's'}`],
          ['Not on this PC', unreadable ? `${unreadable} setting${unreadable === 1 ? '' : 's'}` : 'None'],
          ['Last result', result ?? 'Nothing applied yet'],
        ].map(([k, v]) => (
          <div key={k} className="panel px-4 py-3">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="mt-0.5 truncate text-[15px] font-medium tabular-nums" title={v}>{v}</div>
          </div>
        ))}
      </div>

      <div className="panel divide-y">
        {tweaks.map((t) => {
          const on = isOn(t, current[t.id])
          const checked = want[t.id] ?? on
          return <Row key={t.id} t={t} cur={current[t.id]} on={checked} changed={checked !== on} onToggle={() => setWant({ ...want, [t.id]: !checked })} />
        })}
      </div>

      <Sheet open={review} onOpenChange={setReview}>
        <SheetContent className="w-[480px] sm:max-w-[480px]">
          <SheetHeader>
            <SheetTitle>Apply {pending.length} change{pending.length > 1 ? 's' : ''}</SheetTitle>
            <SheetDescription>
              {settings.restorePoint ? 'A restore point is created first. ' : ''}Old values go to the change log so each batch can be reverted.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 overflow-y-auto px-4">
            {pending.map((t) => (
              <div key={t.id} className="rounded-lg border">
                <div className="border-b px-3 py-2 text-sm font-medium">{want[t.id] ? t.title : `Undo: ${t.title}`}</div>
                {t.changes.map((c, i) => (
                  <div key={i} className="space-y-1 px-3 py-2.5 font-mono text-xs">
                    <div className="break-all text-muted-foreground">{fmtTarget(c.target)}</div>
                    <div className="text-bad">− {fmtValue(current[t.id]?.[i])}</div>
                    <div className="text-good">+ {fmtValue(want[t.id] ? c.value : c.default)}</div>
                  </div>
                ))}
              </div>
            ))}
            {needsOptIn && (
              <label className="flex items-start gap-2.5 rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm">
                <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="mt-0.5 accent-[var(--primary)]" />
                <span>I understand this lowers Windows security protections and some anti-cheats may refuse to run.</span>
              </label>
            )}
            <p className="text-xs text-muted-foreground">Run a benchmark before and after on the Benchmarks page to see whether this helps on your PC.</p>
          </div>
          <SheetFooter>
            <Button disabled={busy || (needsOptIn && !optIn)} onClick={applyAll}>{busy ? 'Applying…' : 'Apply'}</Button>
            <Button variant="ghost" onClick={() => setReview(false)}>Cancel</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Row({ t, cur, on, changed, onToggle }: { t: Tweak; cur?: (Value | null)[]; on: boolean; changed: boolean; onToggle: () => void }) {
  const r = riskMeta[t.risk]
  // Boot settings need admin to read; the elevated apply reads them before writing.
  const unreadable = cur?.every((v) => v === null) && !t.changes.every((c) => c.target.kind === 'bcd')
  return (
    <div className={cn('relative flex gap-5 px-5 py-4 transition-colors', on && 'bg-primary/[0.03]', unreadable && 'opacity-60')}>
      {on && <span className="absolute top-4 bottom-4 left-0 w-0.5 rounded-full bg-primary" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t.title}</span>
          {t.risk !== 'safe' && (
            <span className={cn('inline-flex items-center gap-1 text-xs', r.tone)}>
              {t.risk === 'opt-in' ? <ShieldAlert className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
              {r.label}
            </span>
          )}
          {t.restart && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><RotateCw className="size-3" />Restart</span>}
        </div>
        <p className="mt-0.5 max-w-[72ch] text-sm text-muted-foreground">{t.why}</p>
        {t.changes.map((c, i) => (
          <div key={i} className="mt-2 flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground">
            <span className="truncate">{fmtTarget(c.target)}</span>
            <span className="shrink-0">{fmtValue(cur?.[i])} → {fmtValue(c.value)}</span>
          </div>
        ))}
      </div>
      <div className="flex w-32 shrink-0 flex-col items-end justify-between gap-2">
        <Switch checked={on} disabled={unreadable} onCheckedChange={onToggle} aria-label={t.title} />
        <span className={cn('text-xs', changed ? 'text-warn' : 'text-muted-foreground')}>{unreadable ? 'Not on this PC' : changed ? 'Pending' : on ? 'Applied' : 'Off'}</span>
      </div>
    </div>
  )
}
