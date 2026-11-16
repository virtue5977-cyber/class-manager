import { vaultTestDb } from './benchHook'

const w = window as unknown as { __watsonVaultTest?: unknown }
afterEach(() => {
  window.history.replaceState(null, '', '/')
  delete w.__watsonVaultTest
})

test('주소에 vaultTest가 없으면 null(평소 앱은 그대로)', () => {
  expect(vaultTestDb()).toBeNull()
  window.history.replaceState(null, '', '/?vaultTest=0')
  expect(vaultTestDb()).toBeNull()
  expect(w.__watsonVaultTest).toBeUndefined()
})

test('?vaultTest=1: 시험 열쇠의 암호화 DB, plain: createDb(bench-plain) (시험·개발 빌드에서만)', async () => {
  window.history.replaceState(null, '', `/?vaultTest=1&db=watson-bench-${crypto.randomUUID()}`)
  const v = vaultTestDb()!
  expect(v.isVault).toBe(true)
  expect((w.__watsonVaultTest as { db: unknown }).db).toBe(v)
  await v.notes.put({ id: 'n', title: '가상', blocks: [], pinned: false, created_at: 'x', updated_at: 'x', deleted: false })
  const again = (w.__watsonVaultTest as { reopen: () => typeof v }).reopen()
  expect((await again.notes.get('n'))?.title).toBe('가상')
  again.close(); v.close()
  await v.delete()
  window.history.replaceState(null, '', '/?vaultTest=plain')
  const p = vaultTestDb()!
  expect(p.name).toBe('bench-plain') // createDb(평문). WATSON_VAULT_TEST=1이면 시험 갈고리가 이것도 암호화한다
  p.close()
  await p.delete()
})
