import { textEm } from './widths'

/** 양식 상수(보내 주신 생성기의 hwpx 분석값) */
export const MODES = {
  B4: { pw: 257, ph: 364, k: 1, pageW: 72852, pageH: 103180 },
  A4: { pw: 210, ph: 297, k: 0.7956, pageW: 59528, pageH: 84188 },
} as const
export type PaperMode = keyof typeof MODES
const SAFE = 0.985

/** 셀 안쪽 가로폭(pt) × 여유 */
export const widthPt = (mode: PaperMode) => ((65174 * MODES[mode].k - 282) / 100) * SAFE

export interface FitOpts {
  basePt: number
  baseSp: number
  auto: boolean
  minSp: number
  minPt: number
  widthPt: number
}
export interface Fit {
  pt: number
  sp: number
  natural: number
  width: number
  over: boolean
  state: 'ok' | 'sp' | 'pt' | 'over'
  overChars?: number
}

export const bodyOpts = (mode: PaperMode, o: { auto?: boolean; minSp?: number; minPt?: number } = {}): FitOpts => ({ basePt: 12, baseSp: 0, auto: o.auto ?? true, minSp: Math.min(0, o.minSp ?? -15), minPt: Math.min(o.minPt ?? 10, 12), widthPt: widthPt(mode) })
export const titleOpts = (mode: PaperMode, o: { auto?: boolean; minSp?: number; minPt?: number } = {}): FitOpts => ({ basePt: 14, baseSp: -1, auto: o.auto ?? true, minSp: Math.min(0, o.minSp ?? -15), minPt: Math.min(o.minPt ?? 10, 14), widthPt: widthPt(mode) })

/** 한 줄에 맞추기: 자간을 먼저(기본→최소), 그래도 넘치면 글자 크기를 0.5pt씩. */
export function fitLine(text: string, o: FitOpts): Fit {
  const n = [...text].length
  const em = textEm(text)
  const at = (pt: number, sp: number) => ({ pt, sp, natural: em * pt, width: em * pt + (n * pt * sp) / 100 })
  let r = at(o.basePt, o.baseSp)
  if (!text || r.width <= o.widthPt) return { ...r, over: false, state: 'ok' }
  const overBy = (x: { width: number }) => Math.max(1, Math.ceil((x.width - o.widthPt) / (x.width / Math.max(n, 1))))
  if (!o.auto) return { ...r, over: true, state: 'over', overChars: overBy(r) }
  for (let pt = o.basePt; pt >= o.minPt - 1e-9; pt -= 0.5) {
    let sp = Math.floor(((o.widthPt - em * pt) / (n * pt)) * 100)
    if (sp > o.baseSp) sp = o.baseSp
    if (sp >= o.minSp) return { ...at(pt, sp), over: false, state: pt === o.basePt ? 'sp' : 'pt' }
  }
  r = at(o.minPt, o.minSp)
  return { ...r, over: true, state: 'over', overChars: overBy(r) }
}

/** 16줄(번호 '1. ' 포함 폭으로) 맞춤 결과 */
export const linesFit = (lines: string[], mode: PaperMode, o?: Parameters<typeof bodyOpts>[1]) => lines.map((l, i) => fitLine(l ? `${i + 1}. ${l}` : '', bodyOpts(mode, o)))

/**
 * AI에게 줄 한 문장 글자 수(띄어쓰기 포함): 12pt·자간 0에서 한 줄을 거의 채우는 길이 ~ 자간을 조금 줄여 들어가는 길이.
 * 보통 문장은 한글 85%·띄어쓰기 15% 정도라 글자당 평균 0.9em으로 본다.
 */
export function lineTarget(mode: PaperMode): { min: number; max: number } {
  const cap = (widthPt(mode) / 12 - 1.18) / 0.9
  return { min: Math.round(cap) - 2, max: Math.round(cap * 1.1) }
}
