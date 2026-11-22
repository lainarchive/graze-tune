import { useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ChevronDown, ChevronRight, Minus, Moon, Search, Settings2, Square, Sun, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CommandPalette } from '@/components/CommandPalette'
import { inTauri } from '@/lib/api'
import { cn } from '@/lib/utils'
import { findings, health } from '@/data/mock'
import { moduleNav, primaryNav, type ModuleStatus, type NavEntry } from '@/data/nav'
import Overview from '@/screens/Overview'
import Audit from '@/screens/Audit'
import Module from '@/screens/Module'
import NvidiaProfile from '@/screens/NvidiaProfile'
import { BiosGuide, GameProfiles, Thermals } from '@/screens/Guides'
import Benchmarks from '@/screens/Benchmarks'
import History from '@/screens/History'
import Settings from '@/screens/Settings'
import { isDark, setSettings, useSettings } from '@/lib/settings'

const openFindings = findings.filter((f) => f.verdict !== 'keep').length

function titleOf(screen: string) {
  if (screen.startsWith('module:')) {
    const id = screen.slice(7)
    const g = moduleNav.find((g) => g.items.some((m) => m.id === id))
    return [g?.group ?? 'Modules', id]
  }
  if (screen === 'settings') return ['Settings']
  return [primaryNav.find((p) => p.id === screen)?.label ?? '']
}

