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

test('긴 붙여넣기 → 전달사항 초안 줄들', async () => {
  const { env, ctx } = await setup(() => '{"조례":["교육 3교시","동의서 제출"],"종례":["체육복"]}')
  const r = await executeInput('공지\n3교시 후 강당 교육\n동의서 내일까지\n체육복 지참', ctx, env, aiFallback)
  expect(r.result?.card).toEqual({ kind: 'draft', data: { kind: 'notices', items: ['교육 3교시', '동의서 제출', '체육복'] } })
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

test('/전달 학생은 AI를 쓰지 않으므로 규칙으로 기록', async () => {
  const { env, ctx, sent } = await setup(() => '')
  const r = await executeInput('/전달 학생 체육복', ctx, env, aiFallback)
  expect(r.chat.mode).toBe('rule')
  expect(sent).toHaveLength(0)
})
