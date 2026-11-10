import { expect, test } from 'vitest'
import { readFirstSheet } from '../xlsx/read'
import { calendarXlsx, reportsXlsx, seatingXlsx } from './sheets'
import type { AbsenceReportRec, SeatingChartRec, StudentRec } from '../db/types'

const stu = (number: number, name: string) => ({ id: 's' + number, number, name }) as StudentRec

test('신고서 목록 엑셀: 머리줄과 한 줄', async () => {
  const report = { id: 'r', start_date: '2026-11-05', end_date: '2026-11-06', kind: '결석', period: null, category: '질병', school_days: 2, evidence_type: '2일 이내 질병', diagnosis_required: false, diagnosis_received: false, submitted: true } as unknown as AbsenceReportRec
  const rows = await readFirstSheet(await reportsXlsx([{ report, student: stu(3, '박도윤') }], (s) => s.name))
  expect(rows[0]).toEqual(['번호', '이름', '기간', '출결', '수업일', '증빙', '진단서', '제출'])
  expect(rows[1]).toEqual(['3', '박도윤', '11/5~11/6', '결석(질병)', '2', '2일 이내 질병', '-', '제출'])
})

test('자리배치 엑셀: 칸은 자리 그대로, 교탁 줄 포함', async () => {
  const chart = {
    rows: 2, cols: 2, podium_position: 'bottom', title: '11월 자리',
    seats: [
      { row: 0, col: 0, student_id: 's1', disabled: false, fixed: false },
      { row: 0, col: 1, student_id: null, disabled: false, fixed: false },
      { row: 1, col: 0, student_id: null, disabled: true, fixed: false },
      { row: 1, col: 1, student_id: null, disabled: false, fixed: false },
    ],
  } as unknown as SeatingChartRec
  const rows = await readFirstSheet(await seatingXlsx(chart, [stu(1, '가나')]))
  expect(rows).toEqual([['11월 자리'], ['1.가나', ''], ['×', ''], ['교탁']])
})

test('달력 엑셀: 날짜·종류·내용', async () => {
  const rows = await readFirstSheet(await calendarXlsx([{ date: '2026-11-12', kind: '학사', text: '체육대회' }, { date: '2026-11-10', kind: '구글', text: '15:30 학부모 상담' }]))
  expect(rows).toEqual([['날짜', '종류', '내용'], ['2026-11-10', '구글', '15:30 학부모 상담'], ['2026-11-12', '학사', '체육대회']])
})
