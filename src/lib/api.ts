import catalogJson from '@/data/catalog.json'

export type Value =
  | { type: 'missing' }
  | { type: 'dword'; data: number }
  | { type: 'qword'; data: number }
  | { type: 'string'; data: string }
  | { type: 'multi'; data: string[] }
  | { type: 'binary'; data: number[] }

export type Target =
  | { kind: 'registry'; hive: 'HKLM' | 'HKCU'; path: string; name: string }
  | { kind: 'device_registry'; class: string; subkey: string; name: string }
  | { kind: 'service'; name: string }
  | { kind: 'bcd'; element: string }
  | { kind: 'power'; subgroup: string; setting: string }
  | { kind: 'task'; path: string }
  | { kind: 'nvidia'; profile?: string | null; setting: number }

export type Risk = 'safe' | 'caution' | 'opt-in'
export type Verdict = 'harmful' | 'conflict' | 'placebo' | 'keep' | 'risk'
export interface Change { target: Target; value: Value; default: Value }
export interface Tweak { id: string; module: string; title: string; why: string; risk: Risk; restart: boolean; changes: Change[] }
export interface Catalog { tweak: Tweak[]; audit: unknown[] }
export interface Finding { id: string; title: string; target: Target; location: string; current: Value; windows_default: Value; verdict: Verdict; sources: string[]; why: string; ours: boolean }
export interface AuditReport { checked: number; findings: Finding[]; errors: string[] }
export interface Entry { target: Target; old: Value; new: Value; tweak: string | null }
export interface Batch { id: number; at: number; label: string; restore_point: number | null; entries: Entry[]; state: 'pending' | 'applied' | 'failed' | 'reverted'; error: string | null }
export interface SystemInfo { os: string; cpu: string; threads: number; ram_bytes: number; board: string; bios: string; gpus: string[]; power_plan: string; timer_resolution_ms: number | null; nvidia: boolean }
export interface ProfileInfo { name: string; predefined: boolean; apps: number; settings: number }
export interface DriverSetting { id: number; name: string; value: Value; predefined: Value | null; user_set: boolean }
export interface PingStats { samples: number; lost: number; avg_ms: number; min_ms: number; jitter_ms: number }
export interface FrameStats { frames: number; avg_fps: number; low1_fps: number; low01_fps: number; avg_ms: number; p99_ms: number }
export interface Timer { min_ms: number; max_ms: number; current_ms: number }
export interface ChangeIn { target: Target; value: Value; tweak?: string | null }

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const catalog = catalogJson as unknown as Catalog

export const dword = (n: number): Value => ({ type: 'dword', data: n })
export const missing: Value = { type: 'missing' }

export function fmtValue(v: Value | null | undefined): string {
  if (!v) return 'unreadable'
  switch (v.type) {
    case 'missing': return 'not set'
    case 'dword': return v.data > 9 ? `0x${v.data.toString(16).toUpperCase()}` : String(v.data)
    case 'qword': return `0x${v.data.toString(16).toUpperCase()}`
    case 'string': return v.data
    case 'multi': return v.data.join(', ')
    case 'binary': return v.data.slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('') + (v.data.length > 16 ? '…' : '')
  }
}

export function fmtTarget(t: Target): string {
  switch (t.kind) {
    case 'registry': return `${t.hive}\\${t.path}\\${t.name}`
    case 'device_registry': return `${t.class} devices\\Device Parameters\\${t.subkey}\\${t.name}`
    case 'service': return `service ${t.name} start type`
    case 'bcd': return `bcdedit {current} ${t.element}`
    case 'power': return `powercfg ${t.subgroup} ${t.setting}`
    case 'task': return `task ${t.path}`
    case 'nvidia': return `NVIDIA ${t.profile ?? 'Base Profile'} 0x${t.setting.toString(16).toUpperCase().padStart(8, '0')}`
  }
}

export const sameValue = (a: Value | null | undefined, b: Value | null | undefined) => JSON.stringify(a) === JSON.stringify(b)
const key = (t: Target) => JSON.stringify({ ...t, profile: t.kind === 'nvidia' ? (t.profile ?? null) : undefined })

