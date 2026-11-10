import { newRecord } from '../db/records'
import type { NoteRec, StudentRec } from '../db/types'
import { emptyStudent } from '../roster/roster'
import { describe as describeParsed, parseCommand, tokenize } from './parse'

const st = (n: number, name: string) => ({ ...newRecord({ ...emptyStudent(n, name), class_id: 'c' }) }) as StudentRec
const students = [st(3, '박도윤'), st(5, '김민준'), st(6, '김민지')]
const note = { ...newRecord({ title: '2026 공문서', blocks: [], pinned: false }) } as NoteRec
const ctx = { students, notes: [note], today: '2026-11-10' }
const names = { 출결: 'attendance', 상담기록: 'counsel', 할일: 'todo', 일정: 'event' }
const subs = { event: ['달력', '할일'] }
const p = (s: string) => parseCommand(s, ctx, names, subs)

test('토큰 나누기(_는 띄어쓰기)', () => {
  expect(tokenize('/일정_달력 @3 #업무 회의').map((t) => [t.kind, t.text])).toEqual([['cmd', '/일정'], ['word', '달력'], ['student', '@3'], ['tag', '#업무'], ['word', '회의']])
})

test('/출결 @3 결석 질병 감기', () => {
  const r = p('/출결 @3 결석 질병 감기')
  expect(r.cmd).toBe('attendance')
  expect(r.students.map((s) => s.name)).toEqual(['박도윤'])
  expect([r.kind, r.category, r.rest, r.date]).toEqual(['결석', '질병', '감기', '2026-11-10'])
  expect(describeParsed(r, () => '출결')).toBe('출결 · 3번 박도윤 · 11/10(화) · 결석(질병) · 사유: 감기')
})

test('겹치는 이름은 고르게 하고, 없는 학생은 알린다', () => {
  const a = p('/출결 @김민 지각')
  expect(a.students).toEqual([])
  expect(a.ambiguous).toEqual(['김민'])
  expect(p('/출결 @없는이 지각').missing).toEqual(['없는이'])
  expect(p('/출결 @ㄱㅁㅈ 지각').ambiguous).toEqual(['ㄱㅁㅈ'])
  expect(p('/출결 @김민준 지각').students.map((s) => s.number)).toEqual([5])
})

test('날짜·교시·세부 명령·태그', () => {
  const r = p('/출결 @3 어제 조퇴 5~7교시 병원')
  expect([r.date, r.kind, r.period, r.rest]).toEqual(['2026-11-09', '조퇴', '5~7', '병원'])
  const e = p('/일정 달력 내일 오후 3시 #개인 치과')
  expect([e.cmd, e.sub, e.date, e.time, e.tags, e.rest]).toEqual(['event', '달력', '2026-11-11', '15:00', ['개인'], '치과'])
})

test('할 일 조각: 노트 제목(띄어쓰기 포함)·학생을 제자리에', () => {
  const r = p('/할일 회신 @2026 공문서 확인 @3')
  expect(r.parts).toEqual(['회신 ', { note: note.id }, ' 확인 ', { student: students[0].id }])
  expect(r.rest).toBe('회신 확인')
})

test('모르는 명령은 오류', () => {
  expect(p('/없는명령 a').errors).toEqual(["'/없는명령' 명령을 모릅니다. /를 눌러 고르세요."])
  expect(p('그냥 문장').cmd).toBeNull()
})

test('사유 속 숫자·날짜 말은 날짜가 아니다(앞쪽 날짜 말만 읽음)', () => {
  const a = p('/출결 @3 결석 질병 발열 37.5')
  expect([a.date, a.rest]).toEqual(['2026-11-10', '발열 37.5'])
  const b = p('/출결 @3 결석 출석인정 체험학습 3일')
  expect([b.date, b.rest]).toEqual(['2026-11-10', '체험학습 3일'])
  expect(p('/출결 @3 결석 질병 버스 일').rest).toBe('버스 일')
  expect(p('/출결 @3 어제 결석 질병 감기').date).toBe('2026-11-09')
})

test('없는 날짜는 오류', () => {
  expect(p('/일정 달력 31일 회의').errors).toEqual(['날짜가 올바르지 않습니다: 31일'])
  expect(p('/출결 @3 31일 결석 질병').date).toBe('2026-10-31') // 출결은 지난달 31일
  expect(p('/출결 @3 2/30 결석 질병').errors).toEqual(['날짜가 올바르지 않습니다: 2/30'])
})

test('할 일: 끝의 날짜 말은 마감일, 시각은 글로 남김', () => {
  const t = p('/할일 3시 회의 준비 내일')
  expect([t.rest, t.dateGiven, t.date]).toEqual(['3시 회의 준비', true, '2026-11-11'])
})

test('학생 이름과 같은 제목의 노트가 있어도 @이름은 학생', () => {
  const n2 = { ...newRecord({ title: '박도윤', blocks: [], pinned: false }) } as NoteRec
  const r = parseCommand('/출결 @박도윤 결석 질병', { ...ctx, notes: [note, n2] }, names, subs)
  expect(r.students.map((s) => s.name)).toEqual(['박도윤'])
})

test('출결은 지난 요일로, 미리보기에 다른 해면 연도', () => {
  const r = parseCommand('/출결 @3 월요일 결석 질병', { ...ctx, today: '2026-11-11' }, names, subs)
  expect(r.date).toBe('2026-11-09')
  const y = parseCommand('/출결 @3 12/22 결석 질병', { ...ctx, today: '2027-01-05' }, names, subs)
  expect(y.date).toBe('2026-12-22')
  expect(describeParsed(y, () => '출결')).toContain('2026년 12/22')
})
