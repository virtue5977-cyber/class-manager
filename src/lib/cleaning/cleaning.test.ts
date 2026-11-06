// @vitest-environment node
import { DEFAULT_COLUMNS, addRow, removeRow, moveRow, addColumn, removeColumn, renameColumn, moveColumn, setText, addStudent, removeStudent, unassignedIn, autoDistribute, rotate, rowsOf, columnsOf, studentsIn, cleaningTable, getCleaningChart } from './cleaning'
import { createDb } from '../db/schema'
import { createClass } from '../roster/roster'

const base = () => ({ columns: DEFAULT_COLUMNS(), rows: [] as ReturnType<typeof addRow>['rows'] })

test('빈 표에서 시작, 행·열 추가·삭제·이름·순서', () => {
  let c = addRow(addRow(base()))
  const [r1, r2] = rowsOf(c)
  const [area, who] = columnsOf(c)
  c = setText(c, r1.id, area.id, '교실 앞')
  c = setText(c, r2.id, area.id, '복도')
  c = moveRow(c, r2.id, -1)
  expect(cleaningTable(c, (x) => x).slice(1).map((r) => r[0])).toEqual(['복도', '교실 앞'])
  c = addColumn(c, '2주차', 'students')
  c = renameColumn(c, who.id, '1주차')
  c = moveColumn(c, columnsOf(c)[3].id, -1)
  expect(columnsOf(c).map((x) => x.name)).toEqual(['구역', '1주차', '2주차', '비고'])
  c = removeColumn(c, columnsOf(c)[3].id)
  c = removeRow(c, rowsOf(c)[0].id)
  expect(cleaningTable(c, (x) => x)).toEqual([['구역', '1주차', '2주차'], ['교실 앞', '', '']])
})

test('학생 넣기(같은 열에서는 옮기기)·빼기·미배정·자동 분배·순환', () => {
  let c = addRow(addRow(addRow(base())))
  const rows = rowsOf(c)
  const col = columnsOf(c)[1].id
  c = addStudent(c, rows[0].id, col, 'a')
  c = addStudent(c, rows[1].id, col, 'a')
  expect(rowsOf(c).map((r) => studentsIn(r, col))).toEqual([[], ['a'], []])
  expect(unassignedIn(c, col, ['a', 'b', 'c', 'd'])).toEqual(['b', 'c', 'd'])
  c = autoDistribute(c, col, ['a', 'b', 'c', 'd'])
  expect(rowsOf(c).map((r) => studentsIn(r, col).length)).toEqual([2, 1, 1])
  const before = rowsOf(c).map((r) => studentsIn(r, col))
  c = rotate(c, col)
  expect(rowsOf(c).map((r) => studentsIn(r, col))).toEqual([before[2], before[0], before[1]])
  c = removeStudent(c, col, 'a')
  expect(rowsOf(c).flatMap((r) => studentsIn(r, col))).not.toContain('a')
})

test('학급마다 청소표 하나(처음엔 빈 표)', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const cls = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const a = await getCleaningChart(db, cls)
  expect(a.rows).toEqual([])
  expect((await getCleaningChart(db, cls)).id).toBe(a.id)
})
