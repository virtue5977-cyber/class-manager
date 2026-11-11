import JSZip from 'jszip'
import type { AppDB } from '../../db/schema'
import type { AbsenceReportRec, AttendanceCategory, AttendanceKind, ClassRec, EvidenceType, StudentRec } from '../../db/types'
import { getSettings } from '../../settings'
import { studentCode } from '../../absenceReports/compute'
import { fillPlaceholders, joinSplitPlaceholders, repeatPages } from '../placeholder'
import { getActiveTemplate } from './template'

export { defaultTemplateBytes } from './template'

const KINDS: AttendanceKind[] = ['결석', '지각', '조퇴', '결과']
const CATS: AttendanceCategory[] = ['미인정', '질병', '출석인정']
const EVIDENCE: Record<Exclude<EvidenceType, ''>, string> = {
  '2일 이내 질병': '증빙_2일이내',
  '3일 이상 질병': '증빙_3일이상',
  법정전염병: '증빙_법정전염병',
  '경조사 참석': '증빙_경조사',
  기타: '증빙_기타',
}
const CONFIRM = ['확인_진료확인서', '확인_약봉투', '확인_진단서', '확인_보호자통화', '확인_기타']
const BLANK = '   '
/** 다른 학교 양식의 ◯ 표시 칸(해당하면 ◯) */
const MARKS: { name: string; label: string; hit: (r: AbsenceReportRec) => boolean }[] = [
  { name: '표시_질병', label: '질병', hit: (r) => r.category === '질병' },
  { name: '표시_인정', label: '출석인정', hit: (r) => r.category === '출석인정' },
  { name: '표시_미인정', label: '미인정', hit: (r) => r.category === '미인정' },
  { name: '표시_결석', label: '결석', hit: (r) => r.kind === '결석' },
  { name: '표시_지각', label: '지각', hit: (r) => r.kind === '지각' },
  { name: '표시_조퇴', label: '조퇴', hit: (r) => r.kind === '조퇴' },
  { name: '표시_결과', label: '결과', hit: (r) => r.kind === '결과' },
]

export const ABSENCE_PLACEHOLDERS: { name: string; description: string }[] = [
  { name: '학번', description: '설정의 학번 형식(예: 1503)' },
  { name: '이름', description: '학생 이름' },
  { name: '이름띄움', description: '글자 사이를 띄운 이름(홍 길 동)' },
  { name: '학년', description: '학년' },
  { name: '반', description: '반' },
  { name: '번호', description: '번호' },
  { name: '학생성명', description: '"학생 성명 인쇄"를 켜면 이름, 끄면 빈칸(서명용)' },
  { name: '연도', description: '시작일의 연도' },
  { name: '시작월', description: '시작 월' },
  { name: '시작일', description: '시작 일' },
  { name: '종료월', description: '종료 월' },
  { name: '종료일', description: '종료 일' },
  { name: '기간', description: '2026년 11월 6일 또는 2026년 11월 6일 ~ 11월 9일' },
  { name: '교시', description: '교시(3 또는 3~4)' },
  { name: '교시표시', description: '(3~4교시), 또는 빈칸' },
  { name: '일수', description: '결석 수업일 수(결석이 아니면 빈칸)' },
  ...KINDS.flatMap((k) => CATS.map((c) => ({ name: `${k}_${c}`, description: `${k} ${c}이면 ■, 아니면 □` }))),
  ...Object.entries(EVIDENCE).map(([label, name]) => ({ name, description: `증빙 "${label}"이면 ○, 아니면 빈칸` })),
  { name: '확인_진료확인서', description: '담임 확인: 진료확인서·처방전 ■/□' },
  { name: '확인_약봉투', description: '담임 확인: 약봉투·진료영수증 ■/□' },
  { name: '확인_진단서', description: '담임 확인: 의사소견서·진단서 ■/□' },
  { name: '확인_보호자통화', description: '담임 확인: 보호자 통화(문자) ■/□' },
  { name: '확인_기타', description: '담임 확인: 기타 ■/□' },
  { name: '작성연도', description: '학생 작성일 연도' },
  { name: '작성월', description: '학생 작성일 월' },
  { name: '작성일', description: '학생 작성일 일' },
  { name: '확인연도', description: '담임 확인일 연도' },
  { name: '확인월', description: '담임 확인일 월' },
  { name: '확인일', description: '담임 확인일 일' },
  { name: '사유', description: '상세 사유' },
  { name: '담임교사', description: '설정의 담임 성명' },
  { name: '학교명', description: '설정의 학교 이름' },
  { name: '학년반번호', description: '1학년 5반 3번(다른 학교 양식 한 칸용)' },
  { name: '결석종류', description: '질병 결석·미인정 지각처럼 구분과 종류' },
  { name: '작성날짜', description: '2026년 11월 10일(학생 작성일)' },
  ...MARKS.map((m) => ({ name: m.name, description: `${m.label}이면 ◯, 아니면 빈칸(다른 학교 양식의 표시 칸)` })),
]

