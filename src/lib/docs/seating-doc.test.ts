// @vitest-environment node
import { buildSeatingHwpx } from './seating-doc'
import { emptySeats, placeStudent, toggleDisabled } from '../seating/seating'
import { unzipText, xmlErrors } from '../hwpx/testUtil'
import type { ClassRec, SeatingChartRec, StudentRec } from '../db/types'

const cls = { id: 'c', grade: 1, class_no: 5, school_year: 2026 } as ClassRec
const studs = Array.from({ length: 23 }, (_, i) => ({ id: `s${i + 1}`, number: i + 1, name: `학생${i + 1}` })) as StudentRec[]
const chart = (rows: number, cols: number, extra: Partial<SeatingChartRec> = {}): SeatingChartRec => {
  let seats = emptySeats(rows, cols)
  studs.slice(0, rows * cols).forEach((s, i) => (seats = placeStudent(seats, s.id, Math.floor(i / cols), i % cols)))
  return { id: 'x', class_id: 'c', title: '1학년 5반 자리배치표(11월)', date: '2026-11-05', rows, cols, seats, podium_position: 'bottom', show_roster: true, active: true, created_at: '', updated_at: '', deleted: false, ...extra }
}

test.each([
  [5, 5],
  [6, 6],
  [4, 7],
])('%i×%i: XML 오류 0, 가로, 표 2개(배치 + 명렬표), 책상 칸 수', async (rows, cols) => {
  const { bytes } = await buildSeatingHwpx(chart(rows, cols), cls, studs)
  const sec = (await unzipText(bytes))['Contents/section0.xml']
  expect(xmlErrors(sec)).toEqual([])
  expect(sec).toContain('landscape="NARROWLY"')
  expect(sec.match(/<hp:tbl /g)).toHaveLength(2)
  expect(sec).toContain(`rowCnt="${rows * 2 + 1}" colCnt="${cols * 2 - 1}"`)
  expect(sec).toContain('1.학생1')
  expect(sec).toContain('교탁')
})

test('명렬표 끄기·교탁 위·책상 없음, 학생이 넘치면 경고', async () => {
  const c = chart(2, 2, { show_roster: false, podium_position: 'top' })
  c.seats = toggleDisabled(c.seats, 0, 0)
  const { bytes, warnings } = await buildSeatingHwpx(c, cls, studs)
  const sec = (await unzipText(bytes))['Contents/section0.xml']
  expect(sec.match(/<hp:tbl /g)).toHaveLength(1)
  expect(sec.indexOf('교탁')).toBeLessThan(sec.indexOf('학생'))
  expect(warnings).toEqual(['학생 23명이 책상 3개보다 많습니다.'])
})

test('칸 높이는 글자가 들어갈 만큼, 학생이 많으면 명렬표를 두 묶음으로, 전체 높이는 한 쪽 안', async () => {
  const many = Array.from({ length: 34 }, (_, i) => ({ id: `m${i}`, number: i + 1, name: `학생${i + 1}` })) as StudentRec[]
  for (const [rows, cols, list] of [[8, 6, many], [5, 5, studs]] as const) {
    const c = chart(rows, cols)
    const { bytes } = await buildSeatingHwpx(c, cls, [...list])
    const sec = (await unzipText(bytes))['Contents/section0.xml']
    expect(xmlErrors(sec)).toEqual([])
    const tables = sec.split('<hp:tbl ').slice(1)
    for (const t of tables) {
      const total = Number(t.match(/<hp:sz width="\d+" widthRelTo="ABSOLUTE" height="(\d+)"/)![1])
      expect(total).toBeLessThanOrEqual(44000)
    }
    if (list.length > 26) expect(tables[1]).toContain('colCnt="4"')
  }
})
