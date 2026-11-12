import { requestExport } from '../ui/exportRequest'
import type { AppDB } from '../db/schema'
import type { AiCaller } from '../ai/client'
import type { StudentRec } from '../db/types'
import { softDelete } from '../db/records'
import { deleteAttendance, listAttendanceByStudent, saveAttendance } from '../attendance/attendance'
import { impactOfChange, listReportsByStudent, reconcileStudent } from '../absenceReports/reconcile'
import { deleteLog, listLogsByStudent, saveLog } from '../counseling/counseling'
import { addLocalEvent } from '../events/localEvents'
import { addTodo, deleteTodo } from '../todos/todos'
import { addNotice, deleteNotice } from '../notices/notices'
import { createNote, deleteNote, listNotes, noteText } from '../notes/notes'
import { buildAbsenceHwpx } from '../hwpx/absence/build'
import type { AttendanceCategory, AttendanceKind } from '../db/types'
import type { ParseCtx, Parsed } from './parse'
import { shortDate } from './dates'

export interface RunEnv {
  db: AppDB
  today: string
  classId: string
  ai?: AiCaller
  /** 이름 가림 여부(AI 명령) */
  mask?: boolean
  navigate(to: string): void
  download(name: string, bytes: Uint8Array): void
  /** 화면을 옮긴 뒤 그 화면의 내보내기 메뉴 열기 */
  openExport?(): void
}

export interface SearchHit {
  label: string
  detail: string
  to: string
}

export interface RunResult {
  summary: string
  links: { label: string; to: string }[]
  undo?: () => Promise<void>
  card?: { kind: 'student' | 'search' | 'draft' | 'confirm' | 'suggest'; data: unknown }
  form?: { kind: 'attendance' | 'counsel'; studentId: string; date: string }
  /** 저장하지 않은 결과(확인 필요) */
  pending?: boolean
  /** 실패로 기록(AI 꺼짐 등) */
  failed?: boolean
}

export interface Handler {
  /** 실행 전에 빠진 것: 안내 글(입력 창으로 채울 수 있으면 form) */
  needs?(p: Parsed): { message: string; form?: RunResult['form'] } | null
  run(p: Parsed, ctx: ParseCtx, env: RunEnv): Promise<RunResult>
}

const who = (s: StudentRec) => `${s.number}번 ${s.name}`
const oneStudent = (p: Parsed) => (p.students.length === 1 ? p.students[0] : null)
function needStudent(p: Parsed) {
  if (p.students.length === 0) return { message: '학생을 @로 고르세요.' }
  if (p.students.length > 1) return { message: '학생을 한 명만 고르세요.' }
  return null
}

