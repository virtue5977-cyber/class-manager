import { expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { createRoutedAiCaller } from './client'
import { effectiveMask } from '../settings'

const require = createRequire(import.meta.url)
const { agyArgs, parseAgyOutput, cmdLine, pickAgyPath, killCommand, statusFrom } = require('../../../electron/agy.cjs') as {
  agyArgs: (p: string) => string[]
  parseAgyOutput: (s: string) => { text?: string; error?: string }
  cmdLine: (file: string, args: string[]) => string
  pickAgyPath: (whereOut: string) => { file: string; viaCmd: boolean } | null
  killCommand: (platform: string, pid: number) => [string, string[]] | null
  statusFrom: (version: string, probe: { text?: string; error?: string }) => { installed: boolean; version?: string; loggedIn?: boolean; message?: string }
}

/** 표준 Windows 인자 나누기(CommandLineToArgvW / MSVCRT 2008+)를 흉내 낸다. */
function splitWinArgs(s: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === '\t') i++
    if (i >= s.length) break
    let cur = ''
    let inQ = false
    for (; i < s.length; i++) {
      const c = s[i]
      if (c === '\\') {
        let n = 0
        while (s[i] === '\\') (n++, i++)
        if (s[i] === '"') {
          cur += '\\'.repeat(n >> 1)
          if (n % 2) { cur += '"'; continue }
          i--
          continue
        }
        cur += '\\'.repeat(n)
        i--
        continue
      }
      if (c === '"') {
        if (inQ && s[i + 1] === '"') { cur += '"'; i++; continue }
        inQ = !inQ
        continue
      }
      if (!inQ && (c === ' ' || c === '\t')) break
      cur += c
    }
    out.push(cur)
  }
  return out
}
/** cmd.exe가 /c 줄에서 하는 % 펼치기(이 시험에서는 환경 변수 USERNAME만 있다고 본다). */
// 정의된 변수면 바꾸고, 아니면 첫 %만 그대로 두고 둘째 %부터 다시 읽는다(cmd 명령줄 규칙).
function cmdExpand(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; ) {
    const j = s[i] === '%' ? s.indexOf('%', i + 1) : -1
    if (j < 0) { out += s[i++]; continue }
    const name = s.slice(i + 1, j)
    if (name === 'USERNAME') { out += 'teacher'; i = j + 1 }
    else if (/^cd:~,\d*$/.test(name)) { i = j + 1 } // 길이 0인 부분 문자열 = 빈 글
    else { out += '%'; i += 1 }
  }
  return out
}

test('agy는 한 번만 답하는 계획 모드·샌드박스로 부른다', () => {
  expect(agyArgs('안녕')).toEqual(['-p', '안녕', '--output-format', 'json', '--mode', 'plan', '--sandbox', '--disable-slash-commands'])
})

test('프롬프트가 20,000자를 넘으면 보내지 않는다', () => {
  expect(() => agyArgs('가'.repeat(20001))).toThrow('AI에 보낼 글이 너무 깁니다')
})

test('응답 JSON에서 response를 꺼내고, 인증·빈 응답은 한국어 안내', () => {
  expect(parseAgyOutput('{"status":"OK","response":"안녕"}')).toEqual({ text: '안녕' })
  expect(parseAgyOutput('ERROR: authentication required')).toEqual({ error: 'Antigravity 로그인이 필요합니다. 명령 창에서 agy 를 한 번 실행해 구글 계정으로 로그인하세요.' })
  expect(parseAgyOutput('{"status":"ERROR","error":"authentication required"}').error).toMatch(/로그인이 필요/)
  expect(parseAgyOutput('')).toEqual({ error: 'Antigravity 응답이 없습니다.' })
})

test('공급자가 antigravity면 agy 브리지로 보낸다(지시문과 입력을 한 글로)', async () => {
  const sent: string[] = []
  const call = createRoutedAiCaller(async () => 'antigravity', async () => 'key', () => undefined, () => ({ status: async () => ({ installed: true }), ask: async (prompt: string) => (sent.push(prompt), '결과') }))
  expect(await call({ system: '지시', user: '메모' })).toBe('결과')
  expect(sent[0]).toContain('지시')
  expect(sent[0]).toContain('메모')
})

test('Antigravity를 쓰면 이름 가림 설정과 상관없이 늘 가린다', () => {
  expect(effectiveMask({ mask_names: false, ai_provider: 'antigravity' })).toBe(true)
  expect(effectiveMask({ mask_names: false, ai_provider: 'claude-code' })).toBe(false)
})

