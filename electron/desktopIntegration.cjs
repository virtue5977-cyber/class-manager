'use strict'
// 자동 실행·바탕화면 바로가기의 순수 부분(시험됨). Electron·Windows에 닿는 일은 main.cjs가 한다.
const path = require('node:path')

/** portable exe는 임시 폴더에서 풀려 실행되므로 진짜 exe 경로는 PORTABLE_EXECUTABLE_FILE이다. */
function exePath(env, app) {
  return (env && env.PORTABLE_EXECUTABLE_FILE) || app.getPath('exe')
}

const samePath = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()
const isWatson = (it) => /watson/i.test(`${it && it.name} ${it && it.path}`)

/**
 * 자동 실행이 옛 경로로 등록돼 있으면(폴더를 옮김) 지금 exe로 옮겨 등록하고 옛 항목을 지운다.
 * get(path) = app.getLoginItemSettings({ path }) (Electron 모양: openAtLogin, executableWillLaunchAtLogin, launchItems[{name,path,enabled}]).
 * last = 마지막으로 등록한 경로(userData에 저장), launchItems에 안 나와도 지울 수 있게 한다.
 * 고쳤으면 true. 끝에 지금 켜져 있으면 save(exe).
 */
function syncAutostart({ get, set, exe, last, save }) {
  const cur = get(exe) || {}
  const onNow = !!(cur.openAtLogin || cur.executableWillLaunchAtLogin)
  const stale = new Map()
  for (const it of cur.launchItems || []) {
    if (it && it.enabled !== false && it.path && isWatson(it) && !samePath(it.path, exe)) stale.set(String(it.path).toLowerCase(), it.path)
  }
  if (last && !samePath(last, exe) && !stale.has(String(last).toLowerCase())) {
    const l = get(last) || {}
    if (l.openAtLogin || l.executableWillLaunchAtLogin) stale.set(String(last).toLowerCase(), last)
  }
  let changed = false
  if (stale.size) {
    // Windows는 자동 실행을 앱 이름(레지스트리 값 이름)으로 기억한다. 옛 항목을 먼저 끄고 새 경로를 나중에 켜야
    // 끄는 일이 방금 켠 항목까지 지우지 않는다.
    for (const p of stale.values()) set({ openAtLogin: false, path: p })
    set({ openAtLogin: true, path: exe })
    changed = true
  }
  if ((onNow || changed) && save) save(exe)
  return changed
}

/** 개발용 실행(패키지 아님·portable 아님)에서는 자동 실행·바로가기를 쓰지 않는다. */
function usable(app, env) {
  return !!(app.isPackaged || (env && env.PORTABLE_EXECUTABLE_FILE))
}
const DEV_MSG = '개발용 실행에서는 쓸 수 없습니다'

function shortcutTarget(desktopDir) {
  return path.join(desktopDir, 'Watson.lnk')
}

function asBool(v) {
  if (typeof v !== 'boolean') throw new Error('잘못된 값입니다.')
  return v
}

/** 0.13 때 만든 바로가기 자리: 시작프로그램 폴더와 바탕화면의 Watson.lnk(Windows 경로). */
function oldShortcutPaths({ appData, desktop }) {
  const W = path.win32
  return [W.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Watson.lnk'), W.join(desktop, 'Watson.lnk')]
}

/**
 * 옛 바로가기(0.13 시절 exe 경로)를 지금 exe로 고친다. 대상이 Watson*.exe일 때만(다른 프로그램을 가리키는 바로가기는 건드리지 않음).
 * read(p) = shell.readShortcutLink(p)({ target }), write(p, 'replace', { target, cwd }) = shell.writeShortcutLink, remove(p) = 파일 지우기.
 * startup = 시작프로그램 폴더의 Watson.lnk. 자동 실행(로그인 항목)이 켜져 있으면(autostartOn) 그 .lnk는 고치지 않고 지운다
 * (둘 다 남으면 로그인 때 두 번 켜진다). 던지지 않는다. 수만 돌려준다(로그에는 수만).
 */
function fixOldShortcuts({ read, write, exists, remove, exe, paths, startup, autostartOn }) {
  const W = path.win32
  let fixed = 0
  let removed = 0
  let failed = 0
  for (const p of paths || []) {
    let target
    try {
      if (!exists(p)) continue
      const d = read(p)
      target = d && d.target
    } catch {
      continue
    }
    if (typeof target !== 'string' || !target || !/^watson.*\.exe$/i.test(W.basename(target))) continue
    const isStartup = !!startup && samePath(p, startup)
    if (isStartup && autostartOn && typeof remove === 'function') {
      try { remove(p); removed++ } catch { failed++ }
      continue
    }
    if (samePath(target, exe)) continue
    try {
      if (write(p, 'replace', { target: exe, cwd: W.dirname(exe) })) fixed++
      else failed++
    } catch {
      failed++
    }
  }
  return { fixed, removed, failed }
}

module.exports = { exePath, syncAutostart, usable, DEV_MSG, shortcutTarget, asBool, oldShortcutPaths, fixOldShortcuts }
