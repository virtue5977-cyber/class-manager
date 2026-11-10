// @vitest-environment node
import JSZip from 'jszip'
import { createDb } from '../../db/schema'
import { newRecord } from '../../db/records'
import type { AbsenceReportRec } from '../../db/types'
import { createClass, saveStudent, emptyStudent } from '../../roster/roster'
import { updateSettings } from '../../settings'
import { findPlaceholders, joinSplitPlaceholders } from '../placeholder'
import { xmlErrors } from '../testUtil'
import { absenceValues, buildAbsenceHwpx, ABSENCE_PLACEHOLDERS, defaultTemplateBytes } from './build'

const report = (over: Partial<AbsenceReportRec>): AbsenceReportRec =>
  newRecord({
    student_id: 's', kind: '결석', category: '질병', start_date: '2026-11-06', end_date: '2026-11-09', period: null, school_days: 2,
    evidence_type: '2일 이내 질병', confirm_methods: [3], written_date: '2026-11-10', confirmed_date: '2026-11-10',
    diagnosis_required: false, diagnosis_received: false, submitted: false, submitted_at: null, detail: '감기', overrides: [], stale: false, ...over,
  }) as AbsenceReportRec
const opt = { teacher: '김담임', school: '가락중학교', stuName: true, codeFormat: '{학년}{반}{번호2}' }

async function ctx() {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(3, '홍길동'))
  return { db, c, s }
}

test('기본 양식의 자리표시자는 30개이고 문서 속성에 사람 이름이 없다', async () => {
  const zip = await JSZip.loadAsync(await defaultTemplateBytes())
  const sec = await zip.file('Contents/section0.xml')!.async('string')
  const found = findPlaceholders(joinSplitPlaceholders(sec))
  expect(found).toHaveLength(30)
  const known = new Set(ABSENCE_PLACEHOLDERS.map((p) => p.name))
  expect(found.filter((f) => !known.has(f))).toEqual([])
  const hpf = await zip.file('Contents/content.hpf')!.async('string')
  expect(hpf).not.toMatch(/lastsaveby" content="text">[^<]/)
  expect(hpf).not.toMatch(/creator" content="text">[^<]/)
})

test('absenceValues: 질병 결석 2일', async () => {
  const { c, s } = await ctx()
  const v = absenceValues(report({ student_id: s.id }), s, c, opt)
  expect(v).toMatchObject({
    학번: '1503', 이름: '홍길동', 이름띄움: '홍 길 동', 학생성명: '홍길동', 결석_질병: '■', 결석_출석인정: '□', 지각_출석인정: '□',
    증빙_2일이내: '○', 증빙_3일이상: '', 확인_보호자통화: '■', 확인_진단서: '□', 일수: '2', 기간: '2026년 11월 6일 ~ 11월 9일', 교시표시: '',
    작성연도: '2026', 작성월: '11', 작성일: '10', 사유: '감기', 담임교사: '김담임', 학교명: '가락중학교', 연도: '2026',
  })
})

test('absenceValues: 출석인정 조퇴 3~4교시, 학생 성명 끔', async () => {
  const { c, s } = await ctx()
  const v = absenceValues(report({ kind: '조퇴', category: '출석인정', start_date: '2026-11-12', end_date: '2026-11-12', period: '3~4', school_days: 0, evidence_type: '기타', confirm_methods: [] }), s, c, { ...opt, stuName: false })
  expect(v).toMatchObject({ 조퇴_출석인정: '■', 결석_질병: '□', 교시: '3~4', 교시표시: '(3~4교시),', 일수: '', 기간: '2026년 11월 12일', 증빙_기타: '○', 학생성명: '' })
})

test('날짜가 비면 손글씨용 공백', async () => {
  const { c, s } = await ctx()
  const v = absenceValues(report({ written_date: '', confirmed_date: '' }), s, c, opt)
  expect(v.작성월).toBe('   ')
  expect(v.확인일).toBe('   ')
})

test('buildAbsenceHwpx 한 파일 3명: 학번 3종, mimetype STORE, XML 오류 0', async () => {
  const { db, c } = await ctx()
  await updateSettings(db, { teacher_name: '김담임', school_name: '가락중학교' })
  const studs = [await saveStudent(db, c.id, emptyStudent(4, '김철수')), await saveStudent(db, c.id, emptyStudent(15, '이영희'))]
  const all = [(await db.students.toArray()).find((x) => x.number === 3)!, ...studs]
  const reports = all.map((st) => report({ student_id: st.id }))
  const { bytes, fileName, warnings } = await buildAbsenceHwpx(db, reports, { stuName: true, mode: 'one' })
  expect(warnings).toEqual([])
  expect(fileName).toBe('결석신고서_2026-11-06_3명.hwpx')
  expect(bytes[8] | (bytes[9] << 8)).toBe(0)
  const sec = await (await JSZip.loadAsync(bytes)).file('Contents/section0.xml')!.async('string')
  expect(xmlErrors(sec)).toEqual([])
  for (const code of ['1503', '1504', '1515']) expect(sec).toContain(`학 번 : ${code}`)
  expect(sec).toContain('가락중학교장  귀하')
  expect(sec).not.toMatch(/\{\{/)
})

test('buildAbsenceHwpx zip: 학생별 파일 이름', async () => {
  const { db, s } = await ctx()
  const { bytes, fileName } = await buildAbsenceHwpx(db, [report({ student_id: s.id })], { stuName: false, mode: 'zip' })
  expect(fileName).toBe('결석신고서_2026-11-06_1명.zip')
  expect(Object.keys((await JSZip.loadAsync(bytes)).files)).toEqual(['결석신고서_1503_홍길동_2026-11-06_결석.hwpx'])
})

test('buildAbsenceHwpx zip: 같은 날 두 장도 파일이 겹치지 않는다', async () => {
  const { db, s } = await ctx()
  const r = report({ student_id: s.id })
  const { bytes } = await buildAbsenceHwpx(db, [r, { ...r, id: 'x2' }], { stuName: false, mode: 'zip' })
  expect(Object.keys((await JSZip.loadAsync(bytes)).files)).toHaveLength(2)
})

test('absenceValues: 다른 학교 양식용 묶음 값(학년반번호·결석종류·작성날짜)', async () => {
  const { c, s } = await ctx()
  const v = absenceValues(report({ student_id: s.id }), s, c, opt)
  expect(v.학년반번호).toBe('1학년 5반 3번')
  expect(v.결석종류).toBe('질병 결석')
  expect(v.작성날짜).toBe('2026년 11월 10일')
  expect(ABSENCE_PLACEHOLDERS.map((p) => p.name)).toEqual(expect.arrayContaining(['학년반번호', '결석종류', '작성날짜']))
})
