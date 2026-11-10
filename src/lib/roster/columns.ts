import type { StudentFields } from './roster'

export type RosterKey = 'number' | 'name' | 'gender' | 'birth_date' | 'phone' | 'guardian_name' | 'guardian_relation' | 'guardian_phone'

/** 명렬표 양식 열 순서(나이스 명렬표의 번호·이름 다음에 이어 붙이는 순서) */
export const ROSTER_COLUMNS: { key: RosterKey; label: string; aliases: string[] }[] = [
  { key: 'number', label: '번호', aliases: ['번호', '번', '출석번호'] },
  { key: 'name', label: '이름', aliases: ['이름', '성명', '학생명', '학생이름', '학생성명'] },
  { key: 'gender', label: '성별', aliases: ['성별'] },
  { key: 'birth_date', label: '생년월일', aliases: ['생년월일', '생일'] },
  { key: 'phone', label: '전화번호', aliases: ['전화번호', '학생전화번호', '학생연락처', '연락처', '휴대폰', '핸드폰', '연락처(hp)'] },
  { key: 'guardian_name', label: '보호자 이름', aliases: ['보호자이름', '보호자명', '보호자성함', '보호자성명', '보호자'] },
  { key: 'guardian_relation', label: '보호자 관계', aliases: ['보호자관계', '관계'] },
  { key: 'guardian_phone', label: '보호자 연락처', aliases: ['보호자연락처', '보호자번호', '보호자전화번호', '보호자전화', '보호자휴대폰'] },
]

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

/** 열 정의(명단 양식에서 만든 것 포함). builtin 아니면 값은 extra로. */
export interface ColumnSpec {
  key: string
  label: string
  aliases: string[]
  builtin?: boolean
}

/** 머리글 줄이면 열 위치를, 아니면 null. 모르는 열(학년·반·비고 등)은 건너뛴다.
 * 이름이 겹치면 기본 칸이 추가 칸보다 먼저 잡는다. */
export function mapHeader(row: string[], cols: ColumnSpec[] = ROSTER_COLUMNS): Record<string, number> | null {
  const ordered = [...cols.filter((c) => c.builtin !== false), ...cols.filter((c) => c.builtin === false)]
  const map: Record<string, number> = {}
  row.forEach((cell, i) => {
    const c = norm(cell)
    if (!c) return
    const col = ordered.find((k) => k.aliases.some((a) => norm(a) === c) && map[k.key] === undefined)
    if (col) map[col.key] = i
  })
  return map.number !== undefined ? map : null
}

export const DEFAULT_MAP: Record<RosterKey, number> = Object.fromEntries(ROSTER_COLUMNS.map((c, i) => [c.key, i])) as Record<RosterKey, number>

/** 기본 칸 값 다듬기(성별·날짜·전화) */
export function normField(key: string, v: string): string {
  if (key === 'gender') return normGender(v)
  if (key === 'birth_date') return normDate(v)
  if (key === 'phone' || key === 'guardian_phone') return normPhone(v)
  return v
}

export function normGender(v: string): string {
  const s = v.trim()
  if (/^(남|남자|남성|m|male)$/i.test(s)) return '남'
  if (/^(여|여자|여성|f|female)$/i.test(s)) return '여'
  return s
}

/** 2012.3.5 / 20120305 / 2012-03-05 / 엑셀 날짜 일련번호 → 2012-03-05 */
export function normDate(v: string): string {
  const s = v.trim()
  if (!s) return ''
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const m = s.match(/^(\d{4})\D?(\d{1,2})\D?(\d{1,2})\.?$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return s
}

/** 숫자만 있으면 010-1234-5678 꼴로. 엑셀이 앞 0을 지운 10자리 휴대폰도 살린다. */
export function normPhone(v: string): string {
  const s = v.trim()
  let d = s.replace(/\D/g, '')
  if (/^1[016789]\d{7,8}$/.test(d)) d = '0' + d
  if (/^01[016789]\d{7,8}$/.test(d)) return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  return s
}

type TextKeys = Exclude<{ [K in keyof StudentFields]-?: StudentFields[K] extends string | undefined ? K : never }[keyof StudentFields], undefined>
export type RosterPatch = Partial<Pick<StudentFields, Exclude<TextKeys, 'number'>>> & { extra?: Record<string, string> }
