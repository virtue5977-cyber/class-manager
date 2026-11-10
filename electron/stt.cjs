// 음성 받아쓰기(선택 내려받기): whisper.cpp 실행 파일과 모델을 고정 주소·SHA-256으로 받아 이 컴퓨터 안에서만 돌린다.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const STT_FILES = {
  bin: {
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip',
    sha256: 'b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732',
    maxBytes: 20 * 1024 * 1024,
  },
  models: {
    fast: {
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
      sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
      file: 'ggml-small-q5_1.bin',
      label: '빠름(약 0.2GB)',
      maxBytes: 300 * 1024 * 1024,
    },
    accurate: {
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
      sha256: '19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f',
      file: 'ggml-medium-q5_0.bin',
      label: '정확(약 0.5GB)',
      maxBytes: 700 * 1024 * 1024,
    },
  },
}

const TOO_BIG = '받을 파일이 너무 큽니다.'
const BAD_HASH = '파일 확인(SHA-256)에 실패했습니다.'

/** dest.part에 흘려 쓰며 해시를 재고, 맞으면 dest로 바꾼다. 실패·취소면 .part를 지운다. */
async function downloadVerified(fetchFn, url, dest, sha256, { onProgress, maxBytes, timeoutMs, idleMs, signal } = {}) {
  const part = dest + '.part'
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  // 멈춤: idleMs 동안 받은 것이 없으면 그만둔다
  let idle = null
  const poke = () => {
    if (!idleMs) return
    clearTimeout(idle)
    idle = setTimeout(() => ctl.abort(), idleMs)
  }
  poke()
  const onAbort = () => ctl.abort()
  signal?.addEventListener('abort', onAbort)
  let out
  try {
    const res = await fetchFn(url, { signal: ctl.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`받지 못했습니다(${res.status}).`)
    const total = Number(res.headers.get('content-length') || 0)
    if (total > maxBytes) throw new Error(TOO_BIG)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    out = fs.createWriteStream(part)
    const hash = crypto.createHash('sha256')
    const reader = res.body.getReader()
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      poke()
      if (received > maxBytes) throw new Error(TOO_BIG)
      hash.update(value)
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r))
      onProgress?.(received, total)
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())))
    out = null
    if (hash.digest('hex') !== sha256) throw new Error(BAD_HASH)
    fs.renameSync(part, dest)
  } catch (e) {
    if (out) await new Promise((r) => { out.once('close', r); out.destroy() })
    fs.rmSync(part, { force: true })
    if (ctl.signal.aborted && !(e instanceof Error && (e.message === TOO_BIG || e.message === BAD_HASH))) {
      throw new Error(signal?.aborted ? '그만두었습니다.' : '시간이 너무 오래 걸려 그만두었습니다.')
    }
    throw e
  } finally {
    clearTimeout(timer)
    clearTimeout(idle)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** 실행 파일 zip에서 whisper-cli.exe와 dll만 dir에 푼다(경로 밖 이름·폴더는 거부). */
async function extractBin(zipBytes, dir) {
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(zipBytes)
  fs.mkdirSync(dir, { recursive: true })
  const out = []
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name]
    if (f.dir) continue
    const parts = name.split(/[\\/]/)
    if (parts.some((p) => p === '..' || p === '')) continue
    const base = parts[parts.length - 1]
    if (!(base === 'whisper-cli.exe' || /^[A-Za-z0-9_.-]+\.dll$/.test(base))) continue
    if (parts.length !== 2 || parts[0] !== 'Release') continue // Release/이름 꼴만
    fs.writeFileSync(path.join(dir, base), await f.async('nodebuffer'))
    out.push(base)
  }
  return out
}

function whisperArgs({ model, input, outBase, threads }) {
  return ['-m', model, '-f', input, '-l', 'ko', '-otxt', '-of', outBase, '-np', '-pp', '-t', String(threads)]
}

function parseProgress(line) {
  const m = /progress\s*=\s*(\d+)%/.exec(line)
  return m ? Number(m[1]) : null
}

/** 받기·받아쓰기는 한 번에 하나. 시작은 동기로 자리를 잡아(await 앞) 겹치지 않게 하고,
 * 프로그램이 붙기 전에 누른 취소도 기억한다. */
function createSttJobs(kill) {
  let cur = null
  return {
    start(kind) {
      if (cur) throw new Error('이미 받거나 받아쓰는 중입니다.')
      const job = {
        kind,
        cancelled: false,
        child: null,
        abort: undefined,
        attach(child) {
          job.child = child
          if (job.cancelled) kill(child)
        },
        done() {
          if (cur === job) cur = null
        },
      }
      cur = job
      return job
    },
    cancel() {
      if (!cur) return
      cur.cancelled = true
      if (cur.child) kill(cur.child)
      cur.abort?.()
    },
    busy: () => !!cur,
    current: () => cur,
  }
}

module.exports = { createSttJobs, STT_FILES, downloadVerified, extractBin, whisperArgs, parseProgress }
