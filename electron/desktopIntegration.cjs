'use strict'
// 자동 실행·바탕화면 바로가기의 순수 부분(시험됨). Electron·Windows에 닿는 일은 main.cjs가 한다.
const path = require('node:path')

/** portable exe는 임시 폴더에서 풀려 실행되므로 진짜 exe 경로는 PORTABLE_EXECUTABLE_FILE이다. */
function exePath(env, app) {
  return (env && env.PORTABLE_EXECUTABLE_FILE) || app.getPath('exe')
}

/** 켜져 있는데 등록된 경로가 지금 exe와 다르면 다시 설정한다. 다시 설정했으면 true. */
function syncAutostart({ get, set, exe }) {
  const s = get() || {}
  if (s.openAtLogin && s.path !== exe) {
    set({ openAtLogin: true, path: exe })
    return true
  }
  return false
}

function shortcutTarget(desktopDir) {
  return path.join(desktopDir, 'Watson.lnk')
}

function asBool(v) {
  if (typeof v !== 'boolean') throw new Error('잘못된 값입니다.')
  return v
}

module.exports = { exePath, syncAutostart, shortcutTarget, asBool }
