// @vitest-environment node
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const L = require('../../../electron/log.cjs') as {
  createLog: (dir: string, now?: () => Date) => {
    info(code: string, f?: Record<string, string | number>): void
    error(code: string, f?: Record<string, string | number>): void
  }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'watson-log-'))
const NOW = new Date('2026-11-16T03:04:05.000Z')

test('줄 형식: ISO\\tLEVEL\\tcode\\tk=v, 하루 한 파일', () => {
  const dir = tmp()
  const log = L.createLog(dir, () => NOW)
  log.info('update.io', { n: 3, id: 'a-b_c.d:e' })
  log.error('vault.store', {})
  const f = path.join(dir, 'watson-2026-11-16.log')
  expect(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)).toEqual([
    '2026-11-16T03:04:05.000Z\tINFO\tupdate.io\tn=3\tid=a-b_c.d:e',
    '2026-11-16T03:04:05.000Z\tERROR\tvault.store',
  ])
})

test("허용 글자 밖(한글·경로·긴 값)은 '?'로 바뀐다", () => {
  const dir = tmp()
  const log = L.createLog(dir, () => NOW)
  log.info('x', { name: '가상학생', p: 'C:\\Users\\kim', long: 'a'.repeat(65), ok: 'a'.repeat(64) })
  const t = fs.readFileSync(path.join(dir, 'watson-2026-11-16.log'), 'utf8')
  expect(t).not.toContain('가상학생')
  expect(t).toContain('name=?\tp=?\tlong=?\tok=' + 'a'.repeat(64))
})

test('코드·키에 이상한 글자가 와도 줄이 깨지지 않는다', () => {
  const dir = tmp()
  const log = L.createLog(dir, () => NOW)
  log.info('가상\nINJECT', { 'k\t': 1 })
  const t = fs.readFileSync(path.join(dir, 'watson-2026-11-16.log'), 'utf8')
  expect(t.split('\n').filter(Boolean)).toHaveLength(1)
  expect(t).not.toContain('가상')
})

test('8일 된 파일은 지우고 7일 안 파일·남의 파일은 둔다', () => {
  const dir = tmp()
  for (const n of ['watson-2026-11-08.log', 'watson-2026-11-09.log', 'watson-2026-11-16.log', 'other.txt']) fs.writeFileSync(path.join(dir, n), 'x')
  L.createLog(dir, () => NOW)
  expect(fs.readdirSync(dir).sort()).toEqual(['other.txt', 'watson-2026-11-09.log', 'watson-2026-11-16.log'])
})

test('폴더를 못 만들어도 던지지 않는다', () => {
  const f = path.join(tmp(), 'file')
  fs.writeFileSync(f, 'x')
  const log = L.createLog(path.join(f, 'sub'), () => NOW)
  expect(() => log.error('x')).not.toThrow()
})
