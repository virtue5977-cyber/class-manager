/** 화면 설정(글자 크기·강조색). 이 노트북에만 기억하고 백업에는 넣지 않는다. */
export const SIZES = [
  { id: 'sm', label: '작게', zoom: 0.9 },
  { id: 'md', label: '보통', zoom: 1 },
  { id: 'lg', label: '크게', zoom: 1.1 },
  { id: 'xl', label: '아주 크게', zoom: 1.25 },
] as const
export const ACCENTS = [
  { id: 'blue', label: '파랑', color: '#097fe8' },
  { id: 'indigo', label: '남색', color: '#4c5fd5' },
  { id: 'green', label: '초록', color: '#24784b' },
  { id: 'teal', label: '청록', color: '#0b7a7c' },
  { id: 'purple', label: '보라', color: '#7a5af5' },
] as const
export type SizeId = (typeof SIZES)[number]['id']
export type AccentId = (typeof ACCENTS)[number]['id']
export interface Appearance { size: SizeId; accent: AccentId }

const KEY = 'cm.appearance'
export const DEFAULT_APPEARANCE: Appearance = { size: 'md', accent: 'blue' }

export function readAppearance(): Appearance {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Appearance>
    return {
      size: SIZES.some((s) => s.id === v.size) ? v.size! : DEFAULT_APPEARANCE.size,
      accent: ACCENTS.some((a) => a.id === v.accent) ? v.accent! : DEFAULT_APPEARANCE.accent,
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function applyAppearance(a: Appearance) {
  const root = document.documentElement
  if (a.accent === 'blue') delete root.dataset.accent
  else root.dataset.accent = a.accent
  const zoom = SIZES.find((s) => s.id === a.size)?.zoom ?? 1
  root.style.setProperty('--zoom', String(zoom))
  ;(document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = zoom === 1 ? '' : String(zoom)
}

export function saveAppearance(a: Appearance) {
  applyAppearance(a)
  try {
    localStorage.setItem(KEY, JSON.stringify(a))
  } catch {
    /* 저장 못 해도 지금 화면에는 적용된다 */
  }
}
