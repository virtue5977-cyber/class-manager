import { createDb } from '../db/schema'
import { saveBriefingItems } from '../briefing/briefing'
import { addNotice, deleteNotice, migrateBriefings, moveNotice, noticesOn, updateNotice } from './notices'

const fresh = () => createDb('test-' + crypto.randomUUID())

test('기간 안 날짜에만 보이고 해를 넘겨도 맞다', async () => {
  const db = fresh()
  await addNotice(db, { text: '방학 안내', start_date: '2026-12-30', end_date: '2027-01-02' })
  await addNotice(db, { text: '하루', start_date: '2026-11-10' })
  expect((await noticesOn(db, '2026-12-31')).map((n) => n.text)).toEqual(['방학 안내'])
  expect(await noticesOn(db, '2027-01-03')).toEqual([])
  expect((await noticesOn(db, '2026-11-10')).map((n) => n.text)).toEqual(['하루'])
})

test('끝 날짜가 시작보다 앞이면 거절', async () => {
  await expect(addNotice(fresh(), { text: 'x', start_date: '2026-11-12', end_date: '2026-11-10' })).rejects.toThrow('끝 날짜가 시작 날짜보다 앞입니다.')
})

test('고정 먼저, 순서대로, 완료는 맨 아래; 순서 옮기기; 지우기 되돌리기', async () => {
  const db = fresh()
  const a = await addNotice(db, { text: 'a', start_date: '2026-11-10' })
  const b = await addNotice(db, { text: 'b', start_date: '2026-11-10' })
  const c = await addNotice(db, { text: 'c', start_date: '2026-11-10' })
  await updateNotice(db, a.id, { done: true })
  await updateNotice(db, c.id, { pinned: true })
  expect((await noticesOn(db, '2026-11-10')).map((n) => n.text)).toEqual(['c', 'b', 'a'])
  await updateNotice(db, a.id, { done: false })
  await moveNotice(db, '2026-11-10', a.id, 1)
  expect((await noticesOn(db, '2026-11-10')).map((n) => n.text)).toEqual(['c', 'b', 'a'])
  const undo = await deleteNotice(db, b.id)
  expect((await noticesOn(db, '2026-11-10')).map((n) => n.text)).toEqual(['c', 'a'])
  await undo()
  expect((await noticesOn(db, '2026-11-10')).map((n) => n.text)).toEqual(['c', 'b', 'a'])
})

test('조례·종례 항목을 전달사항으로 한 번만 옮긴다(조례 먼저)', async () => {
  const db = fresh()
  await saveBriefingItems(db, '2026-11-09', '종례', [{ text: '체육복', order: 0, done: false }])
  await saveBriefingItems(db, '2026-11-09', '조례', [{ text: '교육', order: 0, done: true }, { text: '동의서', order: 1, done: false }])
  expect(await migrateBriefings(db)).toBe(3)
  const list = await noticesOn(db, '2026-11-09')
  expect(list.map((n) => n.text)).toEqual(['동의서', '체육복', '교육'])
  expect(await migrateBriefings(db)).toBe(0)
})

test('옮기기는 다른 기기(백업 복원 후)에서 다시 돌아도 겹치지 않는다', async () => {
  const db = fresh()
  await saveBriefingItems(db, '2026-11-09', '조례', [{ text: '교육', order: 0, done: false }])
  expect(await migrateBriefings(db)).toBe(1)
  await db.device_local.delete('briefingsMigrated') // 새 기기: 표시가 없다
  expect(await migrateBriefings(db)).toBe(0)
  expect((await noticesOn(db, '2026-11-09')).map((n) => n.text)).toEqual(['교육'])
})

test('복원한 새 기기(표시 없음, 빈 전달사항)에서도 옮긴다', async () => {
  const db = fresh()
  await migrateBriefings(db) // 빈 상태에서 먼저 돌아도
  await saveBriefingItems(db, '2026-11-09', '종례', [{ text: '체육복', order: 0, done: false }]) // 그 뒤 백업 복원
  expect(await migrateBriefings(db)).toBe(1)
})
