import type { Finding, FrameStats, Target, Verdict } from './api'

export type Area = 'Audit' | 'Latency' | 'Power' | 'Background'
export interface Part { label: Area; value: number; drag: string; go: string }

export const lastFramesKey = 'graze-tune.lastFrames'

const penalty: Record<Verdict, number> = { harmful: 15, conflict: 8, risk: 4, placebo: 2, keep: 0 }
const latencyModules = new Set(['Timers', 'Interrupts & drivers', 'Input', 'Network', 'Display path', 'NVIDIA profile', 'NVIDIA hardware', 'Audio'])
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

export function area(t: Target, module?: string): Exclude<Area, 'Audit'> {
  if (t.kind === 'power' || module === 'CPU & scheduler') return 'Power'
  if (t.kind === 'bcd' || t.kind === 'device_registry' || t.kind === 'nvidia' || (module !== undefined && latencyModules.has(module))) return 'Latency'
  return 'Background'
}

function score(fs: Finding[]) {
  return clamp(100 - fs.reduce((a, f) => a + penalty[f.verdict], 0))
}

function summary(fs: Finding[]) {
  const n = new Map<Verdict, number>()
  for (const f of fs) if (penalty[f.verdict]) n.set(f.verdict, (n.get(f.verdict) ?? 0) + 1)
  return n.size ? [...n].sort((a, b) => penalty[b[0]] - penalty[a[0]]).map(([v, c]) => `${c} ${v}`).join(', ') : 'Nothing dragging it down'
}

/** One 0-100 score per area from audit findings (and the last frame capture), averaged into PC health. */
export function pcHealth(findings: Finding[], moduleOf: (t: Target) => string | undefined, frames?: FrameStats | null) {
  const by: Record<Exclude<Area, 'Audit'>, Finding[]> = { Latency: [], Power: [], Background: [] }
  for (const f of findings) by[area(f.target, moduleOf(f.target))].push(f)
  const leftovers = findings.filter((f) => f.verdict === 'harmful' || f.verdict === 'conflict')
  // Even pacing scores 100; a p99 frametime 1.5x the average scores 50.
  const pacing = frames && frames.avg_ms > 0 ? clamp(100 - (frames.p99_ms / frames.avg_ms - 1) * 100) : null
  const lat = score(by.Latency)
  const parts: Part[] = [
    { label: 'Audit', value: score(leftovers), drag: summary(leftovers), go: 'audit' },
    {
      label: 'Latency',
      value: pacing === null ? lat : Math.round((lat + pacing) / 2),
      drag: `${summary(by.Latency)} · ${frames && pacing !== null ? `p99 ${frames.p99_ms.toFixed(1)} ms vs ${frames.avg_ms.toFixed(1)} ms avg` : 'no frame capture yet'}`,
      go: pacing === null ? 'benchmarks' : 'module:Timers',
    },
    { label: 'Power', value: score(by.Power), drag: summary(by.Power), go: 'module:CPU & scheduler' },
    { label: 'Background', value: score(by.Background), drag: summary(by.Background), go: 'module:Background' },
  ]
  return { score: Math.round(parts.reduce((a, p) => a + p.value, 0) / parts.length), parts }
}
