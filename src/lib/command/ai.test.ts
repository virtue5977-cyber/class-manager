import { createDb } from '../db/schema'
import { createClass, emptyStudent, saveStudent } from '../roster/roster'
import { updateSettings } from '../settings'
import { saveLog, listLogsByStudent } from '../counseling/counseling'
import type { AiRequest } from '../ai/client'
import { executeInput, type RunEnv } from './run'
import { aiFallback } from './ai'

async function setup(reply: (req: AiRequest) => string, aiOn = true) {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s3 = await saveStudent(db, c.id, emptyStudent(3, '박도윤'))
  await updateSettings(db, { ai_enabled: aiOn, mask_names: true })
  const sent: AiRequest[] = []
  const env: RunEnv = { db, today: '2026-11-10', classId: c.id, navigate: () => {}, download: () => {}, ai: async (r) => (sent.push(r), reply(r)) }
  const ctx = { students: await db.students.toArray(), notes: [], today: '2026-11-10' }
  return { db, s3, env, ctx, sent }
}

test('/ 없는 문장 → 명령으로 바꿔 확인을 묻고 저장하지 않는다(이름은 가려서 보냄)', async () => {
  const { db, env, ctx, sent } = await setup(() => '{"command":"/출결 @3 내일 지각 1교시 미인정"}')
  const r = await executeInput('박도윤 내일 지각 처리해줘', ctx, env, aiFallback)
  expect(r.result?.card?.kind).toBe('confirm')
  expect((r.result!.card!.data as { command: string }).command).toBe('/출결 @3 내일 지각 1교시 미인정')
  expect((r.result!.card!.data as { preview: string }).preview).toContain('3번 박도윤')
  expect(r.chat.status).toBe('확인 필요')
  expect(r.chat.mode).toBe('ai')
  expect(JSON.stringify(sent)).not.toContain('박도윤')
  expect(await db.attendance.count()).toBe(0)
})

test('긴 붙여넣기 → !처럼 추천 카드(전달사항·일정·할 일, 고쳐서 넣기)', async () => {
  const { env, ctx } = await setup(() => '{"summary":"강당 교육 안내","notices":["강당 교육\\n- 3교시"],"events":[{"date":"2026-11-13","time":"","title":"강당 교육"}],"todos":[{"text":"동의서 걷기","due":"2026-11-11"}]}')
  const r = await executeInput('공지\n3교시 후 강당 교육\n동의서 내일까지\n체육복 지참', ctx, env, aiFallback)
  expect(r.result?.summary).toBe('강당 교육 안내')
  expect(r.result?.card).toEqual({ kind: 'suggest', data: { items: [{ kind: 'notice', text: '강당 교육\n- 3교시', date: '2026-11-10' }, { kind: 'event', text: '강당 교육', date: '2026-11-13', time: '' }, { kind: 'todo', text: '동의서 걷기', date: '2026-11-11' }] } })
})

test('/상담정리 → 미정리 기록을 정리하고 되돌릴 수 있다', async () => {
  const { db, s3, env, ctx } = await setup((req) => {
    const id = /"id":\s*"([^"]+)"/.exec(req.user)?.[1] ?? /id[^a-z0-9]*([0-9a-f-]{36})/.exec(req.user)?.[1]
    return JSON.stringify({ items: [{ id, text: '정리된 글' }] })
  })
  await saveLog(db, { student_id: s3.id, date: '2026-11-09', place: '교실', content: '진로 고민' })
  const r = await executeInput('/상담정리 @3', ctx, env, aiFallback)
  expect(r.chat.status).toBe('성공')
  expect((await listLogsByStudent(db, s3.id))[0].nuga_status).toBe('정리됨')
  await r.result!.undo!()
  expect((await listLogsByStudent(db, s3.id))[0].nuga_status).toBe('미정리')
})

test('/전달 학부모 → 문자 초안(가린 이름은 되돌림)', async () => {
  const { env, ctx, sent } = await setup((req) => `{"text":"${/학생[A-Z]/.exec(req.user)?.[0] ?? ''} 어머님, 내일 체육복을 챙겨 주세요."}`)
  const r = await executeInput('/전달 학부모 @3 내일 체육복', ctx, env, aiFallback)
  expect(r.chat.mode).toBe('hybrid')
  expect((r.result!.card!.data as { text: string }).text).toBe('박도윤 어머님, 내일 체육복을 챙겨 주세요.')
  expect(JSON.stringify(sent)).not.toContain('박도윤')
})

test('AI가 꺼져 있으면 실패 + 설정 링크, 규칙 명령은 그대로', async () => {
  const { db, env, ctx } = await setup(() => '', false)
  const r = await executeInput('내일 3번 지각', ctx, env, aiFallback)
  expect(r.chat.status).toBe('실패')
  expect(r.chat.links).toContainEqual({ label: '설정 > AI', to: '/settings?tab=ai' })
  expect((await executeInput('/출결 @3 결석 질병 감기', ctx, env, aiFallback)).chat.status).toBe('성공')
  expect(await db.attendance.count()).toBe(1)
})

