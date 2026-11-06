// @vitest-environment node
import { createDb } from '../db/schema'
import { createClass, emptyStudent, saveStudent, listStudents } from '../roster/roster'
import { rosterRowHeight, ROSTER_TABLE_AVAILABLE_HEIGHT, defaultRosterDocOptions, rosterTable, rosterColumnWidths, buildRosterHwpx, buildRosterXlsx, rosterFileName } from './roster-doc'
import { unzipText, xmlErrors } from '../hwpx/testUtil'

async function classWith(n: number, extra?: (i: number) => Partial<ReturnType<typeof emptyStudent>>) {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  for (let i = 1; i <= n; i++) await saveStudent(db, c.id, { ...emptyStudent(i, `학생${String(i).padStart(2, '0')}`), ...extra?.(i) })
  return { c, students: await listStudents(db, c.id) }
}

test('기본 옵션 제목은 "1학년 5반 명렬표"', async () => {
  const { c } = await classWith(0)
  expect(defaultRosterDocOptions(c)).toEqual({ title: '1학년 5반 명렬표', blankColumns: 3, fontSizePt: 11, includeInactive: false })
})

test('rosterTable: 빈 열 3이면 머리글이 번호·이름·빈칸3, 전출 학생은 기본 제외', async () => {
  const { c, students } = await classWith(3, (i) => ({ active: i !== 2 }))
  const opts = defaultRosterDocOptions(c)
  const t = rosterTable(students, opts)
  expect(t[0]).toEqual(['번호', '이름', '', '', ''])
  expect(t.slice(1).map((r) => r[1])).toEqual(['학생01', '학생03'])
  expect(rosterTable(students, { ...opts, includeInactive: true })).toHaveLength(4)
})

test('열 너비 합이 51026이다(빈 열 0, 3, 7)', () => {
  for (const n of [0, 3, 7]) {
    const w = rosterColumnWidths(n)
    expect(w).toHaveLength(2 + n)
    expect(w.reduce((a, b) => a + b, 0)).toBe(51026)
    expect(w[0]).toBe(4000)
    if (n > 0) expect(w[1]).toBe(9000)
  }
})

test('45명 명렬표 hwpx: 표 rowCnt=46, repeatHeader="1", pageBreak="CELL", XML 오류 0', async () => {
  const { c, students } = await classWith(45)
  const files = await unzipText(await buildRosterHwpx(students, defaultRosterDocOptions(c)))
  const sec = files['Contents/section0.xml']
  expect(xmlErrors(sec)).toEqual([])
  expect(xmlErrors(files['Contents/header.xml'])).toEqual([])
  expect(sec).toMatch(/rowCnt="46" colCnt="5"/)
  expect(sec).toContain('repeatHeader="1"')
  expect(sec).toContain('pageBreak="CELL"')
  expect(sec).toContain('landscape="WIDELY"')
  expect(sec).toContain('<hp:t>1학년 5반 명렬표</hp:t>')
  expect(sec).toContain('height="1980"')
})

test('제목의 특수문자도 hwpx가 깨지지 않는다', async () => {
  const { c, students } = await classWith(2, () => ({ name: '김&<이>' }))
  const files = await unzipText(await buildRosterHwpx(students, { ...defaultRosterDocOptions(c), title: '1반 <명렬표> & "확인"' }))
  expect(xmlErrors(files['Contents/section0.xml'])).toEqual([])
  expect(xmlErrors(files['Contents/content.hpf'])).toEqual([])
})

test('엑셀 명렬표는 머리글과 학생 행을 담는다', async () => {
  const { c, students } = await classWith(2)
  const files = await unzipText(await buildRosterXlsx(students, defaultRosterDocOptions(c)))
  expect(files['xl/worksheets/sheet1.xml']).toContain('<t>학생02</t>')
})

test('파일명 "1학년5반_명렬표.hwpx"', async () => {
  const { c } = await classWith(0)
  expect(rosterFileName(c, 'hwpx')).toBe('1학년5반_명렬표.hwpx')
  expect(rosterFileName(c, 'xlsx')).toBe('1학년5반_명렬표.xlsx')
})

test('학생 30명은 기본 행 높이로 한 쪽에 들어간다', () => {
  expect(rosterRowHeight(11, 31)).toBe(1980)
  expect(31 * 1980).toBeLessThanOrEqual(ROSTER_TABLE_AVAILABLE_HEIGHT)
})

test('학생 36명은 행 높이를 줄여 한 쪽에 맞춘다', () => {
  const h = rosterRowHeight(11, 37)
  expect(h).toBeLessThan(1980)
  expect(37 * h).toBeLessThanOrEqual(ROSTER_TABLE_AVAILABLE_HEIGHT)
})

test('학생이 너무 많으면 기본 높이로 두고 쪽을 나눈다', () => {
  expect(rosterRowHeight(11, 71)).toBe(1980)
})
