import type { AppDB } from '../db/schema'
import { newRecord, save, softDelete } from '../db/records'
import type { ClassRec, Seat, SeatingChartRec } from '../db/types'

export const MAX_SIZE = 10

export function emptySeats(rows: number, cols: number): Seat[] {
  const out: Seat[] = []
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) out.push({ row, col, student_id: null, fixed: false, disabled: false })
  return out
}

export const seatAt = (seats: Seat[], row: number, col: number) => seats.find((s) => s.row === row && s.col === col)

/** 크기를 바꿔도 남는 칸의 배치는 그대로 둔다. */
export function resizeSeats(seats: Seat[], rows: number, cols: number): Seat[] {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > MAX_SIZE || cols > MAX_SIZE) throw new Error(`행·열은 1~${MAX_SIZE} 사이로 정하세요.`)
  return emptySeats(rows, cols).map((e) => seatAt(seats, e.row, e.col) ?? e)
}

const update = (seats: Seat[], row: number, col: number, f: (s: Seat) => Seat) => seats.map((s) => (s.row === row && s.col === col ? f(s) : s))

/**
 * 학생을 칸에 놓는다. 다른 칸에 있던 학생이면 그 칸과 맞바꾸고(빈자리면 이동), 명단에서 왔으면
 * 칸에 있던 학생은 명단(미배치)으로 돌아간다. 책상 없음 칸에는 놓지 않는다.
 */
export function placeStudent(seats: Seat[], studentId: string, row: number, col: number): Seat[] {
  const target = seatAt(seats, row, col)
  if (!target || target.disabled) return seats
  const from = seats.find((s) => s.student_id === studentId)
  if (from && from.row === row && from.col === col) return seats
  const displaced = target.student_id
  let next = update(seats, row, col, (s) => ({ ...s, student_id: studentId, fixed: from ? from.fixed : false }))
  if (from) next = update(next, from.row, from.col, (s) => ({ ...s, student_id: displaced, fixed: displaced ? target.fixed : false }))
  return next
}

export function unassign(seats: Seat[], studentId: string): Seat[] {
  return seats.map((s) => (s.student_id === studentId ? { ...s, student_id: null, fixed: false } : s))
}

export function toggleDisabled(seats: Seat[], row: number, col: number): Seat[] {
  return update(seats, row, col, (s) => (s.disabled ? { ...s, disabled: false } : { ...s, disabled: true, student_id: null, fixed: false }))
}

export function toggleFixed(seats: Seat[], row: number, col: number): Seat[] {
  return update(seats, row, col, (s) => (s.student_id ? { ...s, fixed: !s.fixed } : s))
}

/** 고정석·책상 없음을 빼고 나머지 학생을 무작위로 채운다. 남는 학생 수를 돌려준다. */
export function randomize(seats: Seat[], studentIds: string[], rng: () => number = Math.random): { seats: Seat[]; overflow: number } {
  const fixedIds = new Set(seats.filter((s) => s.fixed && s.student_id).map((s) => s.student_id!))
  const pool = studentIds.filter((id) => !fixedIds.has(id))
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  let k = 0
  const next = seats.map((s) => {
    if (s.disabled || (s.fixed && s.student_id)) return s
    return { ...s, student_id: pool[k++] ?? null, fixed: false }
  })
  return { seats: next, overflow: Math.max(0, pool.length - k) }
}

/** 명단에 있는데 자리에 없는 학생, 자리에 있는데 명단에서 빠진(전학 등) 칸 정리 */
export function unplaced(seats: Seat[], studentIds: string[]): string[] {
  const placed = new Set(seats.map((s) => s.student_id).filter(Boolean))
  return studentIds.filter((id) => !placed.has(id))
}

export function pruneMissing(seats: Seat[], studentIds: string[]): Seat[] {
  const ok = new Set(studentIds)
  return seats.map((s) => (s.student_id && !ok.has(s.student_id) ? { ...s, student_id: null, fixed: false } : s))
}

export function defaultSeatingTitle(c: ClassRec, date: string): string {
  return `${c.grade}학년 ${c.class_no}반 자리배치표(${Number(date.slice(5, 7))}월)`
}

export async function listSeatingCharts(db: AppDB, classId: string): Promise<SeatingChartRec[]> {
  return (await db.seating_charts.where('class_id').equals(classId).toArray()).filter((c) => !c.deleted).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.created_at < b.created_at ? 1 : -1))
}

/** 새 배치(또는 base를 복사)를 만들고 현재 배치로 정한다. */
export async function createSeatingChart(db: AppDB, c: ClassRec, date: string, base?: SeatingChartRec, size = { rows: 5, cols: 6 }): Promise<SeatingChartRec> {
  return db.transaction('rw', db.seating_charts, async () => {
    for (const old of await listSeatingCharts(db, c.id)) if (old.active) await save(db.seating_charts, { ...old, active: false })
    const rec = newRecord({
      class_id: c.id,
      title: defaultSeatingTitle(c, date),
      date,
      rows: base?.rows ?? size.rows,
      cols: base?.cols ?? size.cols,
      seats: base ? base.seats.map((s) => ({ ...s })) : emptySeats(size.rows, size.cols),
      podium_position: base?.podium_position ?? 'bottom',
      show_roster: base?.show_roster ?? true,
      active: true,
    }) as SeatingChartRec
    await db.seating_charts.add(rec)
    return rec
  })
}

export async function saveSeatingChart(db: AppDB, chart: SeatingChartRec): Promise<SeatingChartRec> {
  return save(db.seating_charts, chart)
}

export async function activateSeatingChart(db: AppDB, chart: SeatingChartRec): Promise<void> {
  await db.transaction('rw', db.seating_charts, async () => {
    for (const c of await listSeatingCharts(db, chart.class_id)) if (c.active !== (c.id === chart.id)) await save(db.seating_charts, { ...c, active: c.id === chart.id })
  })
}

export const deleteSeatingChart = (db: AppDB, id: string) => softDelete(db.seating_charts, id)
