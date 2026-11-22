import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Plus, SlidersHorizontal, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { api, dword, fmtValue, inTauri, missing, sameValue, type ChangeIn, type DriverSetting, type ProfileInfo, type Value } from '@/lib/api'
import { useSettings } from '@/lib/settings'

type Opt = { label: string; set: [number, number][] }
type Row = { key: string; label: string; desc: string; ids: number[]; opts: Opt[] }
const o = (label: string, ...set: [number, number][]): Opt => ({ label, set })
const fps = [60, 75, 120, 141, 144, 165, 237].map((n) => o(`${n} fps`, [0x10835002, n]))

// Setting IDs and values from NVIDIA's NvApiDriverSettings.h and Profile Inspector's reference.
const sections: { title: string; rows: Row[] }[] = [
  { title: 'Sync & latency', rows: [
    { key: 'llm', label: 'Low Latency Mode', desc: 'On queues one frame; Ultra submits just in time. Only helps when the GPU is the bottleneck.', ids: [0x0005f543, 0x10835000, 0x007ba09e],
      opts: [o('Off', [0x0005f543, 0], [0x10835000, 0]), o('On', [0x0005f543, 1], [0x10835000, 0], [0x007ba09e, 1]), o('Ultra', [0x0005f543, 2], [0x10835000, 1], [0x007ba09e, 1])] },
    { key: 'vsync', label: 'Vertical sync', desc: 'Force off for lowest latency; with G-SYNC, on plus a frame cap avoids tearing.', ids: [0x00a879cf],
      opts: [o('Use the 3D application setting', [0x00a879cf, 0x60925292]), o('Off', [0x00a879cf, 0x08416747]), o('On', [0x00a879cf, 0x47814940]), o('Fast', [0x00a879cf, 0x18888888]), o('Adaptive (half refresh)', [0x00a879cf, 0x32610244])] },
    { key: 'fps', label: 'Max frame rate', desc: 'Driver frame limiter. Cap a few fps under refresh to stay inside the G-SYNC range.', ids: [0x10835002], opts: [o('Off', [0x10835002, 0]), ...fps] },
    { key: 'vrr', label: 'G-SYNC', desc: 'Variable refresh mode.', ids: [0x1194f158], opts: [o('Off', [0x1194f158, 0]), o('Fullscreen only', [0x1194f158, 1]), o('Fullscreen and windowed', [0x1194f158, 2])] },
    { key: 'refresh', label: 'Preferred refresh rate', desc: 'Highest available stops games starting at 60 Hz.', ids: [0x0064b541], opts: [o('Application-controlled', [0x0064b541, 0]), o('Highest available', [0x0064b541, 1])] },
  ] },
  { title: 'Textures', rows: [
    { key: 'texq', label: 'Texture filtering quality', desc: 'High performance trades a little sharpness at grazing angles for fps.', ids: [0x00ce2691],
      opts: [o('High quality', [0x00ce2691, 0xfffffff6]), o('Quality', [0x00ce2691, 0]), o('Performance', [0x00ce2691, 0x0a]), o('High performance', [0x00ce2691, 0x14])] },
    { key: 'aniso', label: 'Anisotropic filtering', desc: 'Nearly free on modern GPUs.', ids: [0x10d2bb16, 0x101e61a9],
      opts: [o('Application-controlled', [0x10d2bb16, 0]), ...[2, 4, 8, 16].map((n) => o(`${n}x`, [0x10d2bb16, 1], [0x101e61a9, n]))] },
    { key: 'lod', label: 'Negative LOD bias', desc: 'Clamp stops shimmering when the game asks for sharper mipmaps.', ids: [0x0019bb68], opts: [o('Allow', [0x0019bb68, 0]), o('Clamp', [0x0019bb68, 1])] },
  ] },
  { title: 'Shader cache', rows: [
    { key: 'shader', label: 'Shader cache size', desc: 'A full cache recompiles shaders mid-game, which is stutter.', ids: [0x00ac8497],
      opts: [o('Disabled', [0x00ac8497, 0]), o('1 GB', [0x00ac8497, 0x400]), o('4 GB', [0x00ac8497, 0x1000]), o('10 GB', [0x00ac8497, 0x2800]), o('100 GB', [0x00ac8497, 0x19000]), o('Unlimited', [0x00ac8497, 0xffffffff])] },
  ] },
  { title: 'Power & threading', rows: [
    { key: 'power', label: 'Power management mode', desc: 'Prefer maximum performance stops clocks dropping between frames.', ids: [0x1057eb71], opts: [o('Adaptive', [0x1057eb71, 0]), o('Prefer maximum performance', [0x1057eb71, 1]), o('Optimal power', [0x1057eb71, 5])] },
    { key: 'thread', label: 'Threaded optimization', desc: 'OpenGL driver work on a second thread. Auto is usually right on 4 threads.', ids: [0x20c1221e], opts: [o('Auto', [0x20c1221e, 0]), o('On', [0x20c1221e, 1]), o('Off', [0x20c1221e, 2])] },
    { key: 'prerender', label: 'Max pre-rendered frames', desc: 'Frames the CPU may queue ahead of the GPU.', ids: [0x007ba09e], opts: [o('Use the 3D application setting', [0x007ba09e, 0]), ...[1, 2, 3, 4].map((n) => o(String(n), [0x007ba09e, n]))] },
    { key: 'p2', label: 'CUDA force P2 state', desc: 'Off lets compute work use full memory clocks.', ids: [0x50166c5e], opts: [o('Off', [0x50166c5e, 0]), o('On', [0x50166c5e, 1])] },
  ] },
]

