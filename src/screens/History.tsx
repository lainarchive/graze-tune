import { useCallback, useEffect, useState } from 'react'
import { RotateCcw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api, fmtTarget, fmtValue, type Batch } from '@/lib/api'

const stateMeta: Record<Batch['state'], { label: string; tone: string }> = {
  applied: { label: 'Applied', tone: 'text-good' },
  pending: { label: 'Interrupted', tone: 'text-warn' },
  failed: { label: 'Failed, rolled back', tone: 'text-bad' },
  reverted: { label: 'Reverted', tone: 'text-muted-foreground' },
}

const when = (s: number) => new Date(s * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function History() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const load = useCallback(() => api.history().then((b) => setBatches([...b].reverse())), [])
  useEffect(() => { load() }, [load])

  const run = async (p: Promise<string[]>) => {
    const failed = await p.catch((e) => [String(e)])
    setMsg(failed.length ? `Some values could not be restored: ${failed.join('; ')}` : null)
    await load()
  }
  const live = batches.filter((b) => b.state === 'applied' || b.state === 'pending')

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Changes</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Every value graze-tune has written, with the value it replaced. Revert one batch or everything at once.</p>
        </div>
        <Button variant="outline" className="gap-2" disabled={!live.length} onClick={() => run(api.revertAll())}><RotateCcw className="size-4" />Revert everything</Button>
      </header>
      {msg && <div className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-2.5 text-sm text-bad">{msg}</div>}
      {!batches.length && <div className="panel px-5 py-10 text-center text-sm text-muted-foreground">Nothing changed yet. Applied tweaks and audit resets show up here.</div>}
      <ol className="relative space-y-3 border-l pl-6">
        {batches.map((b) => (
          <li key={b.id} className="relative">
            <span className={cn('absolute top-5 -left-[29px] size-2.5 rounded-full border-2 border-background', b.state === 'applied' ? 'bg-primary' : 'bg-muted-foreground/40')} />
            <div className="panel">
              <div className="flex items-center gap-5 px-5 py-4">
                <div className="w-28 shrink-0 text-sm text-muted-foreground">{when(b.at)}</div>
                <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === b.id ? null : b.id)}>
                  <div className="text-sm font-medium">{b.label}</div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{b.entries.length} value{b.entries.length === 1 ? '' : 's'} written</span>
                    {b.restore_point !== null && <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5" />Restore point</span>}
                    {b.error && <span className="truncate text-bad">{b.error}</span>}
                  </div>
                </button>
                <div className={cn('text-sm font-medium', stateMeta[b.state].tone)}>{stateMeta[b.state].label}</div>
                <Button size="sm" variant="ghost" disabled={b.state === 'reverted' || b.state === 'failed' || !b.entries.length} className="text-muted-foreground" onClick={() => run(api.revert(b.id))}>Revert</Button>
              </div>
              {open === b.id && (
                <div className="space-y-2 border-t px-5 py-3 font-mono text-xs">
                  {b.entries.map((e, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{fmtTarget(e.target)}</span>
                      <span className="shrink-0"><span className="text-bad">{fmtValue(e.old)}</span> → <span className="text-good">{fmtValue(e.new)}</span></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
