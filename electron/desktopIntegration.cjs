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
    set({ openAtLogin: true, path: exe })
    for (const p of stale.values()) set({ openAtLogin: false, path: p })
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

module.exports = { exePath, syncAutostart, usable, DEV_MSG, shortcutTarget, asBool }
