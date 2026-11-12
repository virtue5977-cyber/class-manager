/** 화면 배치(이 기기): 왼쪽 메뉴 순서·숨기기, 홈 오른쪽 칸 순서·숨기기, 사이드바 너비. */
import { useSyncExternalStore } from 'react'

export type PanelKey = 'notice' | 'todo' | 'upcoming' | 'notes' | 'meal'
export interface PrefItem<K extends string = string> {
  key: K
  hidden: boolean
  /** 홈 칸만: 오른쪽(기본) 또는 왼쪽 탭 */
  place?: 'side' | 'tab'
}
export type PanelPlace = 'side' | 'tab' | 'hidden'
export interface LayoutPrefs {
  menu: PrefItem[]
  panels: PrefItem<PanelKey>[]
  sidebarW: number
  /** 오른쪽 칸 높이(px). 없으면 내용에 맞춤 */
  panelH: Partial<Record<PanelKey, number>>
}

/** 기본 순서: 달력 다음에 학급(사용자 요청 11/11) */
export const DEFAULT_MENU = ['/', '/calendar', '/class/roster', '/attendance', '/counseling', '/notes']
export const DEFAULT_PANELS: PanelKey[] = ['notice', 'todo', 'upcoming', 'notes', 'meal']
/** 처음(또는 예전 저장값에 없을 때) 왼쪽 탭에 두는 칸 */
const DEFAULT_TAB = new Set<PanelKey>(['notice'])
export const PANEL_LABEL: Record<PanelKey, string> = { notice: '전달사항', todo: '할 일', upcoming: '다가오는 일정', notes: '노트함', meal: '오늘 급식' }
const KEY = 'watson.layout'
const LOCKED = new Set(['/'])

export function mergeOrder<K extends string>(saved: PrefItem<K>[] | undefined, defaults: K[]): PrefItem<K>[] {
  const ok = (saved ?? []).filter((x) => defaults.includes(x.key))
  const seen = new Set(ok.map((x) => x.key))
  return [...ok.map((x) => ({ key: x.key, hidden: !!x.hidden && !LOCKED.has(x.key), ...(x.place === 'tab' ? { place: 'tab' as const } : {}) })), ...defaults.filter((k) => !seen.has(k)).map((key) => ({ key, hidden: false }))]
}
export function movePref<K extends string>(list: PrefItem<K>[], key: K, dir: -1 | 1): PrefItem<K>[] {
  const i = list.findIndex((x) => x.key === key)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}
export function togglePref<K extends string>(list: PrefItem<K>[], key: K, hidden: boolean): PrefItem<K>[] {
  return list.map((x) => (x.key === key ? { ...x, hidden: LOCKED.has(key) ? false : hidden } : x))
}
function withDefaultTabs(saved: PrefItem<PanelKey>[] | undefined): PrefItem<PanelKey>[] {
  const had = new Set((saved ?? []).map((x) => x.key))
  return mergeOrder(saved, DEFAULT_PANELS).map((x) => (!had.has(x.key) && DEFAULT_TAB.has(x.key) ? { ...x, place: 'tab' as const } : x))
}
export const panelPlace = (x: PrefItem): PanelPlace => (x.hidden ? 'hidden' : x.place === 'tab' ? 'tab' : 'side')
export function setPlace<K extends string>(list: PrefItem<K>[], key: K, place: PanelPlace): PrefItem<K>[] {
  return list.map((x) => (x.key === key ? { key: x.key, hidden: place === 'hidden', ...(place === 'tab' ? { place: 'tab' as const } : {}) } : x))
}
/** 칸을 place 쪽의 before 칸 앞(null이면 그 쪽 끝)으로 옮긴다. 다른 칸의 자리는 그대로. */
export function placePanel(list: PrefItem<PanelKey>[], key: PanelKey, place: 'side' | 'tab', before: PanelKey | null): PrefItem<PanelKey>[] {
  const me = list.find((x) => x.key === key)
  if (!me || before === key) return list
  const moved: PrefItem<PanelKey> = { key, hidden: false, ...(place === 'tab' ? { place: 'tab' as const } : {}) }
  const rest = list.filter((x) => x.key !== key)
  let at = before ? rest.findIndex((x) => x.key === before) : -1
  if (at < 0) {
    // 그 쪽 마지막 칸 뒤(그 쪽에 칸이 없으면 맨 끝)
    const lastSame = rest.map((x, i) => (panelPlace(x) === place ? i : -1)).filter((i) => i >= 0).pop()
    at = lastSame === undefined ? rest.length : lastSame + 1
  }
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}
const clampH = (h: unknown) => Math.min(900, Math.max(120, Number(h) || 0))
function readPanelH(v: unknown): LayoutPrefs['panelH'] {
  const out: LayoutPrefs['panelH'] = {}
  if (v && typeof v === 'object') for (const k of DEFAULT_PANELS) if (Number((v as Record<string, unknown>)[k]) > 0) out[k] = clampH((v as Record<string, unknown>)[k])
  return out
}
const clampW = (w: unknown) => Math.min(320, Math.max(160, Number(w) || 224))

let cache: LayoutPrefs | null = null
const listeners = new Set<() => void>()

export function readPrefs(): LayoutPrefs {
  let raw: Partial<LayoutPrefs> = {}
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    raw = {}
  }
  return { menu: mergeOrder(raw.menu, DEFAULT_MENU), panels: withDefaultTabs(raw.panels as PrefItem<PanelKey>[] | undefined), sidebarW: clampW(raw.sidebarW), panelH: readPanelH(raw.panelH) }
}
export function savePrefs(p: LayoutPrefs): void {
  const v = { ...p, sidebarW: clampW(p.sidebarW), panelH: readPanelH(p.panelH) }
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* 기억 못 해도 이번에는 적용 */
  }
  cache = v
  for (const l of listeners) l()
}
export function resetPrefs(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 무시 */
  }
  cache = null
  for (const l of listeners) l()
}
export function useLayoutPrefs(): LayoutPrefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => (cache ??= readPrefs()),
  )
}
