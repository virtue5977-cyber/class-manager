const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  /** exe 판(SHELL). 6부터 구글 Gemini 주소 접속 가능 */
  shell: 6,
  isDesktop: true,
  onLock(cb) {
    const h = () => cb()
    ipcRenderer.on('app-lock', h)
    return () => ipcRenderer.removeListener('app-lock', h)
  },
  update: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    restart: () => ipcRenderer.invoke('update:restart'),
    onState(cb) {
      const h = (_e, st) => cb(st)
      ipcRenderer.on('update:state', h)
      return () => ipcRenderer.removeListener('update:state', h)
    },
  },
  google: {
    status: () => ipcRenderer.invoke('google:status'),
    setClient: (json) => ipcRenderer.invoke('google:setClient', json),
    login: () => ipcRenderer.invoke('google:login'),
    logout: () => ipcRenderer.invoke('google:logout'),
    api: (method, path, body) => ipcRenderer.invoke('google:api', method, path, body),
  },
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    ask: (req) => ipcRenderer.invoke('ai:ask', req),
  },
  stt: {
    status: () => ipcRenderer.invoke('stt:status'),
    install: (model) => ipcRenderer.invoke('stt:install', model),
    remove: () => ipcRenderer.invoke('stt:remove'),
    run: (opts) => ipcRenderer.invoke('stt:run', opts),
    cancel: () => ipcRenderer.invoke('stt:cancel'),
    onProgress(cb) {
      const h = (_e, p) => cb(p)
      ipcRenderer.on('stt:progress', h)
      return () => ipcRenderer.removeListener('stt:progress', h)
    },
    pathOf: (file) => webUtils.getPathForFile(file),
  },
  folder: {
    pick: () => ipcRenderer.invoke('folder:pick'),
    open: (p) => ipcRenderer.invoke('folder:open', p),
    list: (p) => ipcRenderer.invoke('folder:list', p),
  },
  pdf: {
    sizes: ['A4', 'B4'],
    save: (name, opts) => ipcRenderer.invoke('pdf:save', name, opts),
  },
  vault: {
    status: () => ipcRenderer.invoke('vault:status'),
    unlockDpapi: () => ipcRenderer.invoke('vault:unlock-dpapi'),
    readBackup: () => ipcRenderer.invoke('vault:read-backup'),
    store: (v) => ipcRenderer.invoke('vault:store', v),
  },
  agy: {
    status: () => ipcRenderer.invoke('ai:agy:status'),
    ask: (prompt) => ipcRenderer.invoke('ai:agy:ask', prompt),
  },
  backup: {
    pick: () => ipcRenderer.invoke('backup:pick'),
    current: () => ipcRenderer.invoke('backup:current'),
    write: (name, bytes) => ipcRenderer.invoke('backup:write', name, bytes),
    read: (name) => ipcRenderer.invoke('backup:read', name),
    list: () => ipcRenderer.invoke('backup:list'),
    delete: (name) => ipcRenderer.invoke('backup:delete', name),
  },
})
