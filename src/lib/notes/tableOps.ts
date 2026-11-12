/** 노트 표 블록(type 'table') 다루기: cells[줄][칸], widths(칸 너비 %, 합 100) */
import type { NoteBlock } from '../db/types'

export type TableData = Pick<NoteBlock, 'cells' | 'widths' | 'head'>
const MIN_W = 6
const r1 = (n: number) => Math.round(n * 10) / 10

export function newTable(rows: number, cols: number): Required<Pick<NoteBlock, 'cells'>> {
  return { cells: Array.from({ length: Math.max(1, rows) }, () => Array.from({ length: Math.max(1, cols) }, () => '')) }
}
const colsOf = (t: TableData) => Math.max(1, ...(t.cells ?? [[]]).map((r) => r.length))

/** 칸 너비 %(없으면 같게). 합이 100이 되게 마지막 칸으로 맞춘다. */
export function tableWidths(t: TableData): number[] {
  const n = colsOf(t)
  const w = t.widths && t.widths.length === n ? t.widths : Array.from({ length: n }, () => 100 / n)
  return fit(w)
}
function fit(w: number[]): number[] {
  const n = w.length
  const min = Math.min(MIN_W, 100 / n)
  let out = w.map((x) => Math.max(min, x))
  const over = out.reduce((a, b) => a + b, 0) - 100
  if (over) {
    // 넘친 만큼 min보다 큰 칸에서 비율대로 덜거나 더한다
    const room = out.map((x) => (over > 0 ? x - min : 1))
    const sum = room.reduce((a, b) => a + b, 0) || 1
    out = out.map((x, i) => x - (over * room[i]) / sum)
  }
  const rounded = out.map(r1)
  rounded[n - 1] = r1(100 - rounded.slice(0, -1).reduce((a, b) => a + b, 0))
  return rounded
}
export const setWidths = <T extends TableData>(t: T, w: number[]): T => ({ ...t, widths: fit(w) })

export function setCell<T extends TableData>(t: T, r: number, c: number, text: string): T {
  return { ...t, cells: (t.cells ?? []).map((row, i) => (i === r ? row.map((x, j) => (j === c ? text : x)) : row)) }
}
/** at 줄 뒤에 빈 줄(at = -1이면 맨 위) */
export function addRow<T extends TableData>(t: T, at: number): T {
  const cells = [...(t.cells ?? [])]
  cells.splice(at + 1, 0, Array.from({ length: colsOf(t) }, () => ''))
  return { ...t, cells }
}
export function delRow<T extends TableData>(t: T, at: number): T {
  if ((t.cells ?? []).length <= 1) return t
  return { ...t, cells: (t.cells ?? []).filter((_, i) => i !== at) }
}
/** at 칸 뒤에 빈 칸(at = -1이면 맨 앞). 너비는 같은 몫으로 다시 나눈다. */
export function addCol<T extends TableData>(t: T, at: number): T {
  const w = tableWidths(t)
  const n = w.length + 1
  const nw = [...w.map((x) => (x * (n - 1)) / n)]
  nw.splice(at + 1, 0, 100 / n)
  return { ...t, cells: (t.cells ?? []).map((row) => [...row.slice(0, at + 1), '', ...row.slice(at + 1)]), widths: fit(nw) }
}
export function delCol<T extends TableData>(t: T, at: number): T {
  if (colsOf(t) <= 1) return t
  const w = tableWidths(t).filter((_, i) => i !== at)
  return { ...t, cells: (t.cells ?? []).map((row) => row.filter((_, j) => j !== at)), widths: fit(w.map((x) => (x * 100) / w.reduce((a, b) => a + b, 0))) }
}
