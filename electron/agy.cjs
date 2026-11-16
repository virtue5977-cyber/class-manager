// Antigravity CLI(agy)·Claude Code 부르기용 순수 함수. 한 번만 답하게(-p), 파일을 고치지 않는 계획 모드·샌드박스로.
// 학생 글(프롬프트)은 명령줄 인자에 절대 넣지 않는다(다른 프로그램이 프로세스 목록에서 읽을 수 있음): 표준 입력, 안 되면 임시 파일.
const path = require('node:path')
const MAX_PROMPT = 20000
const LOGIN_MSG = 'Antigravity 로그인이 필요합니다. 명령 창에서 agy 를 한 번 실행해 구글 계정으로 로그인하세요.'

const AGY_FLAGS = ['--output-format', 'json', '--mode', 'plan', '--sandbox', '--disable-slash-commands']
/** -p 에는 고정된 안내만(학생 글 없음). 지시·입력은 메인이 표준 입력으로 쓴다(-p 글은 표준 입력 뒤에 붙는다). */
const AGY_STDIN_PROMPT = '위 표준 입력의 지시와 출력 형식만 따르세요.'
function agyArgs(prompt) {
  if (String(prompt).length > MAX_PROMPT) throw new Error('AI에 보낼 글이 너무 깁니다. 내용을 나눠서 정리하세요.')
  return ['-p', AGY_STDIN_PROMPT, ...AGY_FLAGS]
}
/** 표준 입력을 읽지 않는 판: 작업 폴더(cwd) 안 임시 파일 이름만 넘긴다(@파일 포함). */
function agyFileArgs(name) {
  return ['-p', `@${name} 파일의 지시와 출력 형식만 따르세요.`, ...AGY_FLAGS]
}
/** 표준 입력으로 보냈는데 JSON 응답이 없으면(입력을 못 읽은 판) 임시 파일로 한 번 더. 로그인·모델 오류는 그대로. */
function needFileFallback(r) {
  return !!(r && r.error) && /응답이 없습니다|응답을 읽지 못했습니다/.test(r.error)
}

function parseAgyOutput(stdout) {
  const raw = String(stdout || '').trim()
  if (!raw) return { error: 'Antigravity 응답이 없습니다.' }
  if (/authentication required|not authenticated|login required/i.test(raw)) return { error: LOGIN_MSG }
  try {
    const body = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    if (String(body.status).toUpperCase() === 'ERROR') return { error: `Antigravity 오류: ${body.error || '알 수 없음'}` }
    return { text: String(body.response || '') }
  } catch {
    return { error: 'Antigravity 응답을 읽지 못했습니다.' }
  }
}

/**
 * cmd.exe /d /s /c 에 넘길 한 줄(바깥 따옴표 포함). 글이 세 번 읽힌다: cmd(% 펼치기) → .cmd의 %* → 프로그램의 인자 나누기.
 * - " → "" (cmd 따옴표 상태가 깨지지 않고, 인자 나누기에서는 글자 ")
 * - " 앞과 끝의 \ 는 두 배(인자 나누기 규칙)
 * - % → %%cd:~,% (환경 변수 %USERNAME% 등이 펼쳐지지 않게; 결과는 글자 %)
 * - 줄바꿈은 cmd 한 줄에 실을 수 없어 글자 \n 으로
 */
function quoteCmdArg(a) {
  const s = String(a).replace(/\r\n|\r|\n/g, '\\n')
  let out = '"'
  let bs = 0
  for (const c of s) {
    if (c === '\\') { bs++; continue }
    if (c === '"') { out += '\\'.repeat(bs * 2) + '""'; bs = 0; continue }
    out += '\\'.repeat(bs)
    bs = 0
    out += c === '%' ? '%%cd:~,%' : c
  }
  return out + '\\'.repeat(bs * 2) + '"'
}
function cmdLine(file, args) {
  return '"' + [file, ...args].map(quoteCmdArg).join(' ') + '"'
}

