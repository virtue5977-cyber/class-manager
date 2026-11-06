import type { AppDB } from '../db/schema'
import { newRecord, save } from '../db/records'
import type { ClassRec, CleaningChartRec, CleaningColumn, CleaningRow } from '../db/types'

type Chart = Pick<CleaningChartRec, 'columns' | 'rows'>
const uid = () => crypto.randomUUID()
const sorted = <T extends { order: number }>(xs: T[]) => [...xs].sort((a, b) => a.order - b.order)
const renumber = <T extends { order: number }>(xs: T[]) => xs.map((x, i) => ({ ...x, order: i }))

export const DEFAULT_COLUMNS = (): CleaningColumn[] => [
  { id: uid(), name: '구역', type: 'text', order: 0 },
  { id: uid(), name: '담당 학생', type: 'students', order: 1 },
  { id: uid(), name: '비고', type: 'text', order: 2 },
]

export const columnsOf = (c: Chart) => sorted(c.columns)
export const rowsOf = (c: Chart) => sorted(c.rows)
export const studentsIn = (row: CleaningRow, colId: string): string[] => (Array.isArray(row.cells[colId]) ? (row.cells[colId] as string[]) : [])
export const textIn = (row: CleaningRow, colId: string): string => (typeof row.cells[colId] === 'string' ? (row.cells[colId] as string) : '')

export function addRow<T extends Chart>(c: T): T {
  return { ...c, rows: [...rowsOf(c), { id: uid(), order: c.rows.length, cells: {} }] }
}
export function removeRow<T extends Chart>(c: T, rowId: string): T {
  return { ...c, rows: renumber(rowsOf(c).filter((r) => r.id !== rowId)) }
}
export function moveRow<T extends Chart>(c: T, rowId: string, delta: number): T {
  const rows = rowsOf(c)
  const i = rows.findIndex((r) => r.id === rowId)
  const j = i + delta
  if (i < 0 || j < 0 || j >= rows.length) return c
  ;[rows[i], rows[j]] = [rows[j], rows[i]]
  return { ...c, rows: renumber(rows) }
}
export function addColumn<T extends Chart>(c: T, name: string, type: CleaningColumn['type']): T {
  return { ...c, columns: [...columnsOf(c), { id: uid(), name: name.trim() || '새 칸', type, order: c.columns.length }] }
}
export function removeColumn<T extends Chart>(c: T, colId: string): T {
  return {
    ...c,
    columns: renumber(columnsOf(c).filter((x) => x.id !== colId)),
    rows: c.rows.map((r) => {
      const { [colId]: _drop, ...cells } = r.cells
      return { ...r, cells }
    }),
  }
}
export function renameColumn<T extends Chart>(c: T, colId: string, name: string): T {
  return { ...c, columns: c.columns.map((x) => (x.id === colId ? { ...x, name } : x)) }
}
export function moveColumn<T extends Chart>(c: T, colId: string, delta: number): T {
  const cols = columnsOf(c)
  const i = cols.findIndex((x) => x.id === colId)
  const j = i + delta
  if (i < 0 || j < 0 || j >= cols.length) return c
  ;[cols[i], cols[j]] = [cols[j], cols[i]]
  return { ...c, columns: renumber(cols) }
}
export function setText<T extends Chart>(c: T, rowId: string, colId: string, text: string): T {
  return { ...c, rows: c.rows.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: text } } : r)) }
}

/** 학생을 칸에 넣는다(같은 열의 다른 칸에서는 뺀다 = 옮기기). */
export function addStudent<T extends Chart>(c: T, rowId: string, colId: string, sid: string): T {
  return {
    ...c,
    rows: c.rows.map((r) => {
      const cur = studentsIn(r, colId).filter((x) => x !== sid)
      return { ...r, cells: { ...r.cells, [colId]: r.id === rowId ? [...cur, sid] : cur } }
    }),
  }
}
export function removeStudent<T extends Chart>(c: T, colId: string, sid: string): T {
  return { ...c, rows: c.rows.map((r) => ({ ...r, cells: { ...r.cells, [colId]: studentsIn(r, colId).filter((x) => x !== sid) } })) }
}
export function unassignedIn(c: Chart, colId: string, studentIds: string[]): string[] {
  const used = new Set(c.rows.flatMap((r) => studentsIn(r, colId)))
  return studentIds.filter((id) => !used.has(id))
}

/** 미배정 학생을 인원이 적은 구역부터 고르게 나눈다. */
export function autoDistribute<T extends Chart>(c: T, colId: string, studentIds: string[]): T {
  const rows = rowsOf(c)
  if (!rows.length) return c
  let next = c
  for (const sid of unassignedIn(c, colId, studentIds)) {
    const counts = rowsOf(next).map((r) => studentsIn(r, colId).length)
    const target = rowsOf(next)[counts.indexOf(Math.min(...counts))]
    next = addStudent(next, target.id, colId, sid)
  }
  return next
}

/** 담당을 한 구역씩 아래로 민다(마지막 구역 담당은 첫 구역으로). */
export function rotate<T extends Chart>(c: T, colId: string): T {
  const rows = rowsOf(c)
  if (rows.length < 2) return c
  const groups = rows.map((r) => studentsIn(r, colId))
  return { ...c, rows: rows.map((r, i) => ({ ...r, cells: { ...r.cells, [colId]: groups[(i - 1 + rows.length) % rows.length] } })) }
}

export async function getCleaningChart(db: AppDB, c: ClassRec): Promise<CleaningChartRec> {
  // 찾기와 만들기를 한 트랜잭션에서(동시에 두 번 열어도 표가 둘이 되지 않게).
  return db.transaction('rw', db.cleaning_charts, async () => {
    const found = (await db.cleaning_charts.where('class_id').equals(c.id).toArray()).filter((x) => !x.deleted && x.active).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0]
    if (found) return found
    const rec = newRecord({ class_id: c.id, title: `${c.grade}학년 ${c.class_no}반 청소 구역`, date: '', columns: DEFAULT_COLUMNS(), rows: [], active: true }) as CleaningChartRec
    await db.cleaning_charts.add(rec)
    return rec
  })
}

export const saveCleaningChart = (db: AppDB, chart: CleaningChartRec) => save(db.cleaning_charts, chart)

/** hwpx·엑셀용 표: 머리글 + 구역 줄(학생 칸은 이름을 쉼표로). */
export function cleaningTable(c: Chart, nameOf: (sid: string) => string): string[][] {
  const cols = columnsOf(c)
  return [cols.map((x) => x.name), ...rowsOf(c).map((r) => cols.map((x) => (x.type === 'students' ? studentsIn(r, x.id).map(nameOf).join(', ') : textIn(r, x.id))))]
}
