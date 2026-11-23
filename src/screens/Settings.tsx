import { useEffect, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { inTauri } from '@/lib/api'
import { accents, bases, setSettings, useSettings, type Settings as S } from '@/lib/settings'

export default function Settings() {
  const s = useSettings()
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<Update | null>(null)
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'latest' | 'available' | 'installing' | 'error'>('idle')
  const [updateMessage, setUpdateMessage] = useState('')

  useEffect(() => {
    if (inTauri) void import('@tauri-apps/api/app').then(({ getVersion }) => getVersion()).then(setVersion).catch(() => undefined)
  }, [])
  useEffect(() => () => { void update?.close() }, [update])

  const checkForUpdates = async () => {
    if (!inTauri) return
    setUpdateState('checking')
    setUpdate(null)
    setUpdateMessage('')
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const next = await check()
      setUpdate(next)
      setUpdateState(next ? 'available' : 'latest')
    } catch (e) {
      setUpdateMessage(e instanceof Error ? e.message : String(e))
      setUpdateState('error')
    }
  }

  const installUpdate = async () => {
    if (!update) return
    setUpdateState('installing')
    let downloaded = 0
    let contentLength: number | undefined
    setUpdateMessage('Downloading…')
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') contentLength = event.data.contentLength
        if (event.event === 'Progress') downloaded += event.data.chunkLength
        setUpdateMessage(event.event === 'Finished'
          ? 'Installing update…'
          : contentLength
            ? `Downloading… ${Math.round((downloaded / contentLength) * 100)}%`
            : 'Downloading…')
      })
    } catch (e) {
      setUpdateMessage(e instanceof Error ? e.message : String(e))
      setUpdateState('error')
    }
  }

  const updateDescription = !inTauri
    ? 'Updates work in the desktop app.'
    : updateState === 'checking'
      ? 'Checking for updates…'
      : updateState === 'latest'
        ? "You're on the latest version."
        : updateState === 'available'
          ? `Version ${update?.version} is available.`
          : updateState === 'installing'
            ? updateMessage
            : updateState === 'error'
              ? `Update failed: ${updateMessage}`
              : 'Check for the latest version.'

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Appearance and how graze-tune applies changes. Saved on this PC.</p>
      </header>

      <section className="panel p-5">
        <h2 className="font-medium">Theme</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Background tone in dark mode.</p>
        <div role="radiogroup" aria-label="Theme" className="mt-4 grid grid-cols-3 gap-3">
          {bases.map((b) => (
            <button key={b.id} role="radio" aria-checked={s.base === b.id} onClick={() => setSettings({ base: b.id, mode: s.mode === 'light' ? 'dark' : s.mode })}
              className={cn('group rounded-xl border p-2 text-left transition-all hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-ring',
                s.base === b.id && 'border-primary ring-2 ring-primary/30')}>
              <ThemePreview bg={b.bg} side={b.side} card={b.card} />
              <div className="mt-2 flex items-center justify-between px-1 text-sm">
                {b.label}
                {s.base === b.id && <Check className="size-4 text-primary" />}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">Accent</h3>
            <div role="radiogroup" aria-label="Accent color" className="mt-2.5 flex gap-2">
              {accents.map((a) => (
                <button key={a.id} role="radio" aria-checked={s.accent === a.id} aria-label={a.label} title={a.label} onClick={() => setSettings({ accent: a.id })}
                  className={cn('flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-card transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-ring',
                    s.accent === a.id && 'ring-2 ring-foreground/70')}
                  style={{ background: a.swatch }}>
                  {s.accent === a.id && <Check className="size-4 text-black/70" />}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium">Mode</h3>
            <div role="radiogroup" aria-label="Color mode" className="mt-2.5 inline-flex rounded-lg border bg-background/50 p-0.5">
              {([['dark', Moon, 'Dark'], ['light', Sun, 'Light'], ['system', Monitor, 'System']] as const).map(([m, I, label]) => (
                <button key={m} role="radio" aria-checked={s.mode === m} onClick={() => setSettings({ mode: m })}
                  className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors', s.mode === m ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  <I className="size-3.5" />{label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Row title="Reduce motion" desc="Stops the live graph and animations. Windows' own setting is always respected." className="mt-6 border-t pt-4">
          <Switch checked={s.reduceMotion} onCheckedChange={(v) => setSettings({ reduceMotion: v })} aria-label="Reduce motion" />
        </Row>
      </section>

      <section className="panel divide-y px-5">
        <h2 className="py-4 font-medium">Applying changes</h2>
        <Row title="Create a restore point before each batch" desc="Windows System Restore snapshot. Turning this off leaves only graze-tune's own undo log.">
          <Switch checked={s.restorePoint} onCheckedChange={(v) => setSettings({ restorePoint: v })} aria-label="Create a restore point before each batch" />
        </Row>
        <Row title="Roll back changes that don't measure better" desc="Benchmarks before and after, and undoes a tweak if 1% lows or DPC latency get worse.">
          <Switch checked={s.autoRollback} onCheckedChange={(v) => setSettings({ autoRollback: v })} aria-label="Roll back changes that don't measure better" />
        </Row>
        <Row title="Benchmark length" desc="Longer runs give steadier 1% lows.">
          <Select value={String(s.benchSeconds)} onValueChange={(v) => setSettings({ benchSeconds: Number(v) as S['benchSeconds'] })}>
            <SelectTrigger className="w-32" aria-label="Benchmark length"><SelectValue /></SelectTrigger>
            <SelectContent>{[30, 60, 120].map((n) => <SelectItem key={n} value={String(n)}>{n} seconds</SelectItem>)}</SelectContent>
          </Select>
        </Row>
        <Row title="Start with Windows" desc="Needed for per-game profiles to apply on launch and revert on exit.">
          <Switch checked={s.startWithWindows} onCheckedChange={(v) => setSettings({ startWithWindows: v })} aria-label="Start with Windows" />
        </Row>
      </section>

      <section className="panel divide-y px-5">
        <h2 className="py-4 font-medium">Updates</h2>
        <Row title={`Graze Tune${version ? ` ${version}` : ''}`} desc={updateDescription}>
          <Button
            disabled={!inTauri || updateState === 'checking' || updateState === 'installing'}
            onClick={updateState === 'available' ? installUpdate : checkForUpdates}
          >
            {updateState === 'available' ? 'Update and restart' : updateState === 'checking' ? 'Checking…' : updateState === 'installing' ? 'Updating…' : 'Check for updates'}
          </Button>
        </Row>
      </section>
    </div>
  )
}

function Row({ title, desc, children, className }: { title: string; desc: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-6 py-4', className)}>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-sm text-muted-foreground">{desc}</div>
      </div>
      {children}
    </div>
  )
}

function ThemePreview({ bg, side, card }: { bg: string; side: string; card: string }) {
  return (
    <div aria-hidden className="flex h-20 overflow-hidden rounded-lg border border-white/5" style={{ background: bg }}>
      <div className="w-1/4 space-y-1 p-1.5" style={{ background: side }}>
        <div className="h-1.5 rounded-full bg-primary/80" />
        {[0, 1, 2].map((i) => <div key={i} className="h-1.5 rounded-full bg-white/10" />)}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <div className="h-2 w-1/2 rounded-full bg-white/20" />
        <div className="flex flex-1 gap-1.5">
          <div className="flex-1 rounded" style={{ background: card }} />
          <div className="flex-1 rounded" style={{ background: card }} />
        </div>
      </div>
    </div>
  )
}
