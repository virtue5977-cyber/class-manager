import { addDays } from '../schoolDays'

const DAYS = ['월', '화', '수', '목', '금', '토', '일']
const pad = (n: number) => String(n).padStart(2, '0')
/** 월=0 … 일=6 */
const dow = (ymd: string) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7

/** '월'·'월요일'. 한 글자 '일'은 '일(하루·일)'과 헷갈려 '일요일'만 받는다. */
function weekdayWord(w: string): number {
  const m = /^([월화수목금토일])(요일)?$/.exec(w)
  if (!m || (m[1] === '일' && !m[2])) return -1
  return DAYS.indexOf(m[1])
}

/** 실제로 있는 날짜인지(2/30, 11/31 거절) */
function realDate(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}

function oneDate(words: string[], i: number, today: string, prefer: Prefer): { date?: string; invalid?: string; used: number } | null {
  const w = words[i]
  if (!w) return null
  const rel: Record<string, number> = { 오늘: 0, 내일: 1, 모레: 2, 어제: -1, 그제: -2, 그저께: -2 }
  if (w in rel) return { date: addDays(today, rel[w]), used: 1 }
  const y = +today.slice(0, 4)
  // 연도를 쓰지 않으면 올해(사용자 요청: 지난해·다음 해로 넘기지 않는다)
  const ymd = (yy: number, mm: number, dd: number, used: number) => {
    const d = realDate(yy, mm, dd)
    return d ? { date: d, used } : { invalid: words.slice(i, i + used).join(' '), used }
  }
  // 2026-11-11 · 2026.11.11 · 2026/11/11
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/.exec(w)
  if (m) return ymd(+m[1], +m[2], +m[3], 1)
  // 2026년11월11일 · 11월11일 (붙여 씀)
  m = /^(?:(\d{4})년)?(\d{1,2})월(\d{1,2})일$/.exec(w)
  if (m && +m[2] >= 1 && +m[2] <= 12) return ymd(m[1] ? +m[1] : y, +m[2], +m[3], 1)
  // 2026년 11월 11일 · 11월 11일 (띄어 씀)
  const yw = /^(\d{4})년$/.exec(w)
  const j0 = yw ? 1 : 0
  const mw = /^(\d{1,2})월$/.exec(words[i + j0] ?? '')
  const dw = /^(\d{1,2})일$/.exec(words[i + j0 + 1] ?? '')
  if (mw && dw && +mw[1] >= 1 && +mw[1] <= 12) return ymd(yw ? +yw[1] : y, +mw[1], +dw[1], j0 + 2)
  const mdw = yw && /^(\d{1,2})월(\d{1,2})일$/.exec(words[i + 1] ?? '')
  if (mdw) return ymd(+yw![1], +mdw[1], +mdw[2], 2)
  // 11/12 · 11.12 · 1112 · 0305 (13 이상의 '월'·37.5 같은 체온은 날짜가 아님)
  m = /^(\d{1,2})[/.](\d{1,2})\.?$/.exec(w)
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
    void prefer
    return ymd(y, +m[1], +m[2], 1)
  }
  // 1111 · 0305: 있는 날짜일 때만 날짜(1234·1131 같은 숫자는 글로 둔다)
  m = /^(\d{2})(\d{2})$/.exec(w)
  if (m && realDate(y, +m[1], +m[2])) return { date: realDate(y, +m[1], +m[2])!, used: 1 }
  m = /^(\d{1,2})일$/.exec(w)
  if (m && +m[1] >= 1 && +m[1] <= 31) {
    let mm = +today.slice(5, 7)
    // 출결·상담: 오늘보다 뒤의 날이면 지난달(해는 넘기지 않음)
    if (prefer === 'past' && +m[1] > +today.slice(8, 10) && mm > 1) mm -= 1
    return ymd(y, mm, +m[1], 1)
  }
  const monday = addDays(today, -dow(today))
  if (w === '다음주' || w === '이번주') {
    const k = weekdayWord(words[i + 1] ?? '')
    if (k < 0) return null
    return { date: addDays(monday, k + (w === '다음주' ? 7 : 0)), used: 2 }
  }
  const k = weekdayWord(w)
  if (k >= 0) {
    // 이번 주 그 요일, 이미 지났으면 다음 주
    const d = addDays(monday, k)
    // 출결·상담은 지난(또는 오늘) 그 요일, 일정·할 일은 오늘 이후 그 요일
    if (prefer === 'past') return { date: d > today ? addDays(d, -7) : d, used: 1 }
    return { date: d < today ? addDays(d, 7) : d, used: 1 }
  }
  return null
}

function oneTime(words: string[], i: number): { time: string; used: number } | null {
  const w = words[i]
  if (!w) return null
  let m = /^(\d{1,2}):(\d{2})$/.exec(w)
  if (m) return { time: `${pad(+m[1])}:${m[2]}`, used: 1 }
  let j = i
  let ampm: '오전' | '오후' | null = null
  if (w === '오전' || w === '오후') {
    ampm = w
    j++
  }
  m = /^(\d{1,2})시$/.exec(words[j] ?? '')
  if (!m) return null
  let h = +m[1]
  j++
  let min = 0
  const next = words[j] ?? ''
  const mm = /^(\d{1,2})분$/.exec(next)
  if (next === '반') {
    min = 30
    j++
  } else if (mm) {
    min = +mm[1]
    j++
  }
  // 오전·오후가 없으면 학교 시간대로: 1~6시는 오후
  if (ampm === '오후' && h < 12) h += 12
  if (!ampm && h >= 1 && h <= 6) h += 12
  return { time: `${pad(h)}:${pad(min)}`, used: j - i }
}

/** words[i]부터 날짜(와 이어지는 시각)를 읽는다. 못 읽으면 used 0. */
export interface DateWords {
  date?: string
  time?: string
  /** 날짜처럼 보이지만 없는 날(11/31) */
  invalid?: string
  used: number
  /** 그중 날짜 말이 쓴 낱말 수 */
  dateUsed?: number
}
export type Prefer = 'past' | 'future'
export function parseDateWords(words: string[], i: number, today: string, prefer: Prefer = 'future'): DateWords {
  const d = oneDate(words, i, today, prefer)
  const t = d?.invalid ? null : oneTime(words, i + (d?.used ?? 0))
  const out: DateWords = { used: (d?.used ?? 0) + (t?.used ?? 0) }
  if (d?.date) out.date = d.date
  if (d?.invalid) out.invalid = d.invalid
  if (t) out.time = t.time
  if (d && t) out.dateUsed = d.used
  return out
}

/** '11/12(목)' */
export const shortDate = (ymd: string) => `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}(${DAYS[dow(ymd)]})`
