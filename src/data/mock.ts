export type Verdict = 'harmful' | 'conflict' | 'placebo' | 'keep' | 'risk'
export type Kind = 'registry' | 'bcdedit' | 'service' | 'power' | 'task' | 'nvidia' | 'device'

export interface Finding {
  id: string
  title: string
  kind: Kind
  location: string
  current: string
  windowsDefault: string
  source: string
  verdict: Verdict
  why: string
}

export const system = {
  cpu: 'Intel Core i5-7500, 4C/4T',
  gpu: 'NVIDIA GeForce RTX 3050, 32.0.16.1742',
  igpu: 'Intel HD Graphics 630',
  ram: '16 GB DDR4-2400, dual channel',
  board: 'HP 82B4, BIOS 02.51',
  nic: 'Intel I219-LM, 1 Gbps',
  disk: '1 TB SATA SSD',
  os: 'Windows 11 Pro 26200',
  plan: 'optimizerDuck PowerPlan',
}

export const findings: Finding[] = [
  { id: 'f1', title: 'Platform clock forced to HPET', kind: 'bcdedit', location: 'bcdedit {current} useplatformclock', current: 'Yes', windowsDefault: 'not set', source: 'Stix Tweaks (likely)', verdict: 'harmful', why: 'Forces every QueryPerformanceCounter call through HPET. Adds ~0.5–1 µs per call and raises frametime variance in most engines.' },
  { id: 'f2', title: 'LargeSystemCache enabled', kind: 'registry', location: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\LargeSystemCache', current: '1', windowsDefault: '0', source: 'Unknown', verdict: 'harmful', why: 'Server file-cache policy. On a 16 GB desktop it competes with games for RAM and increases standby-list churn.' },
  { id: 'f3', title: 'Scheduled TRIM disabled', kind: 'task', location: '\\Microsoft\\Windows\\Defrag\\ScheduledDefrag', current: 'Disabled', windowsDefault: 'Ready', source: 'OptimizerDuck (likely)', verdict: 'harmful', why: 'This task sends TRIM to your SATA SSD. Without it, write performance degrades over time.' },
  { id: 'f4', title: 'Low Latency Mode Ultra set globally', kind: 'nvidia', location: 'NVIDIA DRS, Base profile, Ultra Low Latency', current: 'Ultra', windowsDefault: 'Off', source: 'Paragon Tweaks (likely)', verdict: 'conflict', why: 'Games with Reflex already override this. Forcing it everywhere can cap GPU utilisation on a CPU-bound i5-7500.' },
  { id: 'f5', title: 'Two tools set Win32PrioritySeparation', kind: 'registry', location: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl\\Win32PrioritySeparation', current: '0x2A', windowsDefault: '0x2', source: 'EXM + OptimizerDuck', verdict: 'conflict', why: 'EXM wrote 0x26, OptimizerDuck later wrote 0x2A. The benchmark will pick the better value for this machine.' },
  { id: 'f6', title: 'Speculative-execution mitigations off', kind: 'registry', location: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\FeatureSettingsOverride', current: '3', windowsDefault: 'not set', source: 'Unknown', verdict: 'risk', why: 'Gives a few percent on Kaby Lake but exposes the system to Spectre/Meltdown. Only worth it on an offline gaming install.' },
  { id: 'f7', title: 'Windows Update service disabled', kind: 'service', location: 'wuauserv, Start', current: 'Disabled', windowsDefault: 'Manual', source: 'OptimizerDuck (likely)', verdict: 'risk', why: 'No security patches and no driver delivery. Pausing updates for 5 weeks gets the same quiet without the exposure.' },
  { id: 'f8', title: 'SystemResponsiveness set to 0', kind: 'registry', location: 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\SystemResponsiveness', current: '0', windowsDefault: '20', source: 'EXM (likely)', verdict: 'placebo', why: 'Windows treats values below 10 as 10. No measurable effect on frametimes or input latency.' },
  { id: 'f9', title: 'Nagle disabled on Ethernet', kind: 'registry', location: 'HKLM\\…\\Tcpip\\Parameters\\Interfaces\\{8c1e…}\\TcpNoDelay', current: '1', windowsDefault: 'not set', source: 'Stix Tweaks (likely)', verdict: 'placebo', why: 'Most competitive games use UDP, which Nagle never touches. Harmless, but not what fixes ping.' },
  { id: 'f10', title: 'MPO disable key on a build that ignores it', kind: 'registry', location: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\Dwm\\OverlayTestMode', current: '5', windowsDefault: 'not set', source: 'Unknown', verdict: 'placebo', why: 'Build 26200 no longer reads OverlayTestMode. MPO is still active.' },
  { id: 'f11', title: 'Global timer resolution requests', kind: 'registry', location: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel\\GlobalTimerResolutionRequests', current: '1', windowsDefault: 'not set', source: 'Stix Tweaks (likely)', verdict: 'keep', why: 'Lets a game’s 0.5 ms timer request apply system-wide on Windows 11. Measured to help frame pacing on this CPU.' },
  { id: 'f12', title: 'Custom power plan active', kind: 'power', location: 'powercfg, optimizerDuck PowerPlan', current: 'Parking off, min CPU 100%', windowsDefault: 'Balanced', source: 'OptimizerDuck', verdict: 'keep', why: 'Core parking off and a 100% minimum state are reasonable on a 4-thread desktop CPU. graze-tune will adopt it into its own plan.' },
  { id: 'f13', title: 'Virtual display adapter attached', kind: 'device', location: 'MuMuPlayer virtual display', current: 'Active', windowsDefault: '—', source: 'MuMuPlayer', verdict: 'conflict', why: 'An extra display adapter can move DWM composition off the RTX 3050 and blocks independent flip on some setups.' },
]

export const verdictMeta: Record<Verdict, { label: string; tone: string }> = {
  harmful: { label: 'Harmful', tone: 'text-bad bg-bad/10 border-bad/25' },
  conflict: { label: 'Conflict', tone: 'text-warn bg-warn/10 border-warn/25' },
  risk: { label: 'Security tradeoff', tone: 'text-warn bg-warn/10 border-warn/25' },
  placebo: { label: 'No effect', tone: 'text-muted-foreground bg-muted border-border' },
  keep: { label: 'Keep', tone: 'text-good bg-good/10 border-good/25' },
}

function rng(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

// Frametime samples (ms) for a 4C/4T CPU-bound run, with stutter spikes.
export function frametimes(seed: number, base: number, jitter: number, spikeEvery: number, spike: number) {
  const r = rng(seed)
  return Array.from({ length: 240 }, (_, i) => {
    const t = base + (r() - 0.5) * jitter + (i % spikeEvery === 0 ? spike * (0.6 + r() * 0.6) : 0)
    return { i, ms: Math.round(t * 100) / 100 }
  })
}

export const before = frametimes(7, 8.6, 1.8, 23, 14)
export const after = frametimes(11, 7.4, 0.9, 61, 6)

export const latencyBudget = [
  { stage: 'Input', ms: 1.0, note: 'USB poll 1000 Hz' },
  { stage: 'CPU / game', ms: 7.9, note: 'Main thread, 4 threads busy' },
  { stage: 'Render queue', ms: 4.1, note: 'Pre-rendered frames: 2' },
  { stage: 'GPU', ms: 5.2, note: 'RTX 3050, 71% busy' },
  { stage: 'Display', ms: 6.9, note: 'Scanout and DWM composition' },
]

export const dpc = [
  { driver: 'nvlddmkm.sys', us: 412, note: 'NVIDIA display driver' },
  { driver: 'ndis.sys', us: 286, note: 'Network stack (I219-LM)' },
  { driver: 'MuMuVMMDrv.sys', us: 241, note: 'MuMuPlayer hypervisor' },
  { driver: 'storport.sys', us: 98, note: 'Storage' },
  { driver: 'USBXHCI.SYS', us: 61, note: 'USB 3 host' },
  { driver: 'HDAudBus.sys', us: 37, note: 'Audio' },
]

export interface Tweak {
  id: string
  title: string
  detail: string
  changes: { path: string; from: string; to: string }[]
  effect: string | null
  risk: 'safe' | 'caution' | 'opt-in'
  on: boolean
}

export const cpuTweaks: Tweak[] = [
  { id: 't1', title: 'Foreground priority boost', detail: 'Short, variable quanta with a 3:1 foreground boost. Picked by A/B benchmark between 0x26 and 0x2A.', changes: [{ path: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl\\Win32PrioritySeparation', from: '0x2A', to: '0x26' }], effect: '+2.1% 1% lows', risk: 'safe', on: true },
  { id: 't2', title: 'Disable core parking', detail: 'Keep all 4 cores unparked so the game thread never waits on a wake-up.', changes: [{ path: 'powercfg CPMINCORES (graze-tune plan)', from: '100%', to: '100%' }], effect: 'Already applied', risk: 'safe', on: true },
  { id: 't3', title: 'Processor idle demote/promote', detail: 'Bias the CPU towards shallow C-states during gameplay to cut wake-up latency.', changes: [{ path: 'powercfg IDLEPROMOTE / IDLEDEMOTE', from: '40 / 20', to: '100 / 100' }], effect: '−18 µs avg DPC wake', risk: 'caution', on: false },
  { id: 't4', title: 'Disable dynamic tick', detail: 'Keeps the system timer ticking at a fixed rate. Raises idle power draw.', changes: [{ path: 'bcdedit {current} disabledynamictick', from: 'not set', to: 'yes' }], effect: null, risk: 'caution', on: false },
  { id: 't5', title: 'Move NVIDIA interrupts off CPU 0', detail: 'CPU 0 also services ndis.sys and USB. Pin nvlddmkm to CPU 2 via interrupt affinity policy.', changes: [{ path: 'HKLM\\…\\Enum\\PCI\\VEN_10DE…\\Interrupt Management\\Affinity Policy\\AssignmentSetOverride', from: 'not set', to: '0x04' }], effect: '−9% DPC p99', risk: 'caution', on: false },
  { id: 't6', title: 'Disable VBS / memory integrity', detail: 'Removes the hypervisor from the gaming path. Weakens kernel protection; some anti-cheats require it.', changes: [{ path: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\EnableVirtualizationBasedSecurity', from: '1', to: '0' }], effect: null, risk: 'opt-in', on: false },
]

export const history = [
  { id: 'b4', when: 'Today 14:12', label: 'CPU & scheduler', items: 2, result: '+2.1% 1% lows', restorePoint: true },
  { id: 'b3', when: 'Today 13:40', label: 'Audit fixes: reset 3 harmful items', items: 3, result: '−31% frametime p99', restorePoint: true },
  { id: 'b2', when: 'Today 13:31', label: 'Baseline benchmark', items: 0, result: '61 fps 1% low', restorePoint: false },
  { id: 'b1', when: 'Today 13:28', label: 'Initial audit snapshot', items: 0, result: '13 findings', restorePoint: true },
]


export function stats(s: { ms: number }[]) {
  const ms = s.map((x) => x.ms).sort((a, b) => a - b)
  const avg = ms.reduce((a, b) => a + b, 0) / ms.length
  const worst = ms.slice(Math.floor(ms.length * 0.99))
  const low1 = 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length)
  return { fps: 1000 / avg, low1, p99: ms[Math.floor(ms.length * 0.99) - 1] ?? 0 }
}

export const net = { before: { ping: 38, jitter: 9.4, bloat: 61 }, after: { ping: 34, jitter: 2.1, bloat: 12 } }

export const nextSteps = [
  { title: 'Reset 3 harmful leftovers', detail: 'HPET clock, LargeSystemCache, disabled TRIM', gain: '−31% p99 frametime', go: 'audit' },
  { title: 'Detach the MuMuPlayer display adapter', detail: 'Keeps DWM composition on the RTX 3050', gain: 'Independent flip', go: 'module:Display path' },
  { title: 'Move NVIDIA interrupts off CPU 0', detail: 'CPU 0 also handles network and USB', gain: '−9% DPC p99', go: 'module:CPU & scheduler' },
] as const

export const sources = [
  { name: 'OptimizerDuck', n: 4 },
  { name: 'Stix Tweaks', n: 3 },
  { name: 'EXM', n: 2 },
  { name: 'Paragon Tweaks', n: 1 },
  { name: 'Other / unknown', n: 3 },
]
