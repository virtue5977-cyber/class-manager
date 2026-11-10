// @vitest-environment node
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
const require = createRequire(import.meta.url)
const stt = require('../../../electron/stt.cjs') as {
  STT_FILES: { bin: { url: string; sha256: string }; models: Record<'fast' | 'accurate', { url: string; sha256: string; file: string; label: string }> }
  whisperArgs: (o: { model: string; input: string; outBase: string; threads: number }) => string[]
  parseProgress: (line: string) => number | null
  downloadVerified: (f: typeof fetch, url: string, dest: string, sha: string, o: { onProgress?: (r: number, t: number) => void; maxBytes: number; timeoutMs: number }) => Promise<void>
  extractBin: (zip: Uint8Array, dir: string) => Promise<string[]>
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stt-'))
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

test('고정 주소와 해시', () => {
  expect(stt.STT_FILES.bin.url).toBe('https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip')
  expect(stt.STT_FILES.bin.sha256).toBe('b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732')
  expect(stt.STT_FILES.models.fast.sha256).toBe('ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb')
  expect(stt.STT_FILES.models.accurate.sha256).toBe('19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f')
})

test('whisper 인자와 진행률 읽기', () => {
  expect(stt.whisperArgs({ model: 'm.bin', input: 'a.wav', outBase: 'o', threads: 4 })).toEqual(['-m', 'm.bin', '-f', 'a.wav', '-l', 'ko', '-otxt', '-of', 'o', '-np', '-pp', '-t', '4'])
  expect(stt.parseProgress('whisper_print_progress_callback: progress =  37%')).toBe(37)
  expect(stt.parseProgress('main: processing')).toBeNull()
})

test('받기: 해시가 맞으면 저장, 틀리면 아무것도 남기지 않음', async () => {
  const dir = tmp()
  const ok = (async () => new Response('abc')) as unknown as typeof fetch
  const seen: number[] = []
  await stt.downloadVerified(ok, 'u', path.join(dir, 'a.bin'), sha('abc'), { onProgress: (r) => seen.push(r), maxBytes: 100, timeoutMs: 1000 })
  expect(fs.readFileSync(path.join(dir, 'a.bin'), 'utf8')).toBe('abc')
  expect(fs.existsSync(path.join(dir, 'a.bin.part'))).toBe(false)
  expect(seen[seen.length - 1]).toBe(3)
  await expect(stt.downloadVerified(ok, 'u', path.join(dir, 'b.bin'), sha('xyz'), { maxBytes: 100, timeoutMs: 1000 })).rejects.toThrow('파일 확인(SHA-256)에 실패했습니다.')
  expect(fs.readdirSync(dir)).toEqual(['a.bin'])
})

test('실행 파일 풀기: whisper-cli.exe와 dll만, 경로 밖 이름은 거부', async () => {
  const z = new JSZip()
  z.file('Release/whisper-cli.exe', 'x')
  z.file('Release/ggml.dll', 'y')
  z.file('Release/bench.exe', 'z')
  z.file('../evil.dll', 'e')
  const dir = tmp()
  const out = await stt.extractBin(await z.generateAsync({ type: 'uint8array' }), dir)
  expect(out.sort()).toEqual(['ggml.dll', 'whisper-cli.exe'])
  expect(fs.readdirSync(dir).sort()).toEqual(['ggml.dll', 'whisper-cli.exe'])
  expect(fs.existsSync(path.join(dir, '..', 'evil.dll'))).toBe(false)
})

test('작업 하나씩: 시작 전에 누른 취소도 기억하고, 나중에 붙은 프로그램은 바로 끝낸다', () => {
  const { createSttJobs } = require('../../../electron/stt.cjs') as { createSttJobs: (kill: (c: unknown) => void) => { start: (kind: string) => { cancelled: boolean; attach: (c: unknown) => void; done: () => void; abort?: () => void }; cancel: () => void; busy: () => boolean } }
  const killed: unknown[] = []
  const jobs = createSttJobs((c) => killed.push(c))
  const j = jobs.start('run')
  expect(() => jobs.start('install')).toThrow('이미 받거나 받아쓰는 중입니다.')
  jobs.cancel()
  expect(j.cancelled).toBe(true)
  j.attach('child')
  expect(killed).toEqual(['child'])
  j.done()
  expect(jobs.busy()).toBe(false)
  const k = jobs.start('install')
  let aborted = false
  k.abort = () => (aborted = true)
  jobs.cancel()
  expect(aborted).toBe(true)
  const stale = j
  stale.done() // 끝난 작업의 done이 새 작업을 지우지 않는다
  expect(jobs.busy()).toBe(true)
})

test('받기: idleMs 동안 아무것도 안 오면 멈춤으로 보고 그만둔다(전체 시간과 따로)', async () => {
  const dir = tmp()
  const slow = ((_u: string, init: RequestInit) =>
    Promise.resolve(new Response(new ReadableStream({ pull: () => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted')))) })))) as unknown as typeof fetch
  await expect(stt.downloadVerified(slow, 'u', path.join(dir, 'c.bin'), sha('x'), { maxBytes: 100, timeoutMs: 10000, idleMs: 30 } as never)).rejects.toThrow('시간이 너무 오래 걸려')
  expect(fs.readdirSync(dir)).toEqual([])
})
