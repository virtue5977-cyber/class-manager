// @vitest-environment node
import { createMemoryFolder, createMemoryFsAdapter } from './memory'

test('쓴 파일이 목록에 보이고 같은 바이트로 읽힌다', async () => {
  const f = createMemoryFolder('백업')
  await f.writeFile('a.enc', Uint8Array.from([1, 2, 3]))
  expect(await f.listFiles()).toEqual(['a.enc'])
  expect([...(await f.readFile('a.enc'))]).toEqual([1, 2, 3])
})

test('삭제하면 목록에서 빠진다', async () => {
  const f = createMemoryFolder()
  await f.writeFile('a.enc', new Uint8Array(1))
  await f.deleteFile('a.enc')
  expect(await f.listFiles()).toEqual([])
})

test('없는 파일을 읽으면 reject', async () => {
  await expect(createMemoryFolder().readFile('none.enc')).rejects.toThrow()
})

test('메모리 어댑터는 폴더 선택 전 none, 선택 후 ready', async () => {
  const fs = createMemoryFsAdapter()
  expect(fs.isFolderSupported()).toBe(true)
  expect((await fs.restoreFolder()).status).toBe('none')
  const picked = await fs.pickFolder()
  expect(picked).not.toBeNull()
  const st = await fs.restoreFolder()
  expect(st.status).toBe('ready')
})
