const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
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
  folder: {
    pick: () => ipcRenderer.invoke('folder:pick'),
    open: (p) => ipcRenderer.invoke('folder:open', p),
    list: (p) => ipcRenderer.invoke('folder:list', p),
  },
  pdf: {
    sizes: ['A4', 'B4'],
    save: (name, opts) => ipcRenderer.invoke('pdf:save', name, opts),
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
