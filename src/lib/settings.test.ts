// @vitest-environment node
import { createDb } from './db/schema'
import { getSettings, updateSettings, getNeisKey, setNeisKey } from './settings'
import { exportSnapshot } from './backup/snapshot'

const testDb = () => createDb('test-' + crypto.randomUUID())

test('설정이 없으면 기본값 행을 만든다(id app, 보관 14, 이름 가리기 켜짐)', async () => {
  const db = testDb()
  const s = await getSettings(db)
  expect(s.id).toBe('app')
  expect(s.backup_keep_count).toBe(14)
  expect(s.mask_names).toBe(true)
  expect(s.school_kind).toBe('')
  expect(await db.app_settings.count()).toBe(1)
  expect((await getSettings(db)).created_at).toBe(s.created_at)
})

test('updateSettings는 지정한 칸만 바꾸고 updated_at을 갱신한다', async () => {
  const db = testDb()
  const before = await getSettings(db)
  await new Promise((r) => setTimeout(r, 5))
  const after = await updateSettings(db, { school_name: '가락중학교', school_kind: '중학교' })
  expect(after).toMatchObject({ school_name: '가락중학교', school_kind: '중학교', backup_keep_count: 14 })
  expect(after.updated_at > before.updated_at).toBe(true)
  expect((await db.app_settings.get('app'))?.school_name).toBe('가락중학교')
})

test('NEIS 키는 device_local에 저장되고 백업 스냅샷에 들어가지 않는다', async () => {
  const db = testDb()
  await setNeisKey(db, 'neis-secret-123')
  await getSettings(db)
  expect((await db.device_local.get('neisApiKey'))?.value).toBe('neis-secret-123')
  expect(JSON.stringify(await exportSnapshot(db))).not.toContain('neis-secret-123')
})

test('NEIS 키 앞뒤 공백 제거, 없으면 빈 문자열', async () => {
  const db = testDb()
  expect(await getNeisKey(db)).toBe('')
  await setNeisKey(db, '  abc  ')
  expect(await getNeisKey(db)).toBe('abc')
})

test('동시에 두 칸을 바꿔도 둘 다 저장된다', async () => {
  const db = testDb()
  await getSettings(db)
  await Promise.all([updateSettings(db, { my_subjects: ['수학'] }), updateSettings(db, { my_class_labels: ['1-1'] })])
  expect(await getSettings(db)).toMatchObject({ my_subjects: ['수학'], my_class_labels: ['1-1'] })
})

test('updateSettings에 함수를 주면 최신 값 기준으로 고친다(동시 호출에도 앞 변경 유지)', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const add = (k: string) => updateSettings(db, (cur) => ({ report_rules: [...cur.report_rules, k] }))
  await Promise.all([add('지각:질병'), add('조퇴:질병')])
  expect((await getSettings(db)).report_rules).toEqual(expect.arrayContaining(['지각:질병', '조퇴:질병']))
})
