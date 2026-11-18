import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

/** preload.cjs를 sandbox:true와 같은 조건(require는 'electron'만)으로 돌려, 화면에 내놓는 API를 돌려준다. */
export function loadPreload(ipcRenderer: unknown = { invoke: async () => undefined, on: () => {}, removeListener: () => {}, send: () => {} }) {
  const file = path.resolve(__dirname, '../../electron/preload.cjs')
  const exposed: Record<string, unknown> = {}
  const electron = {
    contextBridge: { exposeInMainWorld: (k: string, v: unknown) => { exposed[k] = v } },
    ipcRenderer,
    webUtils: { getPathForFile: () => '' },
  }
  const sandboxRequire = (id: string) => {
    if (id === 'electron') return electron
    throw new Error(`sandbox preload에서는 '${id}'를 불러올 수 없습니다`)
  }
  const code = fs.readFileSync(file, 'utf8')
  const fnc = vm.runInNewContext(`(function (require, module, exports, process) {\n${code}\n})`, { console, setTimeout, clearTimeout, Promise })
  const module = { exports: {} }
  fnc(sandboxRequire, module, module.exports, { platform: 'win32', versions: {}, env: {} })
  return exposed
}
