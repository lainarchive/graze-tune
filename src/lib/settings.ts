import { useSyncExternalStore } from 'react'

export const accents = [
  { id: 'blue', label: 'Blue', swatch: '#6aa8ff' },
  { id: 'cyan', label: 'Cyan', swatch: '#3fd0e0' },
  { id: 'violet', label: 'Violet', swatch: '#a68bff' },
  { id: 'ember', label: 'Ember', swatch: '#ff8a4c' },
  { id: 'rose', label: 'Rose', swatch: '#ff6b9a' },
  { id: 'mono', label: 'Mono', swatch: '#d4d8dd' },
] as const

export const bases = [
  { id: 'graphite', label: 'Graphite', bg: '#16181b', side: '#131518', card: '#1d2024' },
  { id: 'midnight', label: 'Midnight', bg: '#0f1420', side: '#0c101a', card: '#151c2b' },
  { id: 'oled', label: 'OLED black', bg: '#000000', side: '#000000', card: '#0d0e10' },
] as const

export type Settings = {
  mode: 'dark' | 'light' | 'system'
  accent: (typeof accents)[number]['id']
  base: (typeof bases)[number]['id']
  reduceMotion: boolean
  restorePoint: boolean
  autoRollback: boolean
  benchSeconds: 30 | 60 | 120
  startWithWindows: boolean
}

const defaults: Settings = {
  mode: 'dark', accent: 'blue', base: 'graphite', reduceMotion: false,
  restorePoint: true, autoRollback: true, benchSeconds: 60, startWithWindows: false,
}

const KEY = 'graze-tune.settings'
const listeners = new Set<() => void>()
let current: Settings = load()

function load(): Settings {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) }
  } catch {
    return defaults
  }
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

export function isDark(s: Settings) {
  return s.mode === 'dark' || (s.mode === 'system' && systemDark())
}

function apply(s: Settings) {
  const el = document.documentElement
  el.classList.toggle('dark', isDark(s))
  el.dataset.accent = s.accent
  el.dataset.base = s.base
  el.dataset.motion = s.reduceMotion ? 'reduce' : 'full'
}

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  localStorage.setItem(KEY, JSON.stringify(current))
  apply(current)
  listeners.forEach((l) => l())
}

apply(current)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => current.mode === 'system' && setSettings({}))

export function useSettings() {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => current)
}
