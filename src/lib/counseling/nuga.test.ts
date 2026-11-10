// @vitest-environment node
import { createDb } from '../db/schema'
import { createClass, emptyStudent, saveStudent } from '../roster/roster'
import { saveLog, listLogsByStudent, nugaHeader, nugaCopyText, searchLogs, updateNuga } from './counseling'
import { runNuga, checkNuga, buildNugaPrompt, NUGA_OUTPUT_FORMAT } from './nuga'
import type { AiRequest } from '../ai/client'

async function setup() {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const me = await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  const friend = await saveStudent(db, c.id, emptyStudent(2, '박민수'))
  return { db, me, friend, roster: [me, friend] }
}

test('머리줄은 앱이 요일을 계산해 만든다', () => {
  expect(nugaHeader('2026-11-05', '점심시간 교실')).toBe('2026.11.05.(목) | 점심시간 교실')
  expect(nugaHeader('2026-11-08', '')).toBe('2026.11.08.(일)')
})

test('runNuga: 이름을 가려 보내고, 되돌려 저장, 상태 정리됨, 본인 이름·진단어 경고', async () => {
  const { db, me, friend, roster } = await setup()
  const log = await saveLog(db, { student_id: me.id, date: '2026-11-05', place: '교실', content: '박민수랑 말다툼. 김지훈 우울해 보임' })
  const sent: AiRequest[] = []
  const ai = async (req: AiRequest) => {
    sent.push(req)
    const [item] = JSON.parse(req.user)
    expect(item.메모).not.toMatch(/박민수|김지훈/)
    const fp = item.메모.match(/학생[A-Z]/g)
    return '```json\n' + JSON.stringify({ items: [{ id: item.id, text: `${fp[0]}와 말다툼함. 김지훈 우울해 보임` }] }) + '\n```'
  }
  const [r] = await runNuga(db, ai, me, roster, [log])
  expect(sent[0].system).toContain(NUGA_OUTPUT_FORMAT)
  expect(r.text).toBe('박민수와 말다툼함. 김지훈 우울해 보임')
  expect(r.warnings.join('|')).toMatch(/본인 이름.*\|.*진단 용어/)
  const [saved] = await listLogsByStudent(db, me.id)
  expect(saved).toMatchObject({ nuga_text: r.text, nuga_status: '정리됨', content: '박민수랑 말다툼. 김지훈 우울해 보임' })
  expect(nugaCopyText(saved)).toBe('2026.11.05.(목) | 교실\n박민수와 말다툼함. 김지훈 우울해 보임')
  void friend
})

test('원문을 고치면 다시 미정리, 나이스 입력 완료 시각, 검색', async () => {
  const { db, me, roster } = await setup()
  const log = await saveLog(db, { student_id: me.id, date: '2026-11-05', place: '', content: '청소 도움' })
  await updateNuga(db, log.id, { nuga_text: '청소를 도움.', nuga_status: '나이스 입력 완료' })
  expect((await listLogsByStudent(db, me.id))[0].nuga_entered_at).not.toBeNull()
  await saveLog(db, { student_id: me.id, date: '2026-11-05', place: '', content: '청소 도움, 쓰레기 분리' }, log.id)
  expect((await listLogsByStudent(db, me.id))[0]).toMatchObject({ nuga_status: '미정리', nuga_text: '청소를 도움.' })
  expect((await searchLogs(db, roster, '분리')).map((x) => x.student.name)).toEqual(['김지훈'])
})

test('checkNuga: 글자 수·메모에 없는 숫자·가명 잔존', () => {
  expect(checkNuga('학생B와 3번 다툼', { targetName: '', source: '다툼', maxChars: 5 })).toEqual([
    '가명(학생A 등)이 남아 있습니다.',
    '최대 5자를 넘었습니다(10자).',
    '메모에 없는 숫자가 있습니다: 3',
  ])
  expect(buildNugaPrompt('최대 {최대글자수}자', [], 200).system).toContain('최대 200자')
})

test('runNuga: 넘긴 명단에 없는 학생(전출·다른 반)의 이름도 가린다', async () => {
  const { db, me } = await setup()
  const other = await createClass(db, { school_year: 2026, grade: 1, class_no: 6 })
  await saveStudent(db, other.id, emptyStudent(3, '최서연'))
  const log = await saveLog(db, { student_id: me.id, date: '2026-11-05', place: '', content: '최서연과 다툼' })
  const sent: AiRequest[] = []
  await runNuga(db, async (r) => (sent.push(r), JSON.stringify({ items: [] })), me, [me], [log])
  expect(JSON.stringify(sent)).not.toContain('최서연')
})
