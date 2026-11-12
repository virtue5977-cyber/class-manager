import { newRecord } from '../db/records'
import type { NoteRec, StudentRec } from '../db/types'
import { emptyStudent } from '../roster/roster'
import { COMMAND_META } from './registry'
import { applySuggestion, suggest } from './suggest'

const st = (n: number, name: string) => ({ ...newRecord({ ...emptyStudent(n, name), class_id: 'c' }) }) as StudentRec
const students = [st(3, '박도윤'), st(5, '김민준'), st(6, '김민지')]
const note = { ...newRecord({ title: '2026 공문서', blocks: [], pinned: false }) } as NoteRec
const ctx = { students, notes: [note], today: '2026-11-10', commands: COMMAND_META }
const s = (input: string) => suggest(input, input.length, ctx)

test('/ 뒤에는 명령', () => {
  expect(s('/출')[0]).toMatchObject({ label: '/출결', insert: '/출결', kind: 'cmd' })
  expect(s('/').length).toBeLessThanOrEqual(8)
})

test('세부 명령', () => {
  expect(s('/일정 ').map((x) => x.label)).toEqual(['달력', '할일'])
})

test('@ 뒤에는 학생(초성)과 노트', () => {
  expect(s('/출결 @ㅂㄷ')[0]).toMatchObject({ label: '3번 박도윤', insert: '@박도윤', kind: 'student' })
  const n = s('/할일 보고 @2026')
  expect(n[0]).toMatchObject({ label: '2026 공문서', insert: '@2026 공문서', kind: 'note' })
  expect(s('/출결 @김민').map((x) => x.label)).toEqual(['5번 김민준', '6번 김민지'])
})

test('명령이 기대하는 다음 낱말', () => {
  expect(s('/출결 @3 ').map((x) => x.label)).toEqual(['결석', '지각', '조퇴', '결과'])
  expect(s('/출결 @3 결석 ').map((x) => x.label)).toEqual(['미인정', '질병', '출석인정'])
  expect(s('/일정 달력 #').map((x) => x.label)).toEqual(['#개인', '#업무'])
})

test('후보 넣기: 그 토큰을 바꾸고 띄어쓰기 하나', () => {
  const r = applySuggestion('/출결 @ㅂㄷ', 7, { label: '3번 박도윤', insert: '@박도윤', kind: 'student' })
  expect(r).toEqual({ value: '/출결 @박도윤 ', caret: 9 })
  expect(applySuggestion('/출 내용', 2, { label: '/출결', insert: '/출결', kind: 'cmd' })).toEqual({ value: '/출결 내용', caret: 4 })
})

test('! 자동완성: 처음 낱말은 스킬, 그다음은 하위(받는 사람)', async () => {
  const { suggest } = await import('./suggest')
  const { COMMAND_META } = await import('./registry')
  const c = { students: [], notes: [], today: '2026-11-12', commands: COMMAND_META } as never
  expect(suggest('!전', 2, c).map((s) => s.insert)).toEqual(['!전달'])
  expect(suggest('!', 1, c).length).toBe(7)
  expect(suggest('!전달 학', 6, c).map((s) => s.insert)).toEqual(['학생', '학부모'])
})

test('! 명령 뒤에서도 @로 학생·노트 후보', () => {
  const s = suggest('!전달 학부모 @', 10, ctx)
  expect(s.some((x) => x.kind === 'student')).toBe(true)
  expect(suggest('!누가 @', 6, ctx).some((x) => x.kind === 'student')).toBe(true)
  expect(suggest('!상', 2, ctx).map((x) => x.label)).toEqual(['!상담'])
})