export default function App() {
  const [screen, setScreen] = useState('overview')
  const settings = useSettings()
  const dark = isDark(settings)
  const [palette, setPalette] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ System: true })

  const go = (s: string) => {
    const g = moduleNav.find((g) => g.items.some((m) => `module:${m.id}` === s))
    if (g) setOpenGroups((o) => ({ ...o, [g.group]: true }))
    setScreen(s)
  }

  const toggleTheme = () => setSettings({ mode: dark ? 'light' : 'dark' })

  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? 'always' : 'user'}>
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TitleBar crumbs={titleOf(screen)} onSearch={() => setPalette(true)} />
        <div className="flex min-h-0 flex-1">
          <aside className="relative flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_50%_at_0%_0%,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_70%)]" />
            <div aria-hidden className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_60%)] bg-[radial-gradient(color-mix(in_oklab,var(--foreground)_7%,transparent)_1px,transparent_1px)] [background-size:14px_14px]" />
            <nav className="relative flex-1 overflow-y-auto px-2 pt-2 pb-4">
              {primaryNav.map((p) => (
                <NavItem key={p.id} entry={p} active={screen === p.id} onClick={() => go(p.id)}
                  badge={p.id === 'audit' ? openFindings : undefined} />
              ))}
              {moduleNav.map((g) => {
                const active = g.items.some((m) => screen === `module:${m.id}`)
                const open = active || !!openGroups[g.group]
                const worst = (['issue', 'pending', 'tuned'] as const).find((s) => g.items.some((m) => m.status === s))
                return (
                  <div key={g.group} className="mt-3">
                    <button onClick={() => !active && setOpenGroups((o) => ({ ...o, [g.group]: !open }))} aria-expanded={open}
                      className="flex w-full items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-muted-foreground/80 transition-colors hover:text-foreground">
                      <ChevronDown className={cn('size-3 transition-transform', !open && '-rotate-90')} />
                      <span className="flex-1 text-left">{g.group}</span>
                      {!open && worst && <StatusDot status={worst} />}
                      <span className="tabular-nums text-muted-foreground/60">{g.items.length}</span>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                          {g.items.map((m) => (
                            <NavItem key={m.id} entry={m} active={screen === `module:${m.id}`} onClick={() => go(`module:${m.id}`)} />
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </nav>
            <div className="relative border-t border-sidebar-border p-2">
              <div className="mb-2 flex items-center gap-3 rounded-lg bg-sidebar-accent/60 px-3 py-2.5">
                <div className="relative size-9 shrink-0">
                  <svg viewBox="0 0 36 36" className="size-9 -rotate-90">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="var(--muted)" strokeWidth="4" />
                    <circle cx="18" cy="18" r="15" fill="none" stroke="var(--warn)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(health.score / 100) * 94.2} 94.2`} />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums">{health.score}</span>
                </div>
                <div className="min-w-0 text-xs">
                  <div className="font-medium">Latency health</div>
                  <div className="text-muted-foreground">{openFindings} items need a look</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="flex-1 justify-start gap-2 text-muted-foreground">
                  <Undo2 className="size-4" /> Revert everything
                </Button>
                <Button variant="ghost" size="icon" onClick={() => go('settings')} aria-label="Settings" className={cn(screen === 'settings' && 'bg-sidebar-accent text-primary')}>
                  <Settings2 className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
                  {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </Button>
              </div>
            </div>
          </aside>
          <main className="relative flex-1 overflow-y-auto">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_30%_0%,color-mix(in_oklab,var(--primary)_9%,transparent),transparent)]" />
            <AnimatePresence mode="wait">
              <motion.div
                key={screen}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="relative mx-auto max-w-[1180px] px-8 py-7"
              >
                {screen === 'overview' && <Overview go={go} />}
                {screen === 'audit' && <Audit />}
                {screen === 'benchmarks' && <Benchmarks />}
                {screen === 'history' && <History />}
                {screen === 'settings' && <Settings />}
                {screen.startsWith('module:') && (() => {
                  const id = screen.slice(7)
                  if (id === 'NVIDIA profile') return <NvidiaProfile />
                  if (id === 'BIOS guide') return <BiosGuide />
                  if (id === 'Thermals') return <Thermals />
                  if (id === 'Game profiles') return <GameProfiles go={go} />
                  return <Module key={id} id={id} />
                })()}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        <CommandPalette open={palette} setOpen={setPalette} go={go} />
      </div>
    </TooltipProvider>
    </MotionConfig>
  )
}

async function windowAction(i: number) {
  if (!inTauri) return
  const w = (await import('@tauri-apps/api/window')).getCurrentWindow()
  await [() => w.minimize(), () => w.toggleMaximize(), () => w.close()][i]()
}

function TitleBar({ crumbs, onSearch }: { crumbs: string[]; onSearch: () => void }) {
  return (
    <header data-tauri-drag-region className="relative flex h-11 shrink-0 items-center border-b border-sidebar-border bg-sidebar pl-4">
      <div className="flex w-56 items-center gap-2.5">
        <Logo />
        <span className="text-sm font-semibold tracking-tight">graze-tune</span>
      </div>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {crumbs.map((c, i) => (
          <span key={c} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3.5" />}
            <span className={cn(i === crumbs.length - 1 && 'text-foreground')}>{c}</span>
          </span>
        ))}
      </div>
      <button onClick={onSearch} className="absolute left-1/2 flex h-7 w-80 -translate-x-1/2 items-center gap-2 rounded-md border bg-background/60 px-2.5 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground">
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Search tweaks and settings</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-4 pr-1">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-good [animation:pulse-dot_2s_ease-in-out_infinite]" />
          {inTauri ? 'Running as administrator' : 'Browser preview, sample data'}
        </span>
        <div className="flex">
          {[Minus, Square, X].map((I, i) => (
            <button key={i} aria-label={['Minimize', 'Maximize', 'Close'][i]} onClick={() => windowAction(i)} className={cn('flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground', i === 2 && 'hover:bg-bad hover:text-white')}>
              <I className={i === 1 ? 'size-3' : 'size-4'} />
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}

const statusMeta: Record<ModuleStatus, { cls: string; label: string }> = {
  tuned: { cls: 'bg-good', label: 'Tuned' },
  pending: { cls: 'bg-warn', label: 'Changes pending' },
  issue: { cls: 'bg-bad', label: 'Has issues' },
}

function StatusDot({ status, className }: { status: ModuleStatus; className?: string }) {
  return <span role="img" aria-label={statusMeta[status].label} title={statusMeta[status].label} className={cn('size-1.5 shrink-0 rounded-full', statusMeta[status].cls, className)} />
}

function NavItem({ entry, active, onClick, badge }: { entry: NavEntry; active: boolean; onClick: () => void; badge?: number }) {
  const Icon = entry.icon
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={entry.status ? `${entry.label}, ${statusMeta[entry.status].label}` : undefined}
      className={cn(
        'group relative flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring',
        active ? 'font-medium text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
      )}
    >
      {active && (
        <motion.span layoutId="nav-active" transition={{ type: 'spring', stiffness: 500, damping: 40 }} className="absolute inset-0 rounded-md bg-sidebar-accent" />
      )}
      <span className={cn(
        'relative flex size-6 shrink-0 items-center justify-center self-start rounded-md border transition-all',
        active
          ? 'border-primary/50 bg-primary/15 text-primary shadow-[0_0_14px_-2px_color-mix(in_oklab,var(--primary)_70%,transparent)]'
          : 'border-sidebar-border bg-foreground/[0.03] group-hover:border-foreground/15',
      )}>
        <Icon className="size-3.5" />
        {entry.status && <StatusDot status={entry.status} className="absolute -top-0.5 -right-0.5 size-2 ring-2 ring-sidebar" />}
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block truncate leading-6">{entry.label}</span>
        <AnimatePresence initial={false}>
          {active && entry.hint && (
            <motion.span initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="block truncate text-xs font-normal text-muted-foreground">{entry.hint}</motion.span>
          )}
        </AnimatePresence>
      </span>
      {badge !== undefined && <span className="relative self-start mt-1 rounded bg-warn/15 px-1.5 text-xs font-medium tabular-nums text-warn">{badge}</span>}
    </button>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-5.5" aria-hidden>
      <rect width="24" height="24" rx="6" className="fill-primary" />
      <path d="M4 15h3l2-6 3 9 2.5-7 1.5 4H20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-foreground" />
    </svg>
  )
}
