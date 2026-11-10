import { createDb } from './db/schema'
import { getAiKey, setAiKey } from './settings'

afterEach(() => { delete (window as { desktop?: unknown }).desktop })

test('HTML판(브라우저)에서는 AI 키를 저장하지 않고 창을 닫을 때까지만 기억한다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await db.device_local.put({ id: 'aiApiKey', value: 'sk-old' }) // 예전에 저장된 키
  await setAiKey(db, 'sk-mem')
  expect(await getAiKey(db)).toBe('sk-mem')
  expect(await db.device_local.get('aiApiKey')).toBeUndefined()
  const other = createDb('test-' + crypto.randomUUID())
  expect(await getAiKey(other)).toBe('')
})

test('exe(데스크톱)에서는 이 기기에 저장한다', async () => {
  ;(window as { desktop?: unknown }).desktop = {}
  const db = createDb('test-' + crypto.randomUUID())
  await setAiKey(db, 'sk-disk')
  expect((await db.device_local.get('aiApiKey'))?.value).toBe('sk-disk')
  expect(await getAiKey(db)).toBe('sk-disk')
})
