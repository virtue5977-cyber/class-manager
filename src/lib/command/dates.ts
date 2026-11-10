import { addDays } from '../schoolDays'

const DAYS = ['월', '화', '수', '목', '금', '토', '일']
const pad = (n: number) => String(n).padStart(2, '0')
/** 월=0 … 일=6 */
const dow = (ymd: string) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7

function weekdayWord(w: string): number {
  const m = /^([월화수목금토일])(요일)?$/.exec(w)
  return m ? DAYS.indexOf(m[1]) : -1
}

function oneDate(words: string[], i: number, today: string): { date: string; used: number } | null {
  const w = words[i]
  if (!w) return null
  const rel: Record<string, number> = { 오늘: 0, 내일: 1, 모레: 2, 어제: -1, 그제: -2, 그저께: -2 }
  if (w in rel) return { date: addDays(today, rel[w]), used: 1 }
  let m = /^(\d{1,2})[/.](\d{1,2})\.?$/.exec(w)
  if (m) return { date: `${today.slice(0, 4)}-${pad(+m[1])}-${pad(+m[2])}`, used: 1 }
  m = /^(\d{1,2})일$/.exec(w)
  if (m) return { date: `${today.slice(0, 7)}-${pad(+m[1])}`, used: 1 }
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
export function parseDateWords(words: string[], i: number, today: string): { date?: string; time?: string; used: number } {
  const d = oneDate(words, i, today)
  const t = oneTime(words, i + (d?.used ?? 0))
  const out: { date?: string; time?: string; used: number } = { used: (d?.used ?? 0) + (t?.used ?? 0) }
  if (d) out.date = d.date
  if (t) out.time = t.time
  return out
}

/** '11/12(목)' */
export const shortDate = (ymd: string) => `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}(${DAYS[dow(ymd)]})`
