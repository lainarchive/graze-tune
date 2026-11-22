import { useEffect } from 'react'
import { Settings2 } from 'lucide-react'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { moduleNav, primaryNav } from '@/data/nav'
import { cpuTweaks, findings } from '@/data/mock'

export function CommandPalette({ open, setOpen, go }: { open: boolean; setOpen: (v: boolean) => void; go: (s: string) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setOpen(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  const pick = (s: string) => { go(s); setOpen(false) }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search graze-tune" description="Jump to a module, tweak or audit finding">
      <Command>
      <CommandInput placeholder="Search tweaks, findings, modules" />
      <CommandList>
        <CommandEmpty>Nothing matches. Try a registry key name or a driver.</CommandEmpty>
        <CommandGroup heading="Go to">
          {primaryNav.map((n) => (
            <CommandItem key={n.id} onSelect={() => pick(n.id)}><n.icon />{n.label}</CommandItem>
          ))}
          <CommandItem onSelect={() => pick('settings')} value="Settings theme accent appearance"><Settings2 />Settings</CommandItem>
        </CommandGroup>
        <CommandGroup heading="Modules">
          {moduleNav.flatMap((g) => g.items).map((m) => (
            <CommandItem key={m.id} onSelect={() => pick(`module:${m.id}`)} value={`${m.label} ${m.hint}`}>
              <m.icon />{m.label}<CommandShortcut className="tracking-normal">{m.hint}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Tweaks">
          {cpuTweaks.map((t) => <CommandItem key={t.id} onSelect={() => pick('module:CPU & scheduler')}>{t.title}</CommandItem>)}
        </CommandGroup>
        <CommandGroup heading="Audit findings">
          {findings.map((f) => <CommandItem key={f.id} onSelect={() => pick('audit')} value={`${f.title} ${f.location}`}>{f.title}</CommandItem>)}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