const ymd = (iso: string) => ({ y: iso.slice(0, 4), m: String(Number(iso.slice(5, 7))), d: String(Number(iso.slice(8, 10))) })

function dateParts(prefix: string, iso: string): Record<string, string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { [`${prefix}연도`]: BLANK, [`${prefix}월`]: BLANK, [`${prefix}일`]: BLANK }
  const p = ymd(iso)
  return { [`${prefix}연도`]: p.y, [`${prefix}월`]: p.m, [`${prefix}일`]: p.d }
}

export function absenceValues(
  r: AbsenceReportRec,
  student: StudentRec,
  classRec: ClassRec,
  opt: { teacher: string; school: string; stuName: boolean; codeFormat: string },
): Record<string, string> {
  const s = ymd(r.start_date)
  const e = ymd(r.end_date)
  const oneDay = r.start_date === r.end_date
  const range = oneDay ? `${s.y}년 ${s.m}월 ${s.d}일` : `${s.y}년 ${s.m}월 ${s.d}일 ~ ${e.y !== s.y ? `${e.y}년 ` : ''}${e.m}월 ${e.d}일`
  const v: Record<string, string> = {
    학번: studentCode(opt.codeFormat, classRec.grade, classRec.class_no, student.number),
    이름: student.name,
    이름띄움: student.name.replace(/\s+/g, '').split('').join(' '),
    학년: String(classRec.grade),
    반: String(classRec.class_no),
    번호: String(student.number),
    학생성명: opt.stuName ? student.name : '',
    연도: s.y,
    시작월: s.m,
    시작일: s.d,
    종료월: e.m,
    종료일: e.d,
    기간: range,
    교시: r.period ?? '',
    교시표시: r.period ? `(${r.period}교시),` : '',
    일수: r.kind === '결석' ? String(r.school_days) : '',
    사유: r.detail,
    담임교사: opt.teacher,
    학교명: opt.school || '        ',
    학년반번호: `${classRec.grade}학년 ${classRec.class_no}반 ${student.number}번`,
    결석종류: `${r.category} ${r.kind}`,
    작성날짜: /^\d{4}-\d{2}-\d{2}$/.test(r.written_date) ? `${ymd(r.written_date).y}년 ${ymd(r.written_date).m}월 ${ymd(r.written_date).d}일` : '      년    월    일',
    ...dateParts('작성', r.written_date),
    ...dateParts('확인', r.confirmed_date),
  }
  for (const k of KINDS) for (const c of CATS) v[`${k}_${c}`] = k === r.kind && c === r.category ? '■' : '□'
  for (const m of MARKS) v[m.name] = m.hit(r) ? '◯' : ''
  for (const [label, name] of Object.entries(EVIDENCE)) v[name] = r.evidence_type === label ? '○' : ''
  CONFIRM.forEach((name, i) => (v[name] = r.confirm_methods.includes(i) ? '■' : '□'))
  return v
}