/** `where agy` 출력에서 고르기: .exe → .cmd/.bat. 확장자 없는 것(npm의 sh 스크립트)은 cmd가 못 돌린다. */
function pickAgyPath(whereOut) {
  const lines = String(whereOut || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  const exe = lines.find((x) => /\.exe$/i.test(x))
  if (exe) return { file: exe, viaCmd: false }
  const cmd = lines.find((x) => /\.(cmd|bat)$/i.test(x))
  return cmd ? { file: cmd, viaCmd: true } : null
}

/** 이 컴퓨터의 절대 경로인가(UNC·상대·드라이브 상대 거부). */
function isAbsLocal(p, platform) {
  if (typeof p !== 'string' || !p || /^[\\/]{2}/.test(p)) return false
  return platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(p) : p.startsWith('/')
}
/**
 * 프로그램 이름 → 절대 경로. `where`(Windows)·`which` 결과 가운데 이 컴퓨터의 절대 경로이고, 작업 폴더(cwd) 밖이며, 실제로 있는 것만.
 * Windows는 .exe를 먼저, 없으면 .cmd/.bat(cmd.exe로 부름). 확장자 없는 셸 스크립트는 건너뛴다.
 * run(cmd, args) 는 cwd = 작업 폴더에서 돌린다(where는 현재 폴더부터 찾으므로 그 결과는 버린다).
 */
function resolveAbs(name, { platform, cwd, run, exists }) {
  const P = platform === 'win32' ? path.win32 : path.posix
  let out = ''
  try {
    out = String(run(platform === 'win32' ? 'where' : 'which', [name]) || '')
  } catch {
    return null
  }
  const inCwd = (f) => {
    const rel = P.relative(cwd, P.dirname(f))
    return rel === '' || (!rel.startsWith('..') && !P.isAbsolute(rel))
  }
  const lines = out.split(/\r?\n/).map((x) => x.trim()).filter((x) => isAbsLocal(x, platform) && !inCwd(x) && exists(x))
  if (platform === 'win32') return pickAgyPath(lines.join('\n'))
  return lines[0] ? { file: lines[0], viaCmd: false } : null
}

/** 시간 초과 때 끝내는 명령. Windows는 cmd.exe 아래 node/agy까지(/t). */
function killCommand(platform, pid) {
  return platform === 'win32' ? ['taskkill', ['/pid', String(pid), '/t', '/f']] : null
}

/** 연결 확인 결과: --version 출력 + 짧은 시험 질문의 parseAgyOutput 결과. */
function statusFrom(versionOut, probe) {
  const v = String(versionOut || '').trim()
  if (!v) return { installed: false }
  const version = v.split(/\s+/).pop()
  if (probe && probe.error) return { installed: true, version, loggedIn: false, message: probe.error }
  return { installed: true, version, loggedIn: true }
}

const PROBE_PROMPT = 'OK 라고만 답하세요.'

/** Claude Code 한 번 묻기 인자: 세션 파일을 남기지 않고(학생 글이 ~/.claude에 쌓이지 않게), 도구·MCP 없이.
 * 글은 표준 입력으로. 셸을 거치지 않으므로 빈 값은 빈 글 그대로(.cmd면 cmdLine이 "" 로 인용). */
function claudeAskArgs(_platform) {
  return ['-p', '--output-format', 'json', '--max-turns', '1', '--model', 'haiku', '--no-session-persistence', '--strict-mcp-config', '--tools', '']
}

/** Claude Code가 실패했을 때 보여 줄 말 */
function claudeErrorText(text) {
  if (/unknown option|unrecognized option|unknown argument/i.test(text)) return 'Claude Code가 오래된 판입니다. 명령 창에서 claude update 를 실행해 새 판으로 올리세요.'
  if (/login|auth|log in/i.test(text)) return 'Claude Code에 로그인되어 있지 않습니다. 명령 창에서 claude 를 한 번 실행해 로그인하세요.'
  return 'Claude Code 실행 중 오류가 났습니다. Pro 사용 한도를 확인하세요.'
}

module.exports = { claudeErrorText, claudeAskArgs, agyArgs, agyFileArgs, needFileFallback, resolveAbs, AGY_STDIN_PROMPT, parseAgyOutput, quoteCmdArg, cmdLine, pickAgyPath, killCommand, statusFrom, PROBE_PROMPT, MAX_PROMPT, LOGIN_MSG }