export const HANDLERS: Record<string, Handler> = {
  attendance: {
    needs(p) {
      const n = needStudent(p)
      if (n) return n
      const form = { kind: 'attendance' as const, studentId: p.students[0].id, date: p.date }
      if (!p.kind) return { message: '결석·지각·조퇴·결과 중 하나를 쓰세요.', form }
      if (p.kind !== '결석' && !p.period) return { message: '교시를 쓰세요(예: 3교시).', form }
      if (!p.category) return { message: '미인정·질병·출석인정 중 하나를 쓰세요.', form }
      return null
    },
    async run(p, _ctx, env) {
      const s = oneStudent(p)!
      const input = { student_id: s.id, date: p.date, kind: p.kind as AttendanceKind, category: p.category as AttendanceCategory, period: p.kind === '결석' ? null : (p.period ?? null), reason: p.rest, evidence_type: null, memo: '' }
      // 이미 제출한 신고서가 바뀌면 입력 창에서 확인받는다.
      if ((await impactOfChange(env.db, s.id, { upsert: input })).length)
        return { summary: `${who(s)}: 이미 제출한 신고서가 바뀝니다. 창에서 확인하고 저장하세요.`, links: [], form: { kind: 'attendance', studentId: s.id, date: p.date }, pending: true }
      const rec = await saveAttendance(env.db, input)
      const r = await reconcileStudent(env.db, s.id)
      return {
        summary: `${who(s)} ${shortDate(p.date)} ${p.kind}${input.period ? ` ${input.period}교시` : ''}(${p.category}) 저장${r.created ? ' · 신고서 만듦' : r.updated ? ' · 신고서 고침' : ''}`,
        links: [{ label: '출결 보기', to: `/attendance?date=${p.date}` }],
        undo: async () => {
          await deleteAttendance(env.db, rec.id)
          await reconcileStudent(env.db, s.id)
        },
      }
    },
  },
  observe: {
    needs(p) {
      const n = needStudent(p)
      if (n) return n
      if (!p.rest) return { message: '관찰한 내용을 쓰세요. 예: /관찰 @3 모둠 활동에서 친구를 도움' }
      return null
    },
    async run(p, _ctx, env) {
      const s = oneStudent(p)!
      const rec = await saveLog(env.db, { student_id: s.id, date: p.date, place: '', content: p.rest, time: p.time ?? '', kind: '관찰' })
      return { summary: `${who(s)} 관찰 기록 저장 · ${shortDate(p.date)}`, links: [{ label: '누가기록', to: `/counseling?sid=${s.id}&date=${p.date}` }], undo: () => deleteLog(env.db, rec.id) }
    },
  },
  counsel: {
    needs(p) {
      const n = needStudent(p)
      if (n) return n
      if (!p.rest) return { message: '상담 내용을 쓰세요.', form: { kind: 'counsel', studentId: p.students[0].id, date: p.date } }
      return null
    },
    async run(p, _ctx, env) {
      const s = oneStudent(p)!
      const rec = await saveLog(env.db, { student_id: s.id, date: p.date, place: '', content: p.rest, time: p.time ?? '' })
      return { summary: `${who(s)} 상담 기록 저장 · ${shortDate(p.date)}`, links: [{ label: '누가기록', to: `/counseling?sid=${s.id}&date=${p.date}` }], undo: () => deleteLog(env.db, rec.id) }
    },
  },
  info: {
    needs: needStudent,
    async run(p, _ctx, env) {
      const s = oneStudent(p)!
      const atts = (await listAttendanceByStudent(env.db, s.id)).filter((a) => !a.deleted).slice(-5).reverse()
      const logs = (await listLogsByStudent(env.db, s.id)).slice(-3).reverse()
      const open = (await listReportsByStudent(env.db, s.id)).filter((r) => !r.submitted).length
      return { summary: `${who(s)} 정보`, links: [{ label: '명단', to: '/class/roster' }, { label: '누가기록', to: `/counseling?sid=${s.id}` }], card: { kind: 'student', data: { student: s, atts, logs, open } } }
    },
  },
  event: {
    needs: (p) => (!p.rest && !p.parts.length ? { message: '일정 제목을 쓰세요.' } : null),
    async run(p, ctx, env) {
      if (p.sub === '할일') return HANDLERS.todo.run(p, ctx, env)
      const tag = p.tags.find((t) => t === '개인' || t === '업무') as '개인' | '업무' | undefined
      const rec = await addLocalEvent(env.db, { date: p.date, time: p.time, title: p.rest, tag: tag ?? '업무' })
      return { summary: `일정 ${shortDate(p.date)}${p.time ? ` ${p.time}` : ''} ${p.rest} #${rec.tag}`, links: [{ label: '달력', to: `/calendar?date=${p.date}` }], undo: () => softDelete(env.db.local_events, rec.id) }
    },
  },
  todo: {
    needs: (p) => (!p.parts.length ? { message: '할 일을 쓰세요.' } : null),
    async run(p, _ctx, env) {
      const rec = await addTodo(env.db, p.parts, p.dateGiven ? p.date : null)
      return { summary: `할 일 추가${rec.due ? ` · 마감 ${shortDate(rec.due)}` : ''}`, links: [{ label: '할 일 보기', to: '/' }], undo: () => deleteTodo(env.db, rec.id) }
    },
  },
  search: {
    needs: (p) => (!p.rest ? { message: '찾을 낱말을 쓰세요.' } : null),
    async run(p, ctx, env) {
      const q = p.rest
      const hits: SearchHit[] = []
      for (const s of ctx.students) {
        for (const a of await listAttendanceByStudent(env.db, s.id)) if (!a.deleted && (a.reason.includes(q) || a.memo.includes(q))) hits.push({ label: `${who(s)} ${shortDate(a.date)} ${a.kind}`, detail: a.reason, to: `/attendance?date=${a.date}` })
        for (const l of await listLogsByStudent(env.db, s.id)) if ([l.content, l.nuga_text, l.place].some((t) => t.includes(q))) hits.push({ label: `${who(s)} ${shortDate(l.date)} 상담`, detail: l.content.slice(0, 60), to: `/counseling?sid=${s.id}&date=${l.date}` })
      }
      for (const e of await env.db.local_events.toArray()) if (!e.deleted && e.title.includes(q)) hits.push({ label: `${shortDate(e.date)} 일정`, detail: e.title, to: `/calendar?date=${e.date}` })
      for (const n of await listNotes(env.db)) if (noteText(n).includes(q)) hits.push({ label: `노트 ${n.title}`, detail: '', to: `/notes?id=${n.id}` })
      return { summary: `'${q}' ${hits.length}건`, links: [], card: { kind: 'search', data: hits.slice(0, 30) } }
    },
  },
  notice: {
    needs: (p) => (!p.rest ? { message: '전달할 내용을 쓰세요.' } : null),
    async run(p, _ctx, env) {
      const rec = await addNotice(env.db, { text: p.rest, start_date: p.date })
      return { summary: `전달사항 추가 · ${shortDate(p.date)}`, links: [{ label: '전달사항 보기', to: '/?tab=notice' }], undo: async () => void (await deleteNotice(env.db, rec.id)) }
    },
  },
  note: {
    async run(p, _ctx, env) {
      const rec = await createNote(env.db, p.rest || '새 노트')
      return { summary: `노트 '${rec.title}' 만듦`, links: [{ label: '노트 열기', to: `/notes?id=${rec.id}` }], undo: () => deleteNote(env.db, rec.id) }
    },
  },
  report: {
    needs: needStudent,
    async run(p, _ctx, env) {
      const s = oneStudent(p)!
      const reps = await listReportsByStudent(env.db, s.id)
      const last = [...reps].sort((a, b) => b.start_date.localeCompare(a.start_date))[0]
      if (!last) return { summary: `${who(s)}의 결석신고서가 없습니다.`, links: [] }
      const out = await buildAbsenceHwpx(env.db, [last], { stuName: false, mode: 'one' })
      env.download(out.fileName, out.bytes)
      return { summary: `${out.fileName} 파일을 만들었습니다.`, links: [{ label: '결석신고서', to: '/attendance/reports' }] }
    },
  },
  reflection: {
    async run(p, _ctx, env) {
      const s = oneStudent(p)
      const to = s ? `/class/reflection?sid=${s.id}` : '/class/reflection'
      env.navigate(to)
      return { summary: '반성문 화면을 열었습니다.', links: [{ label: '반성문', to }] }
    },
  },
  seat: {
    async run(_p, _ctx, env) {
      env.navigate('/class/seating')
      return { summary: '자리배치 화면을 열었습니다.', links: [{ label: '자리배치', to: '/class/seating' }] }
    },
  },
  export: {
    needs: (p) => (!p.sub ? { message: '화면 이름을 쓰세요(예: /내보내기 통계).' } : null),
    async run(p, _ctx, env) {
      const to = EXPORT_ROUTES[p.sub!]
      // 형식까지 쓰면 바로 저장·인쇄(한글·엑셀·PDF·인쇄), 없으면 메뉴를 연다
      const f = exportFormatOf(p.rest ?? '')
      env.navigate(to)
      if (f) {
        requestExport(to, f)
        return { summary: `${p.sub} ${f === 'print' ? '인쇄 창을 열었습니다' : `${FORMAT_WORD[f]} 파일로 내보냈습니다`}.`, links: [{ label: p.sub!, to }] }
      }
      env.openExport?.()
      return { summary: `${p.sub} 화면의 내보내기 메뉴를 열었습니다. 형식도 쓰면 바로 됩니다(예: /내보내기 ${p.sub} 엑셀).`, links: [{ label: p.sub!, to }] }
    },
  },
}

const FORMAT_WORD = { hwpx: '한글', xlsx: '엑셀', pdf: 'PDF' } as const
/** 형식 낱말: 한글·hwpx, 엑셀·xlsx, pdf, 인쇄·프린트 */
export function exportFormatOf(text: string): 'hwpx' | 'xlsx' | 'pdf' | 'print' | null {
  const t = text.trim().toLowerCase()
  if (/(^|\s)(한글|hwpx|hwp)(\s|$)/.test(t)) return 'hwpx'
  if (/(^|\s)(엑셀|xlsx|excel)(\s|$)/.test(t)) return 'xlsx'
  if (/(^|\s)pdf(\s|$)/.test(t)) return 'pdf'
  if (/(^|\s)(인쇄|프린트|출력)(\s|$)/.test(t)) return 'print'
  return null
}

export const EXPORT_ROUTES: Record<string, string> = {
  출결: '/attendance/stats', 신고서: '/attendance/reports', 통계: '/attendance/stats', 상담일지: '/counseling', 누가기록: '/counseling',
  명렬표: '/class/sheet', 자리배치: '/class/seating', 청소배치: '/class/cleaning', 달력: '/calendar',
}