// Browser preview: an in-memory PC seeded with leftovers like the ones on the target machine.
const mockValues = new Map<string, Value>()
const seed: [Target, Value][] = [
  [{ kind: 'bcd', element: 'useplatformclock' }, { type: 'string', data: 'Yes' }],
  [{ kind: 'registry', hive: 'HKLM', path: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management', name: 'LargeSystemCache' }, dword(1)],
  [{ kind: 'registry', hive: 'HKLM', path: 'SYSTEM\\CurrentControlSet\\Control\\PriorityControl', name: 'Win32PrioritySeparation' }, dword(0x2a)],
  [{ kind: 'service', name: 'wuauserv' }, dword(4)],
  [{ kind: 'registry', hive: 'HKLM', path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Psched', name: 'NonBestEffortLimit' }, dword(0)],
  [{ kind: 'registry', hive: 'HKLM', path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters', name: 'TcpAckFrequency' }, dword(1)],
  [{ kind: 'registry', hive: 'HKLM', path: 'SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity', name: 'Enabled' }, dword(0)],
  [{ kind: 'registry', hive: 'HKLM', path: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel', name: 'GlobalTimerResolutionRequests' }, dword(1)],
  [{ kind: 'power', subgroup: 'SUB_PROCESSOR', setting: 'CPMINCORES' }, dword(100)],
  [{ kind: 'nvidia', profile: null, setting: 0x0005f543 }, dword(2)],
  [{ kind: 'nvidia', profile: null, setting: 0x1057eb71 }, dword(1)],
]
for (const t of catalog.tweak) for (const c of t.changes) mockValues.set(key(c.target), c.default)
for (const [t, v] of seed) mockValues.set(key(t), v)
const mockRead = (t: Target): Value => mockValues.get(key(t)) ?? missing
const mockWrite = (t: Target, v: Value) => mockValues.set(key(t), v)
const mockBatches: Batch[] = []

const mockAudit = (): AuditReport => {
  const rules = catalogJson.audit as unknown as { id: string; title: string; target: Target; default: Value; verdict: Verdict; sources: string[]; why: string }[]
  const findings: Finding[] = []
  const seen = new Set<string>()
  const check = (id: string, title: string, target: Target, def: Value, verdict: Verdict, sources: string[], why: string) => {
    if (seen.has(key(target))) return
    seen.add(key(target))
    const current = mockRead(target)
    if (current.type !== 'missing' && !sameValue(current, def)) findings.push({ id, title, target, location: fmtTarget(target), current, windows_default: def, verdict, sources, why, ours: mockBatches.some((b) => b.state === 'applied' && b.entries.some((e) => key(e.target) === key(target))) })
  }
  for (const r of rules) check(r.id, r.title, r.target, r.default, r.verdict, r.sources, r.why)
  for (const t of catalog.tweak) for (const c of t.changes) check(`${t.id}:${fmtTarget(c.target)}`, t.title, c.target, c.default, t.risk === 'opt-in' ? 'risk' : 'keep', [], t.why)
  return { checked: seen.size, findings, errors: [] }
}

const mockNvSettings: DriverSetting[] = [
  { id: 0x0005f543, name: 'Ultra Low Latency - CPL State', value: dword(2), predefined: dword(0), user_set: true },
  { id: 0x00a879cf, name: 'Vertical Sync', value: dword(0x60925292), predefined: dword(0x60925292), user_set: false },
  { id: 0x1057eb71, name: 'Power management - mode', value: dword(1), predefined: dword(5), user_set: true },
  { id: 0x00ac8497, name: 'Shader Cache - Cache Size', value: dword(0x4000), predefined: dword(0x4000), user_set: false },
  { id: 0x00ce2691, name: 'Texture filtering - Quality', value: dword(0), predefined: dword(0), user_set: false },
  { id: 0x101e61a9, name: 'Anisotropic filtering setting', value: dword(1), predefined: dword(1), user_set: false },
]

const mock: Record<string, (a: Record<string, unknown>) => unknown> = {
  system_info: () => ({ os: 'Windows 11 Pro 25H2 (build 26200)', cpu: 'Intel(R) Core(TM) i5-7500 CPU @ 3.40GHz', threads: 4, ram_bytes: 17179869184, board: 'HP 82B4', bios: 'HP 02.51', gpus: ['NVIDIA GeForce RTX 3050 (32.0.16.1742)', 'Intel(R) HD Graphics 630', 'MuMuPlayer Virtual Display'], power_plan: 'optimizerDuck PowerPlan', timer_resolution_ms: 0.5, nvidia: true }),
  run_audit: mockAudit,
  read_values: ({ targets }) => (targets as Target[]).map(mockRead),
  apply: ({ label, changes, restore_point }) => {
    const entries = (changes as ChangeIn[]).map((c) => ({ target: c.target, old: mockRead(c.target), new: c.value, tweak: c.tweak ?? null })).filter((e) => !sameValue(e.old, e.new))
    entries.forEach((e) => mockWrite(e.target, e.new))
    const b: Batch = { id: mockBatches.length + 1, at: Date.now() / 1000, label: label as string, restore_point: restore_point && entries.length ? 1 : null, entries, state: 'applied', error: null }
    mockBatches.push(b)
    return b
  },
  history: () => [...mockBatches],
  revert: ({ id }) => {
    const b = mockBatches.find((x) => x.id === id)
    if (b && b.state !== 'reverted') { [...b.entries].reverse().forEach((e) => mockWrite(e.target, e.old)); b.state = 'reverted' }
    return []
  },
  revert_all: () => { [...mockBatches].reverse().filter((b) => b.state === 'applied').forEach((b) => mock.revert({ id: b.id })); return [] },
  nv_profiles: () => [{ name: 'Base Profile', predefined: true, apps: 0, settings: 4 }, { name: 'VALORANT', predefined: true, apps: 1, settings: 12 }, { name: 'Counter-strike 2', predefined: true, apps: 1, settings: 9 }, { name: 'Fortnite', predefined: true, apps: 3, settings: 11 }],
  nv_settings: ({ profile }) => mockNvSettings.map((s) => {
    const v = mockValues.get(key({ kind: 'nvidia', profile: (profile as string) ?? null, setting: s.id }))
    return v && v.type !== 'missing' ? { ...s, value: v, user_set: true } : profile ? { ...s, value: s.predefined ?? s.value, user_set: false } : s
  }),
  nv_apps: ({ profile }) => ({ VALORANT: ['valorant-win64-shipping.exe'], 'Counter-strike 2': ['cs2.exe'], Fortnite: ['fortniteclient-win64-shipping.exe'] })[profile as string] ?? [],
  nv_add_app: () => null,
  nip_read: () => ({ changes: [{ target: { kind: 'nvidia', profile: null, setting: 0x00a879cf }, value: dword(0x08416747) }], apps: [] }),
  nip_write: () => 2,
  bench_ping: async () => { await new Promise((r) => setTimeout(r, 1200)); return { samples: 20, lost: 0, avg_ms: 33.8, min_ms: 31.2, jitter_ms: 2.1 } },
  bench_frames: () => { throw new Error('Frametime capture needs the Windows app') },
  timer_resolution: () => ({ min_ms: 15.625, max_ms: 0.5, current_ms: 0.5 }),
}

export async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (inTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>(cmd, args)
  }
  return (await mock[cmd](args)) as T
}

export const api = {
  systemInfo: () => call<SystemInfo>('system_info'),
  audit: () => call<AuditReport>('run_audit'),
  read: (targets: Target[]) => call<(Value | null)[]>('read_values', { targets }),
  apply: (label: string, changes: ChangeIn[], restorePoint: boolean) => call<Batch>('apply', { label, changes, restorePoint }),
  history: () => call<Batch[]>('history'),
  revert: (id: number) => call<string[]>('revert', { id }),
  revertAll: () => call<string[]>('revert_all'),
  nvProfiles: () => call<ProfileInfo[]>('nv_profiles'),
  nvSettings: (profile: string | null) => call<DriverSetting[]>('nv_settings', { profile }),
  nvApps: (profile: string) => call<string[]>('nv_apps', { profile }),
  nvAddApp: (profile: string, exe: string) => call<null>('nv_add_app', { profile, exe }),
  nipRead: (path: string) => call<{ changes: { target: Target; value: Value }[]; apps: [string, string[]][] }>('nip_read', { path }),
  nipWrite: (path: string, profiles: (string | null)[]) => call<number>('nip_write', { path, profiles }),
  ping: (host: string, port: number, count: number) => call<PingStats>('bench_ping', { host, port, count }),
  frames: (process: string, seconds: number) => call<{ stats: FrameStats; frametimes: number[] }>('bench_frames', { process, seconds }),
  timer: (requestMax?: boolean) => call<Timer | null>('timer_resolution', { requestMax }),
}
