import { Activity, AudioLines, CircuitBoard, Cpu, EyeOff, FileCog, Gamepad2, Gauge, HardDrive, History, Layers2, ListChecks, MemoryStick, Monitor, MousePointer2, Network, PanelsTopLeft, Rocket, ScanSearch, ShieldHalf, SlidersHorizontal, Thermometer, Timer, Waves, Zap, type LucideIcon } from 'lucide-react'

export type ModuleStatus = 'tuned' | 'pending' | 'issue'

export interface NavEntry { id: string; label: string; icon: LucideIcon; hint?: string; status?: ModuleStatus }

export const primaryNav: NavEntry[] = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'audit', label: 'Audit', icon: ScanSearch },
  { id: 'presets', label: 'Presets', icon: Rocket },
  { id: 'benchmarks', label: 'Benchmarks', icon: Activity },
  { id: 'history', label: 'Changes', icon: History },
]

export const moduleNav: { group: string; items: NavEntry[] }[] = [
  { group: 'System', items: [
    { id: 'CPU & scheduler', label: 'CPU & scheduler', icon: Cpu, hint: 'Power plan, parking, priority, affinity', status: 'pending' },
    { id: 'Timers', label: 'Timers', icon: Timer, hint: 'Timer resolution, HPET, dynamic tick', status: 'issue' },
    { id: 'Interrupts & drivers', label: 'Interrupts & drivers', icon: Zap, hint: 'DPC/ISR per driver, MSI mode', status: 'pending' },
    { id: 'Memory', label: 'Memory', icon: MemoryStick, hint: 'Pagefile, standby list, compression', status: 'issue' },
    { id: 'Storage', label: 'Storage', icon: HardDrive, hint: 'TRIM, write cache, link power', status: 'issue' },
    { id: 'Thermals', label: 'Thermals', icon: Thermometer, hint: 'Throttle detection', status: 'tuned' },
    { id: 'BIOS guide', label: 'BIOS guide', icon: CircuitBoard, hint: 'HP 82B4 steps' },
  ] },
  { group: 'Graphics', items: [
    { id: 'NVIDIA profile', label: 'NVIDIA profile', icon: SlidersHorizontal, hint: 'Driver profile settings per game', status: 'issue' },
    { id: 'NVIDIA hardware', label: 'NVIDIA hardware', icon: Layers2, hint: 'MSI, P-state, PCIe power, telemetry', status: 'tuned' },
    { id: 'GPU drivers', label: 'AMD & Intel GPU', icon: CircuitBoard, hint: 'ULPS, power gating, PCIe power', status: 'pending' },
    { id: 'Display path', label: 'Display path', icon: Monitor, hint: 'Refresh, VRR, MPO, flip model', status: 'issue' },
  ] },
  { group: 'Input & network', items: [
    { id: 'Input', label: 'Input', icon: MousePointer2, hint: 'USB suspend, buffers, polling', status: 'tuned' },
    { id: 'Audio', label: 'Audio', icon: AudioLines, hint: 'Exclusive mode, enhancements' },
    { id: 'Network', label: 'Network', icon: Network, hint: 'NIC properties, TCP, QoS, DNS', status: 'pending' },
  ] },
  { group: 'Windows', items: [
    { id: 'Registry', label: 'Registry', icon: FileCog, hint: 'Catalog with Windows defaults', status: 'issue' },
    { id: 'Services', label: 'Services', icon: ListChecks, hint: 'Service profiles', status: 'issue' },
    { id: 'Background', label: 'Background', icon: Waves, hint: 'Startup, tasks, telemetry, updates', status: 'pending' },
    { id: 'Windows UI', label: 'Windows UI', icon: PanelsTopLeft, hint: 'Animations, Game Mode, Game Bar', status: 'tuned' },
    { id: 'Privacy', label: 'Privacy', icon: EyeOff, hint: 'Recall, Copilot, ads, tracking', status: 'pending' },
    { id: 'Security tradeoffs', label: 'Security tradeoffs', icon: ShieldHalf, hint: 'VBS, HVCI, mitigations', status: 'pending' },
  ] },
  { group: 'Games', items: [
    { id: 'Game profiles', label: 'Game profiles', icon: Gamepad2, hint: 'Apply on launch, revert on exit' },
  ] },
]
