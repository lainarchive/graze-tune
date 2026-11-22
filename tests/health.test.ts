import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pcHealth } from '../src/lib/health.ts'
import type { Finding, Target, Verdict } from '../src/lib/api.ts'

const f = (verdict: Verdict, target: Target): Finding => ({ id: verdict, title: '', target, location: '', current: { type: 'missing' } as never, windows_default: { type: 'missing' } as never, verdict, sources: [], why: '', ours: false })
const reg = (path: string): Target => ({ kind: 'registry', hive: 'HKLM', path, name: 'x' })

test('clean PC scores 100', () => {
  const h = pcHealth([], () => undefined)
  assert.equal(h.score, 100)
  assert.equal(h.parts[1].go, 'benchmarks')
})

test('findings land in their area and leftovers hit Audit', () => {
  const h = pcHealth(
    [f('harmful', { kind: 'bcd', element: 'useplatformclock' }), f('conflict', { kind: 'power', subgroup: 's', setting: 'p' }), f('placebo', reg('a')), f('keep', reg('cpu'))],
    (t) => (t.kind === 'registry' && t.path === 'cpu' ? 'CPU & scheduler' : undefined),
  )
  const v = Object.fromEntries(h.parts.map((p) => [p.label, p.value]))
  assert.deepEqual(v, { Audit: 77, Latency: 85, Power: 92, Background: 98 })
  assert.equal(h.parts[0].drag, '1 harmful, 1 conflict')
})

test('frame pacing averages into Latency', () => {
  const h = pcHealth([], () => undefined, { frames: 1, avg_fps: 100, low1_fps: 50, low01_fps: 40, avg_ms: 10, p99_ms: 15 })
  assert.equal(h.parts[1].value, 75)
})
