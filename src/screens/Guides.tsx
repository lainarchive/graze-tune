import { useEffect, useState } from 'react'
import { CircuitBoard, Gamepad2, Thermometer } from 'lucide-react'
import { api, type SystemInfo } from '@/lib/api'

function Page({ icon: Icon, title, desc, children }: { icon: typeof Thermometer; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <header className="flex gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-gradient-to-b from-primary/20 to-primary/5 text-primary"><Icon className="size-6" /></div>
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{desc}</p>
        </div>
      </header>
      {children}
    </div>
  )
}

function useInfo() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  useEffect(() => { api.systemInfo().then(setInfo) }, [])
  return info
}

const hpSteps = [
  ['Open setup', 'Power on and tap F10. HP business boards (82B4) use F10 for BIOS setup.'],
  ['Update first', 'Main → Update System BIOS. HP fixes boost and memory bugs in BIOS updates; 02.51 is not the latest for this board family.'],
  ['Enable the iGPU only if used', 'Advanced → Built-in Device Options → Video memory size. If the monitor is on the RTX 3050, leave the Intel GPU unused so DWM stays on the NVIDIA card.'],
  ['Turbo and C-states', 'Advanced → Power Management Options: keep Turbo Boost enabled. Disabling C-states here is optional; graze-tune can do it per power plan instead.'],
  ['Disable unused devices', 'Advanced → Built-in Device Options: turn off serial ports, the internal speaker and anything you do not use. Fewer devices, fewer interrupts.'],
  ['Leave memory at 2400', 'This board has no XMP or memory overclocking. Dual channel (2x8 GB) is already the biggest win and is in place.'],
]

export function BiosGuide() {
  const info = useInfo()
  const hp = /hp|hewlett/i.test(info?.board ?? '') || /hp/i.test(info?.bios ?? '')
  return (
    <Page icon={CircuitBoard} title="BIOS guide" desc="graze-tune cannot change BIOS settings. This is what can be read from Windows and what to change by hand.">
      <div className="panel grid grid-cols-3 gap-4 px-5 py-4 text-sm">
        <div><div className="text-xs text-muted-foreground">Board</div>{info?.board || '…'}</div>
        <div><div className="text-xs text-muted-foreground">BIOS</div>{info?.bios || '…'}</div>
        <div><div className="text-xs text-muted-foreground">CPU</div>{info?.cpu || '…'}</div>
      </div>
      <ol className="panel divide-y">
        {(hp ? hpSteps : hpSteps.slice(1)).map(([t, d], i) => (
          <li key={t} className="flex gap-4 px-5 py-4">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums">{i + 1}</span>
            <div><div className="text-sm font-medium">{t}</div><p className="mt-0.5 text-sm text-muted-foreground">{d}</p></div>
          </li>
        ))}
      </ol>
    </Page>
  )
}

export function Thermals() {
  return (
    <Page icon={Thermometer} title="Thermals" desc="Throttling shows up as frametime spikes that no tweak fixes.">
      <div className="panel px-5 py-4 text-sm text-muted-foreground">
        Live throttle detection (CPU package temperature and PROCHOT/power-limit flags) needs a hardware sensor driver, which graze-tune deliberately does not install. Until a driverless source is added, check with HWiNFO: if the CPU sits at 100 °C or the clock drops below 3.4 GHz under load, clean the cooler and re-paste before tuning.
      </div>
    </Page>
  )
}

export function GameProfiles({ go }: { go: (s: string) => void }) {
  return (
    <Page icon={Gamepad2} title="Game profiles" desc="Settings that only apply while a specific game runs.">
      <div className="panel space-y-3 px-5 py-4 text-sm">
        <p>Per-game driver settings (Low Latency Mode, vsync, frame cap, shader cache) work today through NVIDIA game profiles: the driver applies them when the game starts and drops them when it exits.</p>
        <button className="text-primary hover:underline" onClick={() => go('module:NVIDIA profile')}>Open NVIDIA profile →</button>
        <p className="text-muted-foreground">Applying Windows tweaks on launch and reverting on exit is not in this build yet.</p>
      </div>
    </Page>
  )
}
