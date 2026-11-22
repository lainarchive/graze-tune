import { useEffect, useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { lastFramesKey } from '@/lib/health'
import { api, type FrameStats, type PingStats, type Timer } from '@/lib/api'
import { useSettings } from '@/lib/settings'

const tip = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }
const tick = { fontSize: 11, fill: 'var(--muted-foreground)' }
type Run = { stats: FrameStats; frametimes: number[] }

export default function Benchmarks() {
  const settings = useSettings()
  const [process, setProcess] = useState('cs2.exe')
  const [runs, setRuns] = useState<{ baseline?: Run; latest?: Run }>({})
  const [ping, setPing] = useState<{ baseline?: PingStats; latest?: PingStats }>({})
  const [timer, setTimer] = useState<Timer | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { api.timer().then(setTimer) }, [])

  const guard = async (what: string, f: () => Promise<void>) => {
    setBusy(what)
    setError(null)
    try { await f() } catch (e) { setError(String(e)) } finally { setBusy(null) }
  }
  const capture = () => guard('frames', async () => {
    const r = await api.frames(process, settings.benchSeconds)
    localStorage.setItem(lastFramesKey, JSON.stringify(r.stats))
    setRuns((o) => (o.baseline ? { ...o, latest: r } : { baseline: r }))
  })
  const network = () => guard('ping', async () => {
    const r = await api.ping('1.1.1.1', 443, 40)
    setPing((o) => (o.baseline ? { ...o, latest: r } : { baseline: r }))
  })
  const n = Math.max(runs.baseline?.frametimes.length ?? 0, runs.latest?.frametimes.length ?? 0)
  const step = Math.max(1, Math.floor(n / 600))
  const merged = Array.from({ length: Math.ceil(n / step) }, (_, i) => ({ i, before: runs.baseline?.frametimes[i * step], after: runs.latest?.frametimes[i * step] }))

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Benchmarks</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">The first run is your baseline; later runs are compared against it. Frametimes come from PresentMon while the game runs.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={process} onChange={(e) => setProcess(e.target.value)} className="h-9 w-48 font-mono text-sm" aria-label="Game process" />
          <Button disabled={!!busy || !process} onClick={capture}>{busy === 'frames' ? `Capturing ${settings.benchSeconds} s…` : `Capture ${settings.benchSeconds} s`}</Button>
          <Button variant="outline" disabled={!!busy} onClick={() => { setRuns({}); setPing({}) }}>New baseline</Button>
        </div>
      </header>
      {error && <div className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-2.5 text-sm text-bad">{error}</div>}

      <section className="panel p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">Frametime, baseline vs latest</h2>
          <div className="flex gap-4 text-xs text-muted-foreground">
            {runs.baseline && <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 bg-chart-2" />Baseline {runs.baseline.stats.avg_fps.toFixed(0)} fps, 1% low {runs.baseline.stats.low1_fps.toFixed(0)}</span>}
            {runs.latest && <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 bg-chart-1" />Latest {runs.latest.stats.avg_fps.toFixed(0)} fps, 1% low {runs.latest.stats.low1_fps.toFixed(0)}</span>}
          </div>
        </div>
        <div className="mt-3 h-56">
          {n ? (
            <ResponsiveContainer>
              <LineChart data={merged} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <XAxis dataKey="i" hide />
                <YAxis tickFormatter={(v: number) => `${v} ms`} tick={tick} axisLine={false} tickLine={false} width={62} />
                <Tooltip contentStyle={tip} labelFormatter={() => ''} />
                <Line dataKey="before" stroke="var(--chart-2)" dot={false} strokeWidth={1.25} isAnimationActive={false} />
                <Line dataKey="after" stroke="var(--chart-1)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="graticule flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">Start the game, then capture. Needs PresentMon.exe bundled with the app.</div>
          )}
        </div>
        {runs.baseline && (
          <div className="mt-4 grid grid-cols-4 gap-4 border-t pt-4 text-sm">
            {([['Average', 'avg_fps', 'fps'], ['1% low', 'low1_fps', 'fps'], ['0.1% low', 'low01_fps', 'fps'], ['p99 frametime', 'p99_ms', 'ms']] as const).map(([l, k, u]) => (
              <div key={k}>
                <div className="text-xs text-muted-foreground">{l}</div>
                <div className="tabular-nums">{runs.baseline!.stats[k].toFixed(1)}{runs.latest && <> → <b className="font-semibold">{runs.latest.stats[k].toFixed(1)}</b></>} {u}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-6">
        <section className="space-y-4 panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Network</h2>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={network}>{busy === 'ping' ? 'Testing…' : 'Test 40 samples'}</Button>
          </div>
          {ping.baseline ? (
            ([['Ping', 'avg_ms'], ['Best', 'min_ms'], ['Jitter', 'jitter_ms']] as const).map(([l, k]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{l}</span>
                <span className="tabular-nums">{ping.baseline![k].toFixed(1)}{ping.latest && <> → <b className="font-semibold">{ping.latest[k].toFixed(1)}</b></>} ms</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">TCP round trips to 1.1.1.1. Works without ICMP and shows jitter and lost packets.</p>
          )}
          {ping.baseline && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Lost</span><span className="tabular-nums">{ping.baseline.lost}{ping.latest && <> → <b className="font-semibold">{ping.latest.lost}</b></>} of {ping.baseline.samples}</span></div>}
        </section>
        <section className="space-y-4 panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Timer resolution</h2>
            <Button size="sm" variant="outline" disabled={!timer} onClick={() => api.timer(true).then(setTimer)}>Request 0.5 ms</Button>
          </div>
          {timer ? (
            ([['Current', timer.current_ms], ['Finest supported', timer.max_ms], ['Coarsest', timer.min_ms]] as const).map(([l, v]) => (
              <div key={l} className="flex justify-between text-sm"><span className="text-muted-foreground">{l}</span><span className="tabular-nums">{v.toFixed(3)} ms</span></div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Available in the Windows app.</p>
          )}
          <p className="text-xs text-muted-foreground">Per-driver DPC/ISR timing needs a kernel ETW trace and is not in this build yet; use LatencyMon alongside for now.</p>
        </section>
      </div>
    </div>
  )
}
