// @vitest-environment node
import JSZip from 'jszip'
import { buildTableHwpx, tableColWidths } from './table-doc'
import { unzipText, xmlErrors } from '../hwpx/testUtil'

test('표 hwpx: mimetype 첫 항목, XML 오류 0, 행·열 수, 제목', async () => {
  const bytes = await buildTableHwpx({ title: '1학년 5반 출결 통계', header: ['번호', '이름', '결석'], rows: [['1', '가', '2'], ['2', '나&<', '0']], landscape: true })
  const zip = await JSZip.loadAsync(bytes)
  expect(Object.keys(zip.files)[0]).toBe('mimetype')
  const files = await unzipText(bytes)
  const sec = files['Contents/section0.xml']
  expect(xmlErrors(sec)).toEqual([])
  expect(xmlErrors(files['Contents/header.xml'])).toEqual([])
  expect(sec).toContain('rowCnt="3" colCnt="3"')
  expect(sec).toContain('1학년 5반 출결 통계')
  expect(sec).toContain('나&amp;&lt;')
  expect(sec).toContain('landscape="NARROWLY"')
})

test('열 너비는 비율대로 본문 폭을 정확히 채운다', () => {
  const w = tableColWidths([1, 2, 1], 51026)
  expect(w.reduce((a, b) => a + b, 0)).toBe(51026)
  expect(w[1]).toBeGreaterThan(w[0])
})
