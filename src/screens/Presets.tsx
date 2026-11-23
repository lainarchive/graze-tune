import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RotateCw, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { api, catalog, fmtTarget, fmtValue, isOn, readCurrent, type Preset, type Tweak, type Value } from '@/lib/api'
import { useSettings } from '@/lib/settings'

const riskMeta = {
  safe: { label: 'Safe', tone: 'text-muted-foreground' },
  caution: { label: 'Check after applying', tone: 'text-warn' },
  'opt-in': { label: 'Security tradeoff', tone: 'text-bad' },
}

const unreadable = (t: Tweak, current?: (Value | null)[]) =>
  !!current?.every((v) => v === null) && !t.changes.every((c) => c.target.kind === 'bcd')

export default function Presets() {
  const settings = useSettings()
  const tweaks = useMemo(
    () => catalog.tweak.filter((t) => catalog.preset.some((p) => p.tweaks.includes(t.id))),
    [],
  )
  const tweaksById = useMemo(() => new Map(catalog.tweak.map((t) => [t.id, t])), [])
  const [current, setCurrent] = useState<Record<string, (Value | null)[]>>({})
  const [selected, setSelected] = useState<Preset | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setCurrent(await readCurrent(tweaks))
  }, [tweaks])

  useEffect(() => { readCurrent(tweaks).then(setCurrent) }, [tweaks])

  const resolve = (preset: Preset) => preset.tweaks.flatMap((id) => {
    const tweak = tweaksById.get(id)
    return tweak ? [tweak] : []
  })
  const selectedTweaks = selected ? resolve(selected) : []
  const toChange = selectedTweaks.filter((t) => !isOn(t, current[t.id]) && !unreadable(t, current[t.id]))
  const notOnThisPc = selectedTweaks.filter((t) => unreadable(t, current[t.id]))

  const applyPreset = async () => {
    if (!selected) return
    setBusy(true)
    try {
      const changes = toChange.flatMap((t) => t.changes.map((c) => ({ target: c.target, value: c.value, tweak: t.id })))
      const batch = await api.apply(`Preset: ${selected.title}`, changes, settings.restorePoint)
      setResult(batch.state === 'applied'
        ? `${batch.entries.length} value${batch.entries.length === 1 ? '' : 's'} written${toChange.some((t) => t.restart) ? ', restart to finish' : ''}`
        : `Rolled back: ${batch.error}`)
      setSelected(null)
      await load()
    } catch (e) {
      setResult(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Presets</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Apply a tested group of tweaks as one undoable batch. Settings already on or unavailable on this PC are skipped.</p>
      </header>

      {result && <div role="status" className="panel px-4 py-3 text-sm">{result}</div>}

      <div className="grid grid-cols-2 gap-5">
        {catalog.preset.map((preset) => {
          const items = resolve(preset)
          const applied = items.filter((t) => isOn(t, current[t.id])).length
          const pending = items.filter((t) => !isOn(t, current[t.id]) && !unreadable(t, current[t.id])).length
          const caution = items.filter((t) => t.risk === 'caution').length
          const restart = items.filter((t) => t.restart).length
          const unavailable = items.filter((t) => unreadable(t, current[t.id])).length
          const ready = tweaks.every((t) => current[t.id] !== undefined)
          return (
            <section key={preset.id} className="panel flex flex-col overflow-hidden">
              <div className="px-5 pt-5">
                <h2 className="text-lg font-semibold tracking-tight">{preset.title}</h2>
                <p className="mt-1 min-h-10 text-sm text-muted-foreground">{preset.summary}</p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-y px-5 py-4 text-xs">
                <Metric label="Applied" value={`${applied} of ${items.length}`} />
                <Metric label="To change" value={String(pending)} />
                <Metric label="Check after applying" value={String(caution)} />
                <Metric label="Restart needed" value={String(restart)} />
                <Metric label="Not on this PC" value={String(unavailable)} />
              </div>
              <div className="p-3">
                <Button className="w-full justify-between" disabled={!ready || !pending} onClick={() => { setResult(null); setSelected(preset) }}>
                  {pending ? `Review ${pending} change${pending === 1 ? '' : 's'}` : 'All applied'}
                  <span aria-hidden>→</span>
                </Button>
              </div>
            </section>
          )
        })}
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px]">
          <SheetHeader>
            <SheetTitle>{selected ? `Review ${toChange.length} change${toChange.length === 1 ? '' : 's'}` : 'Review preset'}</SheetTitle>
            <SheetDescription>
              This preset is applied as one batch and can be reverted from the Changes page. {settings.restorePoint ? 'A restore point is made first.' : ''}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 overflow-y-auto px-4">
            {selected && <h3 className="text-sm font-medium">{selected.title}</h3>}
            {toChange.map((t) => (
              <div key={t.id} className="rounded-lg border">
                <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                  <span className="text-sm font-medium">{t.title}</span>
                  {t.risk !== 'safe' && (
                    <span className={cn('inline-flex items-center gap-1 text-xs', riskMeta[t.risk].tone)}>
                      {t.risk === 'opt-in' ? <ShieldAlert className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                      {riskMeta[t.risk].label}
                    </span>
                  )}
                  {t.restart && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><RotateCw className="size-3" />Restart</span>}
                </div>
                {t.changes.map((c, i) => (
                  <div key={i} className="space-y-1 px-3 py-2.5 font-mono text-xs">
                    <div className="break-all text-muted-foreground">{fmtTarget(c.target)}</div>
                    <div className="text-bad">− {fmtValue(current[t.id]?.[i])}</div>
                    <div className="text-good">+ {fmtValue(c.value)}</div>
                  </div>
                ))}
              </div>
            ))}
            {!!notOnThisPc.length && (
              <details className="rounded-lg border px-3 py-2 text-sm">
                <summary className="cursor-pointer text-muted-foreground">{notOnThisPc.length} not on this PC</summary>
                <ul className="mt-2 space-y-1 pl-4 text-muted-foreground">
                  {notOnThisPc.map((t) => <li key={t.id}>{t.title}</li>)}
                </ul>
              </details>
            )}
          </div>
          <SheetFooter>
            <Button disabled={busy || !toChange.length} onClick={applyPreset}>{busy ? 'Applying…' : 'Apply preset'}</Button>
            <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums">{value}</div>
    </div>
  )
}