test('cmd 줄: 학생 글에 %·"·\\"·^·&·|·끝 \\가 있어도 인자 하나로 그대로 간다(환경 변수 펼침·인자 끼워넣기 없음)', () => {
  const hard = ['출석률 95% 이상', '%USERNAME% 님', '그는 "괜찮아"라고', 'a\\"b --mode edit', 'x ^& calc | del', 'C:\\temp\\']
  for (const prompt of hard) {
    const line = cmdLine('C:\\agy\\agy.cmd', ['-p', prompt, '--mode', 'plan'])
    const inner = cmdExpand(line.slice(1, -1)) // /s /c 가 바깥 따옴표를 벗긴 뒤 % 펼치기
    expect(splitWinArgs(inner)).toEqual(['C:\\agy\\agy.cmd', '-p', prompt, '--mode', 'plan'])
  }
})

test('cmd 줄: 줄바꿈은 cmd에 실을 수 없어 글자 \\n 으로 바꾼다(문단 구분 보존)', () => {
  const line = cmdLine('agy.cmd', ['-p', '지시\n# 입력\n메모'])
  expect(line).not.toMatch(/[\r\n]/)
  expect(splitWinArgs(line.slice(1, -1))[2]).toBe('지시\\n# 입력\\n메모')
})

test('where 결과: .exe 먼저, 다음 .cmd/.bat, 확장자 없는 셸 스크립트는 건너뜀', () => {
  expect(pickAgyPath('C:\\npm\\agy\r\nC:\\npm\\agy.cmd\r\n')).toEqual({ file: 'C:\\npm\\agy.cmd', viaCmd: true })
  expect(pickAgyPath('C:\\npm\\agy.cmd\r\nC:\\bin\\agy.exe\r\n')).toEqual({ file: 'C:\\bin\\agy.exe', viaCmd: false })
  expect(pickAgyPath('C:\\npm\\agy\r\n')).toBeNull()
  expect(pickAgyPath('')).toBeNull()
})

test('시간 초과 때 Windows는 taskkill /t /f 로 손자 프로세스까지 끝낸다', () => {
  expect(killCommand('win32', 1234)).toEqual(['taskkill', ['/pid', '1234', '/t', '/f']])
  expect(killCommand('linux', 1234)).toBeNull()
})

test('연결 확인: 버전이 나와도 짧은 시험 질문에서 로그인 안내가 오면 "로그인 필요"로 알린다', () => {
  expect(statusFrom('', { error: 'x' })).toEqual({ installed: false })
  expect(statusFrom('agy 1.2.0', { text: 'OK' })).toEqual({ installed: true, version: '1.2.0', loggedIn: true })
  const st = statusFrom('agy 1.2.0', { error: 'Antigravity 로그인이 필요합니다. 명령 창에서 agy 를 한 번 실행해 구글 계정으로 로그인하세요.' })
  expect(st).toMatchObject({ installed: true, version: '1.2.0', loggedIn: false })
  expect(st.message).toMatch(/로그인이 필요/)
})

test('Claude Code는 대화 기록을 남기지 않고 도구·MCP 없이 부른다', () => {
  const { claudeAskArgs } = require('../../../electron/agy.cjs') as { claudeAskArgs: (platform: string) => string[] }
  for (const pf of ['win32', 'darwin']) {
    const a = claudeAskArgs(pf)
    expect(a.slice(0, 2)).toEqual(['-p', '--output-format'])
    expect(a).toContain('--no-session-persistence')
    expect(a).toContain('--strict-mcp-config')
    expect(a[a.indexOf('--tools') + 1]).toBe(pf === 'win32' ? '""' : '')
  }
})

test('Claude Code 오류 글: 모르는 옵션이면 업데이트 안내, 로그인 문제면 로그인 안내', () => {
  const { claudeErrorText } = require('../../../electron/agy.cjs') as { claudeErrorText: (s: string) => string }
  expect(claudeErrorText("error: unknown option '--no-session-persistence'")).toBe('Claude Code가 오래된 판입니다. 명령 창에서 claude update 를 실행해 새 판으로 올리세요.')
  expect(claudeErrorText('Please log in')).toContain('로그인')
  expect(claudeErrorText('rate limit')).toBe('Claude Code 실행 중 오류가 났습니다. Pro 사용 한도를 확인하세요.')
})