const DEFAULT = 'default'
const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`

export default function NvidiaProfile() {
  const settings = useSettings()
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [profile, setProfile] = useState<string | null>(null)
  const [values, setValues] = useState<DriverSetting[]>([])
  const [apps, setApps] = useState<string[]>([])
  const [staged, setStaged] = useState<Map<number, Value>>(new Map())
  const [filter, setFilter] = useState('')
  const [exe, setExe] = useState('')
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setProfiles(await api.nvProfiles())
      setValues(await api.nvSettings(profile))
      setApps(profile ? await api.nvApps(profile) : [])
      setStaged(new Map())
    } catch (e) {
      setMsg({ tone: 'bad', text: String(e) })
    }
  }, [profile])
  useEffect(() => { load() }, [load])

  const byId = useMemo(() => new Map(values.map((v) => [v.id, v])), [values])
  const effective = (id: number): Value => staged.get(id) ?? (byId.get(id)?.user_set ? byId.get(id)!.value : missing)
  const choice = (r: Row) => {
    if (r.ids.every((id) => effective(id).type === 'missing')) return DEFAULT
    const match = (op: Opt) => op.set.every(([id, v]) => sameValue(effective(id), dword(v)))
    let i = r.opts.findIndex(match)
    // Profiles written by other tools often set only the primary ID of a combined setting.
    if (i < 0) i = r.opts.findIndex((op) => sameValue(effective(op.set[0][0]), dword(op.set[0][1])) && op.set.length > 1)
    return i < 0 ? 'custom' : String(i)
  }
  const stage = (pairs: [number, Value][]) => setStaged((s) => {
    const next = new Map(s)
    for (const [id, v] of pairs) next.set(id, v)
    return next
  })
  const pick = (r: Row, val: string) => {
    if (val === DEFAULT) return stage(r.ids.map((id) => [id, missing]))
    const op = r.opts[Number(val)]
    stage(r.ids.map((id) => {
      const hit = op.set.find(([i]) => i === id)
      return [id, hit ? dword(hit[1]) : missing]
    }))
  }
  const changes = [...staged].filter(([id, v]) => !sameValue(v, byId.get(id)?.user_set ? byId.get(id)!.value : missing))
  const apply = async (label: string, list: ChangeIn[]) => {
    setBusy(true)
    try {
      const b = await api.apply(label, list, settings.restorePoint)
      setMsg(b.state === 'applied' ? { tone: 'good', text: `${b.entries.length} driver setting${b.entries.length === 1 ? '' : 's'} written. Restart the game to pick them up.` } : { tone: 'bad', text: `Rolled back: ${b.error}` })
      await load()
    } catch (e) {
      setMsg({ tone: 'bad', text: String(e) })
    } finally {
      setBusy(false)
    }
  }
  const applyStaged = () => apply(`NVIDIA ${profile ?? 'global'} profile`, changes.map(([setting, value]) => ({ target: { kind: 'nvidia', profile, setting }, value })))

  const importNip = async () => {
    const path = inTauri ? await (await import('@tauri-apps/plugin-dialog')).open({ filters: [{ name: 'NVIDIA Profile Inspector', extensions: ['nip'] }] }) : 'preview.nip'
    if (typeof path !== 'string') return
    try {
      const plan = await api.nipRead(path)
      await apply(`Import ${path.split(/[\\/]/).pop()}`, plan)
    } catch (e) {
      setMsg({ tone: 'bad', text: String(e) })
    }
  }
  const exportNip = async () => {
    const path = inTauri ? await (await import('@tauri-apps/plugin-dialog')).save({ defaultPath: `${profile ?? 'Base Profile'}.nip`, filters: [{ name: 'NVIDIA Profile Inspector', extensions: ['nip'] }] }) : 'preview.nip'
    if (!path) return
    try {
      const n = await api.nipWrite(path, [profile])
      setMsg({ tone: 'good', text: `Exported ${n} setting${n === 1 ? '' : 's'} to ${path}` })
    } catch (e) {
      setMsg({ tone: 'bad', text: String(e) })
    }
  }
  const addExe = async () => {
    const name = exe.trim()
    if (!name) return
    const target = profile ?? name.replace(/\.exe$/i, '')
    try {
      await api.nvAddApp(target, name)
      setExe('')
      if (profile) await load()
      else setProfile(target)
    } catch (e) {
      setMsg({ tone: 'bad', text: String(e) })
    }
  }

  const advanced = values.filter((v) => !filter || v.name.toLowerCase().includes(filter.toLowerCase()) || hex(v.id).toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-gradient-to-b from-primary/20 to-primary/5 text-primary"><SlidersHorizontal className="size-6" /></div>
          <div>
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight">NVIDIA profile</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Driver settings for every game, like NVIDIA Profile Inspector. Global applies everywhere; a game profile overrides it for that game.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={importNip} disabled={busy}><Upload className="size-4" />Import .nip</Button>
          <Button variant="outline" className="gap-2" onClick={exportNip}><Download className="size-4" />Export .nip</Button>
        </div>
      </header>

      <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="text-sm text-muted-foreground">Profile</span>
        <Select value={profile ?? '\u0000global'} onValueChange={(v) => setProfile(v === '\u0000global' ? null : v)}>
          <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={'\u0000global'}>Global (Base Profile)</SelectItem>
            {profiles.filter((p) => p.name !== 'Base Profile').map((p) => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {profile && <span className="truncate font-mono text-xs text-muted-foreground">{apps.join(', ') || 'no executables'}</span>}
        <div className="ml-auto flex items-center gap-2">
          <Input value={exe} onChange={(e) => setExe(e.target.value)} placeholder={profile ? 'Add game .exe' : 'New profile for game .exe'} className="h-8 w-56 font-mono text-xs" />
          <Button size="sm" variant="outline" className="gap-1.5" onClick={addExe} disabled={!exe.trim()}><Plus className="size-3.5" />{profile ? 'Add' : 'Create'}</Button>
        </div>
      </div>

      {msg && <div className={cn('rounded-lg border px-4 py-2.5 text-sm', msg.tone === 'good' ? 'border-good/30 bg-good/5 text-good' : 'border-bad/30 bg-bad/5 text-bad')}>{msg.text}</div>}

      <Tabs defaultValue="friendly">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="friendly">Settings</TabsTrigger>
            <TabsTrigger value="advanced">Advanced ({values.length})</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-3">
            {!!changes.length && <span className="text-sm text-warn">{changes.length} pending</span>}
            <Button variant="ghost" disabled={!staged.size} onClick={() => setStaged(new Map())}>Discard</Button>
            <Button disabled={!changes.length || busy} onClick={applyStaged}>{busy ? 'Applying…' : 'Apply'}</Button>
          </div>
        </div>

        <TabsContent value="friendly" className="mt-4 grid grid-cols-2 gap-5">
          {sections.map((sec) => (
            <section key={sec.title} className="panel divide-y">
              <h2 className="px-5 py-3 text-sm font-medium">{sec.title}</h2>
              {sec.rows.map((r) => {
                const c = choice(r)
                const dirty = r.ids.some((id) => staged.has(id) && !sameValue(staged.get(id), byId.get(id)?.user_set ? byId.get(id)!.value : missing))
                return (
                  <div key={r.key} className="flex items-center gap-4 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        {r.label}
                        {dirty && <span className="size-1.5 rounded-full bg-warn" />}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{r.desc}</div>
                    </div>
                    <Select value={c} onValueChange={(v) => pick(r, v)}>
                      <SelectTrigger className="w-52 shrink-0" aria-label={r.label}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT}>{profile ? 'Use global setting' : 'Driver default'}</SelectItem>
                        {c === 'custom' && <SelectItem value="custom">Custom ({r.ids.map((id) => fmtValue(effective(id))).join(' / ')})</SelectItem>}
                        {r.opts.map((op, i) => <SelectItem key={op.label} value={String(i)}>{op.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )
              })}
            </section>
          ))}
        </TabsContent>

        <TabsContent value="advanced" className="mt-4 space-y-3">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or hex ID" className="w-80" />
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-[110px_1fr_160px_160px_150px] gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
              <span>Setting ID</span><span>Name</span><span>Value</span><span>Driver default</span><span>New value</span>
            </div>
            <div className="max-h-[520px] divide-y overflow-y-auto">
              {advanced.map((s) => <AdvancedRow key={s.id} s={s} staged={staged.get(s.id)} onStage={(v) => stage([[s.id, v]])} />)}
              {!advanced.length && <div className="px-4 py-8 text-center text-sm text-muted-foreground">No settings on this profile.</div>}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function AdvancedRow({ s, staged, onStage }: { s: DriverSetting; staged?: Value; onStage: (v: Value) => void }) {
  const [text, setText] = useState('')
  const commit = () => {
    const t = text.trim()
    if (!t) return
    const n = t.toLowerCase().startsWith('0x') ? parseInt(t.slice(2), 16) : Number(t)
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) onStage(dword(n))
    else if (s.value.type === 'string') onStage({ type: 'string', data: t })
    setText('')
  }
  return (
    <div className="grid grid-cols-[110px_1fr_160px_160px_150px] items-center gap-3 px-4 py-1.5 font-mono text-xs">
      <span className="text-muted-foreground">{hex(s.id)}</span>
      <span className="flex items-center gap-2 truncate font-sans text-sm">
        {s.user_set && <span className="size-1.5 shrink-0 rounded-full bg-primary" title="Set on this profile" />}
        {s.name || 'Unknown setting'}
      </span>
      <span className={cn('truncate', staged && 'text-muted-foreground line-through')}>{fmtValue(s.value)}</span>
      <span className="truncate text-muted-foreground">{fmtValue(s.predefined)}</span>
      {staged ? (
        <button className="truncate text-left text-warn" onClick={() => onStage(s.user_set ? s.value : missing)} title="Click to undo">{fmtValue(staged)}</button>
      ) : (
        <div className="flex gap-1">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} placeholder="0x…" className="h-6 w-20 rounded border bg-background px-1.5" aria-label={`New value for ${hex(s.id)}`} />
          {s.user_set && <button className="text-muted-foreground hover:text-foreground" onClick={() => onStage(missing)}>reset</button>}
        </div>
      )}
    </div>
  )
}
