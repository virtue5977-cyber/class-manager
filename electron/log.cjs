'use strict'
// 로그: 코드·숫자·짧은 식별자만 남긴다. 글(이름·내용·경로·토큰)은 허용 글자 밖이라 '?'가 된다.
const fs = require('node:fs')
const path = require('node:path')

const SAFE = /^[A-Za-z0-9_.:-]{0,64}$/
const KEEP_DAYS = 7
const FILE = /^watson-(\d{4})-(\d{2})-(\d{2})\.log$/

const safe = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && SAFE.test(v) ? v : '?')
const safeName = (s) => (typeof s === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(s) ? s : '?')

function createLog(dir, now = () => new Date()) {
  const clock = () => {
    const t = now()
    return t instanceof Date ? t : new Date(t)
  }
  try {
    fs.mkdirSync(dir, { recursive: true })
    const today = clock()
    const cutoff = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - KEEP_DAYS * 86400000
    for (const n of fs.readdirSync(dir)) {
      const m = FILE.exec(n)
      if (m && Date.UTC(+m[1], +m[2] - 1, +m[3]) < cutoff) fs.rmSync(path.join(dir, n), { force: true })
    }
  } catch {
    /* 로그가 안 돼도 앱은 계속 */
  }
  const write = (level, code, fields) => {
    try {
      const t = clock()
      const kv = Object.entries(fields || {}).map(([k, v]) => `${safeName(k)}=${safe(v)}`)
      const line = [t.toISOString(), level, safeName(code), ...kv].join('\t') + '\n'
      fs.appendFileSync(path.join(dir, `watson-${t.toISOString().slice(0, 10)}.log`), line)
    } catch {
      /* 무시 */
    }
  }
  return { info: (c, f) => write('INFO', c, f), error: (c, f) => write('ERROR', c, f) }
}

module.exports = { createLog }
