// Antigravity CLI(agy) 부르기용 순수 함수. 한 번만 답하게(-p), 파일을 고치지 않는 계획 모드·샌드박스로.
const MAX_PROMPT = 20000
const LOGIN_MSG = 'Antigravity 로그인이 필요합니다. 명령 창에서 agy 를 한 번 실행해 구글 계정으로 로그인하세요.'

function agyArgs(prompt) {
  if (prompt.length > MAX_PROMPT) throw new Error('AI에 보낼 글이 너무 깁니다. 내용을 나눠서 정리하세요.')
  return ['-p', prompt, '--output-format', 'json', '--mode', 'plan', '--sandbox', '--disable-slash-commands']
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

module.exports = { agyArgs, parseAgyOutput, quoteCmdArg, cmdLine, pickAgyPath, killCommand, statusFrom, PROBE_PROMPT, MAX_PROMPT, LOGIN_MSG }
