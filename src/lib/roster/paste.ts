import type { RosterRow } from './roster'
import { DEFAULT_MAP, mapHeader, normDate, normGender, normPhone, ROSTER_COLUMNS, type RosterKey } from './columns'

/** 원문 줄 번호(1부터)를 열거되지 않는 속성으로 가진 행. */
export type TsvRow = string[] & { readonly line?: number }

function withLine(cells: string[], line: number): TsvRow {
  return Object.defineProperty(cells, 'line', { value: line, enumerable: false }) as TsvRow
}

/** 엑셀 클립보드 형식(TSV)을 해석한다. 따옴표 셀 안의 탭·줄바꿈은 보존한다. */
export function parseTsv(text: string): TsvRow[] {
  const rows: TsvRow[] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let rowLine = 1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else {
        if (ch === '\n') line++
        if (ch !== '\r') cell += ch
      }
      continue
    }
    if (ch === '"' && cell === '') quoted = true
    else if (ch === '\t') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(withLine(row, rowLine))
      row = []
      cell = ''
      line++
      rowLine = line
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(withLine(row, rowLine))
  }
  return rows
}

export interface PasteResult {
  rows: RosterRow[]
  errors: { line: number; message: string }[]
}

/**
 * 붙여넣기·엑셀 파일 공용. 첫 줄이 머리글이면 머리글로 열을 찾고(나이스 명렬표의 학년·반·비고는 건너뜀),
 * 머리글이 없으면 양식 순서(번호, 이름, 성별, 생년월일, 전화번호, 보호자 이름, 보호자 관계, 보호자 연락처)로 읽는다.
 */
export function toRosterRows(cells: string[][]): PasteResult {
  const rows: RosterRow[] = []
  const errors: PasteResult['errors'] = []
  const seen = new Set<number>()
  const firstFilled = cells.findIndex((r) => r.some((v) => (v ?? '').trim() !== ''))
  const header = firstFilled >= 0 ? mapHeader(cells[firstFilled]) : null
  const map: Partial<Record<RosterKey, number>> = header ?? DEFAULT_MAP
  cells.forEach((raw, idx) => {
    const line = (raw as TsvRow).line ?? idx + 1
    const c = raw.map((v) => (v ?? '').trim())
    if (c.every((v) => v === '')) return
    if (idx === firstFilled && (header || !/^\d/.test(c[0] ?? ''))) return // 머리글 줄
    const get = (k: RosterKey) => (map[k] === undefined ? '' : (c[map[k]!] ?? ''))
    const num = get('number').replace(/\.0+$/, '')
    if (!/^\d+$/.test(num) || Number(num) < 1) {
      errors.push({ line, message: '번호는 1 이상의 정수여야 합니다.' })
      return
    }
    const number = Number(num)
    if (seen.has(number)) {
      errors.push({ line, message: `번호 ${number}이(가) 중복됩니다.` })
      return
    }
    seen.add(number)
    rows.push({
      number,
      fields: {
        name: get('name'),
        gender: normGender(get('gender')),
        birth_date: normDate(get('birth_date')),
        phone: normPhone(get('phone')),
        guardian_name: get('guardian_name'),
        guardian_relation: get('guardian_relation'),
        guardian_phone: normPhone(get('guardian_phone')),
      },
    })
  })
  return { rows, errors }
}

/** 양식 내려받기: 머리글 + 지금 명단(있는 값 채움) */
export function rosterTemplate(students: { number: number; name: string; gender?: string; birth_date: string; phone: string; guardian_name: string; guardian_relation?: string; guardian_phone: string }[]): string[][] {
  return [
    ROSTER_COLUMNS.map((c) => c.label),
    ...students.map((s) => [String(s.number), s.name, s.gender ?? '', s.birth_date, s.phone, s.guardian_name, s.guardian_relation ?? '', s.guardian_phone]),
  ]
}
