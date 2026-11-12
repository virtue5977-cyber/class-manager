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

test('시작 날짜가 비었거나 날짜가 아니면 거절', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await expect(addNotice(db, { text: '가', start_date: '' })).rejects.toThrow('날짜를 고르세요.')
  await expect(addNotice(db, { text: '가', start_date: '2026-11-10', end_date: '11/12' })).rejects.toThrow('날짜를 고르세요.')
  expect(await db.notice_items.count()).toBe(0)
})

test('그날 전달사항 전체 지우기: 그날 보이는 것만 지우고, 되돌리면 모두 돌아온다', async () => {
  const { clearNoticesOn } = await import('./notices')
  const db = createDb('test-' + crypto.randomUUID())
  await addNotice(db, { text: '오늘 하나', start_date: '2026-11-11' })
  await addNotice(db, { text: '기간 걸침', start_date: '2026-11-10', end_date: '2026-11-12' })
  await addNotice(db, { text: '내일 것', start_date: '2026-11-12' })
  const undo = await clearNoticesOn(db, '2026-11-11')
  expect(await noticesOn(db, '2026-11-11')).toEqual([])
  expect((await noticesOn(db, '2026-11-12')).map((n) => n.text)).toEqual(['내일 것'])
  await undo()
  expect((await noticesOn(db, '2026-11-11')).map((n) => n.text).sort()).toEqual(['기간 걸침', '오늘 하나'])
})

test('끌어 놓은 순서대로(그날 보이는 목록), 짝 노트 줄 순서도 맞춘다', async () => {
  const { reorderNotices } = await import('./notices')
  const { openNoticeNote } = await import('./noteSync')
  const db = createDb('t-' + crypto.randomUUID())
  const D = '2026-11-13'
  const a = await addNotice(db, { text: '가', start_date: D })
  const b = await addNotice(db, { text: '나', start_date: D })
  const c = await addNotice(db, { text: '다', start_date: D })
  const n = await openNoticeNote(db, D)
  await reorderNotices(db, D, [c.id, a.id, b.id])
  expect((await noticesOn(db, D)).map((x) => x.text)).toEqual(['다', '가', '나'])
  expect((await db.notes.get(n.id))!.blocks.map((x) => x.text)).toEqual(['다', '가', '나'])
})

test('날짜별 묶음: 보고 있는 날 빼고, 앞날짜 먼저(가까운 순), 지난 날짜는 따로(최근 순)', async () => {
  const { noticeDateGroups } = await import('./notices')
  const db = createDb('t-' + crypto.randomUUID())
  await addNotice(db, { text: '오늘', start_date: '2026-11-12' })
  await addNotice(db, { text: '내일', start_date: '2026-11-13' })
  await addNotice(db, { text: '모레', start_date: '2026-11-14' })
  await addNotice(db, { text: '기간', start_date: '2026-11-10', end_date: '2026-11-20' })
  await addNotice(db, { text: '지난', start_date: '2026-11-05' })
  await addNotice(db, { text: '더 지난', start_date: '2026-11-01' })
  const g = await noticeDateGroups(db, '2026-11-12')
  expect(g.upcoming.map((x) => [x.label, x.items.map((i) => i.text)])).toEqual([['11/13', ['내일']], ['11/14', ['모레']]])
  expect(g.ranges.map((x) => [x.label, x.items.map((i) => i.text)])).toEqual([['11/10~11/20', ['기간']]])
  expect(g.past.map((x) => x.label)).toEqual(['11/5', '11/1'])
})
