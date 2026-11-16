// @vitest-environment node
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const S = require('../../../electron/saveFile.cjs') as {
  createSaveAs: (deps: { showSaveDialog: (o: { defaultName: string }) => Promise<{ canceled: boolean; filePath?: string }>; fs?: typeof fs }) =>
    (name: unknown, bytes: unknown) => Promise<{ ok: true; name: string } | { ok: false }>
}

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saveas-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })
const bytes = new Uint8Array([1, 2, 3, 4, 5])
const pick = (p: string | null) => async () => (p ? { canceled: false, filePath: p } : { canceled: true })

test('취소 → ok:false, 아무것도 쓰지 않음', async () => {
  const save = S.createSaveAs({ showSaveDialog: pick(null) })
  expect(await save('백업_1.enc', bytes)).toEqual({ ok: false })
  expect(fs.readdirSync(dir)).toEqual([])
})

test('저장 → 내용이 같고 임시 파일이 남지 않으며 이름을 돌려준다', async () => {
  const target = path.join(dir, '고른이름.enc')
  const seen: string[] = []
  const save = S.createSaveAs({ showSaveDialog: async (o) => { seen.push(o.defaultName); return { canceled: false, filePath: target } } })
  expect(await save('백업_1.enc', bytes)).toEqual({ ok: true, name: '고른이름.enc' })
  expect(seen).toEqual(['백업_1.enc'])
  expect([...fs.readFileSync(target)]).toEqual([1, 2, 3, 4, 5])
  expect(fs.readdirSync(dir)).toEqual(['고른이름.enc'])
})

test('Buffer로 와도 받는다(IPC)', async () => {
  const target = path.join(dir, 'a.enc')
  const save = S.createSaveAs({ showSaveDialog: pick(target) })
  expect((await save('a.enc', Buffer.from(bytes))).ok).toBe(true)
})

test('다시 읽은 크기가 다르면 ok:false', async () => {
  const target = path.join(dir, 'a.enc')
  const short = { ...fs, statSync: ((p: fs.PathLike) => ({ ...fs.statSync(p), size: 1 })) as typeof fs.statSync }
  const save = S.createSaveAs({ showSaveDialog: pick(target), fs: short as typeof fs })
  expect(await save('a.enc', bytes)).toEqual({ ok: false })
})

test('쓰기 실패 → ok:false, 임시 파일 정리', async () => {
  const save = S.createSaveAs({ showSaveDialog: pick(path.join(dir, 'no', 'such', 'a.enc')) })
  expect(await save('a.enc', bytes)).toEqual({ ok: false })
  expect(fs.readdirSync(dir)).toEqual([])
})

test('잘못된 입력 → ok:false(대화 상자 열지 않음)', async () => {
  const dlg = vi.fn(pick(path.join(dir, 'a.enc')))
  const save = S.createSaveAs({ showSaveDialog: dlg })
  expect(await save('', bytes)).toEqual({ ok: false })
  expect(await save('../x.enc', bytes)).toEqual({ ok: false })
  expect(await save('a.enc', 'not bytes')).toEqual({ ok: false })
  expect(await save('a.enc', new Uint8Array(0))).toEqual({ ok: false })
  expect(dlg).not.toHaveBeenCalled()
})
