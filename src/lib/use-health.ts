import { useEffect, useMemo, useState } from 'react'
import { api, catalog, fmtTarget, type Finding, type FrameStats, type Target } from './api'
import { lastFramesKey, pcHealth } from './health'

const moduleByTarget = new Map(catalog.tweak.flatMap((t) => t.changes.map((c) => [fmtTarget(c.target), t.module] as const)))
const moduleOf = (t: Target) => moduleByTarget.get(fmtTarget(t))

function lastFrames(): FrameStats | null {
  try {
    return JSON.parse(localStorage.getItem(lastFramesKey) ?? 'null') as FrameStats | null
  } catch {
    return null
  }
}

/** Live audit findings plus the PC health score; `key` re-reads after navigation. */
export function usePcHealth(key?: unknown) {
  const [findings, setFindings] = useState<Finding[] | null>(null)
  useEffect(() => {
    api.auditCached().then((r) => setFindings(r.findings)).catch(() => setFindings([]))
  }, [key])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- key re-reads the last frame capture
  const health = useMemo(() => (findings ? pcHealth(findings, moduleOf, lastFrames()) : null), [findings, key])
  return { findings: findings ?? [], health }
}
