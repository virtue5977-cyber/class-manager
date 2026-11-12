import { addCol, addRow, delCol, delRow, newTable, setCell, setWidths, tableWidths } from './tableOps'

test('표: 만들기·줄과 칸 더하고 빼기·칸 글·너비(합 100, 최소 6%)', () => {
  let t = newTable(2, 3)
  expect(t.cells).toEqual([['', '', ''], ['', '', '']])
  expect(tableWidths(t)).toEqual([33.3, 33.3, 33.4])
  t = setCell(t, 1, 2, '끝')
  t = addRow(t, 0)
  expect(t.cells.map((r) => r.join('|'))).toEqual(['||', '||', '||끝'])
  t = addCol(t, 0)
  expect(t.cells[2]).toEqual(['', '', '', '끝'])
  expect(tableWidths(t).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0)
  t = delCol(t, 0)
  t = delRow(t, 0)
  expect(t.cells).toEqual([['', '', ''], ['', '', '끝']])
  // 마지막 줄·칸은 지우지 않음
  expect(delRow(delRow(t, 0), 0).cells).toHaveLength(1)
  t = setWidths(t, [90, 5, 5])
  expect(tableWidths(t)).toEqual([88, 6, 6])
})