async function pack(template: JSZip, sectionXml: string): Promise<Uint8Array> {
  const out = new JSZip()
  const names = Object.keys(template.files).filter((n) => !template.files[n].dir)
  names.sort((a, b) => Number(b === 'mimetype') - Number(a === 'mimetype'))
  for (const n of names) {
    const data = n === 'Contents/section0.xml' ? sectionXml : await template.files[n].async('uint8array')
    out.file(n, data, { compression: n === 'mimetype' ? 'STORE' : 'DEFLATE', createFolders: false })
  }
  return out.generateAsync({ type: 'uint8array' })
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').trim()

export async function buildAbsenceHwpx(
  db: AppDB,
  reports: AbsenceReportRec[],
  opt: { stuName: boolean; mode: 'one' | 'zip' },
): Promise<{ bytes: Uint8Array; fileName: string; warnings: string[] }> {
  if (!reports.length) throw new Error('내보낼 신고서가 없습니다.')
  const settings = await getSettings(db)
  const tpl = await JSZip.loadAsync((await getActiveTemplate(db)).bytes)
  const secFile = tpl.file('Contents/section0.xml')
  if (!secFile) throw new Error('양식에 본문(section0.xml)이 없습니다.')
  const section = joinSplitPlaceholders(await secFile.async('string'))
  const unknown = new Set<string>()
  const rows: { r: AbsenceReportRec; student: StudentRec; values: Record<string, string> }[] = []
  for (const r of reports) {
    const student = await db.students.get(r.student_id)
    if (!student) throw new Error('신고서의 학생을 찾을 수 없습니다.')
    const classRec = await db.classes.get(student.class_id)
    if (!classRec) throw new Error('신고서의 학급을 찾을 수 없습니다.')
    rows.push({ r, student, values: absenceValues(r, student, classRec, { teacher: settings.teacher_name, school: settings.school_name, stuName: opt.stuName, codeFormat: settings.student_code_format }) })
  }
  const fillPage = (page: string, i: number) => {
    const res = fillPlaceholders(page, rows[i].values)
    res.unknown.forEach((u) => unknown.add(u))
    return res.xml
  }
  const first = reports[0].start_date
  let bytes: Uint8Array
  let fileName: string
  if (opt.mode === 'one') {
    bytes = await pack(tpl, repeatPages(section, rows.length, fillPage))
    fileName = `결석신고서_${first}_${rows.length}명.hwpx`
  } else {
    const outer = new JSZip()
    for (let i = 0; i < rows.length; i++) {
      const one = await pack(tpl, repeatPages(section, 1, (p) => fillPage(p, i)))
      // 같은 날 지각·조퇴처럼 이름이 겹치면 zip이 앞 파일을 덮어쓰므로 구분과 번호를 붙인다.
      const base = safe(`결석신고서_${rows[i].values.학번}_${rows[i].student.name}_${rows[i].r.start_date}_${rows[i].r.kind}`)
      let name = base + '.hwpx'
      for (let n = 2; outer.file(name); n++) name = `${base}_${n}.hwpx`
      outer.file(name, one, { createFolders: false })
    }
    bytes = await outer.generateAsync({ type: 'uint8array' })
    fileName = `결석신고서_${first}_${rows.length}명.zip`
  }
  const warnings = [...unknown].map((u) => `양식의 알 수 없는 표시는 빈칸으로 두었습니다: {{${u}}}`)
  return { bytes, fileName, warnings }
}

/** 양식 미리보기: 가상 학생(1학년 5반 3번 가상학생)·가상 신고서 1건으로 채운다. 자료는 읽지도 쓰지도 않는다. */
export async function buildSampleAbsenceHwpx(templateBytes: Uint8Array, opt: { teacher: string; school: string; codeFormat: string }): Promise<Uint8Array> {
  const tpl = await JSZip.loadAsync(templateBytes)
  const secFile = tpl.file('Contents/section0.xml')
  if (!secFile) throw new Error('양식에 본문(section0.xml)이 없습니다.')
  const section = joinSplitPlaceholders(await secFile.async('string'))
  const r = {
    start_date: '2026-11-09', end_date: '2026-11-10', kind: '결석', category: '질병', period: null, school_days: 2, evidence_type: '2일 이내 질병',
    confirm_methods: [3], written_date: '2026-11-11', confirmed_date: '2026-11-11', detail: '감기로 병원 진료',
  } as unknown as AbsenceReportRec
  const student = { number: 3, name: '가상학생' } as StudentRec
  const classRec = { grade: 1, class_no: 5 } as ClassRec
  const values = absenceValues(r, student, classRec, { ...opt, stuName: true })
  return pack(tpl, fillPlaceholders(section, values).xml)
}