test('!전달 학생(옛 /전달 학생도) → 학생용으로 고친 글을 고칠 수 있는 추천 카드로(저장은 카드에서), 이름은 가림', async () => {
  const { db, env, ctx, sent } = await setup(() => '{"text":"내일 체육복을 꼭 가져오세요."}')
  const r = await executeInput('!전달 학생 박도윤 포함 다들 낼 체육복 챙겨', ctx, env, aiFallback)
  expect(r.chat.status).toBe('확인 필요')
  expect(r.result?.card).toEqual({ kind: 'suggest', data: { items: [{ kind: 'notice', text: '내일 체육복을 꼭 가져오세요.', date: '2026-11-10' }] } })
  expect((await db.notice_items.toArray()).filter((n) => !n.deleted)).toHaveLength(0)
  expect(JSON.stringify(sent)).not.toContain('박도윤')
  const old = await executeInput('/전달 학생 체육복 챙겨', ctx, env, aiFallback)
  expect(old.result?.summary).toContain('이제는 !전달 학생')
})

test('/전달(대상 없음)은 AI 없이 그대로 기록, AI가 꺼져 있으면 /전달 학생도 그대로', async () => {
  const { db, env, ctx, sent } = await setup(() => '')
  expect((await executeInput('/전달 체육복', ctx, env, aiFallback)).chat.mode).toBe('rule')
  expect(sent).toHaveLength(0)
  await updateSettings(db, { ai_enabled: false })
  const r = await executeInput('/전달 학생 체육복', ctx, env, aiFallback)
  expect(r.chat.mode).toBe('rule')
  expect((await db.notice_items.toArray()).map((n) => n.text)).toContain('체육복')
})

test('전출 학생 이름도 가린다(maskNames)', async () => {
  const { env, ctx, sent } = await setup(() => '{"command":""}')
  await executeInput('김전출 학부모께 연락', { ...ctx, maskNames: ['김전출'] }, env, aiFallback)
  expect(JSON.stringify(sent)).not.toContain('김전출')
})

test('!일정·!요약·기호 없는 질문(앱 자료로 대답, 이름은 가림)·AI 꺼짐', async () => {
  const { db, env, ctx, sent } = await setup((req) =>
    req.system.includes('"events"') && !req.system.includes('"notices"') ? '{"events":[{"date":"2026-11-13","time":"9:00","title":"수학 올림픽"}]}' : req.system.includes('요점') ? '{"text":"- 금요일 올림픽"}' : '{"answer":"오늘 결석은 박도윤 한 명입니다."}',
  )
  const ev = await executeInput('!일정 금요일 9시 수학 올림픽', ctx, env, aiFallback)
  expect(ev.result?.card).toEqual({ kind: 'suggest', data: { items: [{ kind: 'event', text: '수학 올림픽', date: '2026-11-13', time: '09:00' }] } })
  const sum = await executeInput('!요약 긴 글', ctx, env, aiFallback)
  expect(sum.result?.card).toEqual({ kind: 'draft', data: { kind: 'message', text: '- 금요일 올림픽' } })
  const q = await executeInput('오늘 결석한 학생 누구야', ctx, env, aiFallback)
  expect(q.chat.summary).toBe('오늘 결석은 박도윤 한 명입니다.')
  expect(JSON.stringify(sent.at(-1))).toContain('앱 자료')
  expect(JSON.stringify(sent)).not.toContain('박도윤')
  await updateSettings(db, { ai_enabled: false })
  expect((await executeInput('!요약 글', ctx, env, aiFallback)).chat.summary).toContain('AI가 꺼져 있습니다')
})

test('리뷰 고침: 질문과 앱 자료는 같은 가명 표를 쓴다(다른 학생을 같은 가명으로 보내지 않음), 가리기 설정이 꺼져 있어도 늘 가림', async () => {
  const { db, env, ctx, sent } = await setup(() => '{"answer":"모르겠습니다."}')
  await updateSettings(db, { mask_names: false, current_class_id: env.classId } as never)
  const { saveStudent, emptyStudent } = await import('../roster/roster')
  const other = await saveStudent(db, env.classId!, emptyStudent(7, '이서연'))
  await db.attendance.add({ id: 'a1', student_id: other.id, date: '2026-11-10', kind: '결석', category: '질병', reason: '', created_at: '', updated_at: '', deleted: false } as never)
  await executeInput('박도윤 오늘 출석했어', { ...ctx, students: await db.students.toArray() }, env, aiFallback)
  const req = sent.at(-1) as { system: string; user: string }
  expect(JSON.stringify(req)).not.toContain('박도윤')
  expect(JSON.stringify(req)).not.toContain('이서연')
  const qTok = /학생[A-Z]/.exec(req.user)?.[0]
  const sysTok = /7번 (학생[A-Z])/.exec(req.system)?.[1]
  expect(qTok).toBeTruthy()
  expect(sysTok).toBeTruthy()
  expect(sysTok).not.toBe(qTok)
})
