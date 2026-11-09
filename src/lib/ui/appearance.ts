/** 화면 설정(테마·글자 크기·강조색). 이 노트북에만 기억하고 백업에는 넣지 않는다. */
export const THEMES = [
  { id: 'warm', label: '기본(따뜻한 회색)', swatch: ['#f7f6f3', '#0a6fd6'] },
  { id: 'blue', label: '하늘', swatch: ['#e8f0fb', '#1d6fe0'] },
  { id: 'green', label: '숲', swatch: ['#e7f2ea', '#24784b'] },
  { id: 'mint', label: '민트', swatch: ['#e3f3f2', '#0b7a7c'] },
  { id: 'pink', label: '벚꽃', swatch: ['#fbecf1', '#c2416b'] },
  { id: 'purple', label: '라벤더', swatch: ['#f0ecfa', '#7357e8'] },
  { id: 'sand', label: '모래', swatch: ['#f8f1e2', '#b0610b'] },
  { id: 'dark', label: '어둡게', swatch: ['#202020', '#0a6fd6'] },
  { id: 'auto', label: '윈도우 설정 따라가기', swatch: ['#f7f6f3', '#202020'] },
] as const
export const SIZES = [
  { id: 'sm', label: '작게', zoom: 0.9 },
  { id: 'md', label: '보통', zoom: 1 },
  { id: 'lg', label: '크게', zoom: 1.1 },
  { id: 'xl', label: '아주 크게', zoom: 1.25 },
] as const
export const ACCENTS = [
  { id: 'auto', label: '테마에 맞춤', color: '' },
  { id: 'blue', label: '파랑', color: '#0a6fd6' },
  { id: 'indigo', label: '남색', color: '#4c5fd5' },
  { id: 'green', label: '초록', color: '#24784b' },
  { id: 'teal', label: '청록', color: '#0b7a7c' },
  { id: 'purple', label: '보라', color: '#7a5af5' },
] as const
export type ThemeId = (typeof THEMES)[number]['id']
export type SizeId = (typeof SIZES)[number]['id']
export type AccentId = (typeof ACCENTS)[number]['id']
export interface Appearance { theme: ThemeId; size: SizeId; accent: AccentId }

const KEY = 'cm.appearance'
export const DEFAULT_APPEARANCE: Appearance = { theme: 'warm', size: 'md', accent: 'auto' }

export function readAppearance(): Appearance {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Appearance>
    return {
      theme: THEMES.some((t) => t.id === v.theme) ? v.theme! : DEFAULT_APPEARANCE.theme,
      size: SIZES.some((s) => s.id === v.size) ? v.size! : DEFAULT_APPEARANCE.size,
      accent: ACCENTS.some((a) => a.id === v.accent) ? v.accent! : DEFAULT_APPEARANCE.accent,
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function applyAppearance(a: Appearance) {
  const root = document.documentElement
  if (a.theme === 'warm') delete root.dataset.theme
  else root.dataset.theme = a.theme
  if (a.accent === 'auto') delete root.dataset.accent
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

// 인쇄할 때는 어두운 테마여도 흰 종이에 검은 글자로 나오게 잠시 테마를 뺀다.
if (typeof window !== 'undefined') {
  let saved: string | undefined
  window.addEventListener('beforeprint', () => {
    saved = document.documentElement.dataset.theme
    delete document.documentElement.dataset.theme
  })
  window.addEventListener('afterprint', () => {
    if (saved) document.documentElement.dataset.theme = saved
  })
}
