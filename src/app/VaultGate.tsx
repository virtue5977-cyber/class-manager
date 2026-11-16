import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createDb, type AppDB } from '../lib/db/schema'
import { isDesktopApp } from '../lib/settings'
import { getDesktop, type DesktopVaultApi, type PublicVault } from '../lib/desktop/bridge'
import { openVaultDb } from '../lib/vault/vaultDb'
import { VaultRewrapContext } from '../lib/vault/rewrapContext'
import { normalizeRecoveryCode, passKeyRaw, recoveryKeyRaw, unwrapDek, wrapDek, type VaultPayload } from '../lib/vault/keys'
import { fromBase64, toBase64 } from '../lib/backup/crypto'
import { restoreIntoNewVault } from '../lib/backup/restoreVault'
import type { DerivedPassKey } from '../lib/backup/service'

export type SetupReason = 'migrate' | 'first-install' | 'incomplete'
export type RenderSetup = (p: { reason: SetupReason; done: () => void }) => ReactNode

/** 이만큼 틀리면 백업 파일에서 복원하는 길을 보인다(다시 시도는 계속 된다). */
export const RESTORE_HINT_AFTER = 5
const OLD_DB = 'class-manager'

type Phase =
  | { k: 'loading' }
  | { k: 'setup'; reason: SetupReason }
  | { k: 'open'; db: AppDB }
  | { k: 'unlock'; vault: PublicVault; dpapi?: boolean }
  | { k: 'broken' }
  | { k: 'error'; message: string }

/** Task 10 마법사가 들어오기 전 자리. */
export function SetupPending({ reason }: { reason: SetupReason }) {
  return (
    <div className="lock">
      <div className="card stack vault-card" data-reason={reason}>
        <h2>Watson</h2>
        <p>준비 중입니다. 잠시 뒤 다시 켜 주세요.</p>
      </div>
    </div>
  )
}

async function hasOldDb(): Promise<boolean> {
  try {
    return (await indexedDB.databases()).some((d) => d.name === OLD_DB)
  } catch {
    return false
  }
}

const payloadOf = (v: PublicVault, dek: Uint8Array): VaultPayload => ({
  v: 1, keyId: v.keyId, dbName: v.dbName, pass: v.pass, ...(v.recovery ? { recovery: v.recovery } : {}), dekB64: toBase64(dek),
})

/**
 * 시작 관문: 열쇠(vault)를 풀어 DB를 연 뒤에만 자식(AppProviders 등)을 그린다.
 * exe(desktop.vault 있음)가 아니면 지금처럼 평문 createDb()를 쓴다.
 * DEK는 이 컴포넌트의 메모리(ref)에만 있다.
 */
export default function VaultGate({ children, renderSetup }: { children: (db: AppDB) => ReactNode; renderSetup?: RenderSetup }) {
  const [api] = useState<DesktopVaultApi | null>(() => (isDesktopApp() && getDesktop()?.vault) || null)
  const [webDb] = useState<AppDB | null>(() => (api ? null : createDb()))
  const [phase, setPhase] = useState<Phase>({ k: 'loading' })
  const dekRef = useRef<Uint8Array | null>(null)
  const vaultRef = useRef<PublicVault | null>(null)
  const runId = useRef(0)

  useEffect(() => {
    try {
      const r = getDesktop()?.bundle?.alive?.()
      if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {})
    } catch { /* 옛 exe */ }
  }, [])

  const openWith = useCallback(async (dek: Uint8Array, vault: PublicVault): Promise<Phase> => {
    const db = openVaultDb(vault.dbName, dek)
    try {
      await db.open()
      if ((await db.meta.get('vault'))?.complete !== true) {
        db.close()
        return { k: 'setup', reason: 'incomplete' }
      }
    } catch {
      db.close()
      return { k: 'error', message: '자료를 열지 못했습니다.' }
    }
    dekRef.current = dek
    vaultRef.current = vault
    return { k: 'open', db }
  }, [])

  const run = useCallback(async () => {
    if (!api) return
    const id = ++runId.current
    const set = (p: Phase) => { if (id === runId.current) setPhase(p) }
    set({ k: 'loading' })
    try {
      const st = await api.status()
      if (st.state === 'none') return set({ k: 'setup', reason: (await hasOldDb()) ? 'migrate' : 'first-install' })
      if (st.state === 'broken' || !st.vault) return set({ k: 'broken' })
      if (st.state === 'ok') {
        const b64 = st.dekB64 ?? (await api.unlockDpapi().catch(() => null))
        if (b64) return set(await openWith(fromBase64(b64), st.vault))
      }
      set({ k: 'unlock', vault: st.vault, dpapi: st.dpapi })
    } catch (e) {
      set({ k: 'error', message: e instanceof Error && e.message ? e.message : '열쇠를 읽지 못했습니다.' })
    }
  }, [api, openWith])

  useEffect(() => { void run() }, [run])

  const openDb = phase.k === 'open' ? phase.db : null
  useEffect(() => () => { openDb?.close() }, [openDb])

  /** 암호구 바꾸기: 메모리의 DEK를 새 passKey로 다시 감싸고, 복구 감싸기는 그대로 둔다. */
  const rewrap = useCallback(async (k: DerivedPassKey) => {
    const dek = dekRef.current
    const cur = vaultRef.current
    if (!api || !dek || !cur) throw new Error('열쇠가 열려 있지 않습니다.')
    const next: PublicVault = { ...cur, pass: { ...wrapDek(dek, k.raw, cur.keyId, 'pass', k.salt, k.iter), updatedAt: new Date().toISOString() } }
    await api.store(payloadOf(next, dek))
    vaultRef.current = next
  }, [api])

  if (webDb) return <>{children(webDb)}</>
  if (!api) return null

  switch (phase.k) {
    case 'loading':
      return null
    case 'open':
      return <VaultRewrapContext.Provider value={rewrap}>{children(phase.db)}</VaultRewrapContext.Provider>
    case 'setup': {
      const done = () => { void run() }
      return <>{renderSetup ? renderSetup({ reason: phase.reason, done }) : <SetupPending reason={phase.reason} />}</>
    }
    case 'unlock':
      return (
        <UnlockScreen
          vault={phase.vault}
          dpapi={phase.dpapi}
          api={api}
          onOpen={async (dek) => setPhase(await openWith(dek, phase.vault))}
          onRestored={run}
        />
      )
    case 'broken':
      return <BrokenScreen api={api} onRestored={run} />
    case 'error':
      return (
        <div className="lock">
          <div className="card stack vault-card">
            <h2>자료 열기</h2>
            <p className="error" role="alert">{phase.message}</p>
            <button type="button" className="primary" onClick={() => void run()}>다시 시도</button>
          </div>
        </div>
      )
  }
}

type Tab = 'pass' | 'recovery'

function UnlockScreen({ vault, dpapi, api, onOpen, onRestored }: {
  vault: PublicVault
  dpapi?: boolean
  api: DesktopVaultApi
  onOpen: (dek: Uint8Array) => Promise<void>
  onRestored: () => void
}) {
  const [tab, setTab] = useState<Tab>('pass')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [fails, setFails] = useState(0)
  const [restoring, setRestoring] = useState(false)

  if (restoring) return <RestoreScreen api={api} replacing onBack={() => setRestoring(false)} onDone={onRestored} />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !value) return
    setBusy(true)
    setError(undefined)
    let dek: Uint8Array | null = null
    try {
      if (tab === 'pass') {
        const raw = await passKeyRaw(value, fromBase64(vault.pass.salt), vault.pass.iter)
        try { dek = unwrapDek(vault.pass, raw, vault.keyId, 'pass') } catch { dek = null }
        if (!dek) { setFails((f) => f + 1); setError('암호구가 맞지 않습니다') }
      } else if (vault.recovery) {
        let code: string
        try { code = normalizeRecoveryCode(value) } catch (err) {
          setError((err as Error).message)
          return
        }
        const raw = await recoveryKeyRaw(code, fromBase64(vault.recovery.salt), vault.recovery.iter)
        try { dek = unwrapDek(vault.recovery, raw, vault.keyId, 'recovery') } catch { dek = null }
        if (!dek) { setFails((f) => f + 1); setError('복구 코드가 맞지 않습니다') }
      }
      if (!dek) return
      // DPAPI로 다시 감싼다(다음부터 묻지 않게). 실패해도 여는 것은 막지 않는다.
      try { await api.store(payloadOf(vault, dek)) } catch { /* 저장 실패: 다음에 다시 묻는다 */ }
      setValue('')
      await onOpen(dek)
    } finally {
      setBusy(false)
    }
  }

  const pick = (t: Tab) => { setTab(t); setValue(''); setError(undefined) }

  return (
    <div className="lock">
      <form className="card stack vault-card" onSubmit={submit} aria-label="자료 열기">
        <h2>자료 열기</h2>
        <p className="muted">
          {dpapi === false
            ? '이 PC에서는 윈도우 보호 저장소(DPAPI)를 쓸 수 없어, 켤 때마다 암호구를 묻습니다.'
            : '이 PC의 윈도우 계정으로 열쇠를 자동으로 열지 못했습니다(다른 PC·다른 계정이거나 윈도우 보호 저장소를 쓸 수 없음). 한 번 열면 다음부터는 묻지 않으며, 보호 저장소를 쓸 수 없는 PC라면 켤 때마다 암호구를 묻습니다.'}
        </p>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'pass'} className={tab === 'pass' ? 'active' : ''} onClick={() => pick('pass')}>백업 암호구</button>
          <button type="button" role="tab" aria-selected={tab === 'recovery'} className={tab === 'recovery' ? 'active' : ''} onClick={() => pick('recovery')}>복구 코드</button>
        </div>
        {tab === 'pass' ? (
          <label>
            백업 암호구
            <input type="password" autoFocus autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
          </label>
        ) : vault.recovery ? (
          <label>
            복구 코드
            <input type="text" autoFocus autoComplete="off" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
          </label>
        ) : (
          <p className="muted">이 열쇠에는 복구 코드가 없습니다. 백업 암호구로 여세요.</p>
        )}
        <button type="submit" className="primary" disabled={busy || !value}>{busy ? '여는 중…' : '열기'}</button>
        {error && <p className="error" role="alert">{error}</p>}
        {fails >= RESTORE_HINT_AFTER && (
          <div className="stack">
            <p className="notice">{fails}번 틀렸습니다. 암호구와 복구 코드를 모두 잊었다면 백업 파일(과 그 파일을 만든 때의 암호구)로 자료를 되살릴 수 있습니다. 계속 다시 시도해도 됩니다.</p>
            <button type="button" onClick={() => setRestoring(true)}>백업 파일에서 복원</button>
          </div>
        )}
      </form>
    </div>
  )
}

function BrokenScreen({ api, onRestored }: { api: DesktopVaultApi; onRestored: () => void }) {
  const [restoring, setRestoring] = useState(false)
  if (restoring) return <RestoreScreen api={api} onBack={() => setRestoring(false)} onDone={onRestored} />
  return (
    <div className="lock">
      <div className="card stack vault-card">
        <h2>자료 열기</h2>
        <p>열쇠 파일이 손상되어 자료를 열 수 없습니다. 직전 열쇠 파일(.bak)도 쓸 수 없었습니다.</p>
        <p className="muted">백업 파일과 그 파일을 만든 때의 암호구가 있으면 자료를 되살릴 수 있습니다.</p>
        <button type="button" className="primary" onClick={() => setRestoring(true)}>백업 파일에서 복원</button>
      </div>
    </div>
  )
}

/** 파일 내용 읽기(arrayBuffer 없는 환경은 FileReader로) */
function fileBytes(f: File): Promise<Uint8Array> {
  if (typeof f.arrayBuffer === 'function') return f.arrayBuffer().then((b) => new Uint8Array(b))
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => rej(r.error)
    r.readAsArrayBuffer(f)
  })
}

function saveCodeFile(code: string) {
  const text = `Watson 복구 코드\n\n${code}\n\n자료를 열 열쇠입니다. 남이 보지 못하는 곳에 두세요.\n`
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'Watson_복구코드.txt'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function RestoreScreen({ api, replacing, onBack, onDone }: {
  api: DesktopVaultApi
  replacing?: boolean
  onBack: () => void
  onDone: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [code, setCode] = useState<string>()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !file || !pass) return
    setBusy(true)
    setError(undefined)
    try {
      const r = await restoreIntoNewVault(await fileBytes(file), pass, { store: (p) => api.store(p) })
      setPass('')
      setCode(r.recoveryCode)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : '복원하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (code) {
    return (
      <div className="lock">
        <div className="card stack vault-card">
          <h2>새 복구 코드</h2>
          <p>자료를 되살렸습니다. 아래 복구 코드는 지금 한 번만 보입니다. 인쇄하거나 파일로 저장해 두세요.</p>
          <p className="recovery-code" data-testid="recovery-code">{code}</p>
          <div className="row">
            <button type="button" onClick={() => window.print()}>인쇄</button>
            <button type="button" onClick={() => saveCodeFile(code)}>파일로 저장</button>
          </div>
          <button type="button" className="primary" onClick={() => { setCode(undefined); onDone() }}>적어 두었습니다. 열기</button>
        </div>
      </div>
    )
  }

  return (
    <div className="lock">
      <form className="card stack vault-card" onSubmit={submit} aria-label="백업 파일에서 복원">
        <h2>백업 파일에서 복원</h2>
        <p className="muted">백업 파일과 그 파일을 만든 때의 암호구로 자료를 새로 엽니다. 새 열쇠와 새 복구 코드를 만듭니다.</p>
        {replacing && <p className="muted">복원하면 지금 열지 못한 자료는 더는 열 수 없습니다. 암호구나 복구 코드를 찾을 수 있다면 먼저 그것으로 여세요.</p>}
        <label>
          백업 파일
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={busy} />
        </label>
        <label>
          백업 파일 암호구
          <input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} disabled={busy} />
        </label>
        <p className="muted">이 PC에 있던 예전 자동 백업 파일은 자동으로 정리되지 않습니다. 필요 없으면 백업 폴더에서 직접 지우세요.</p>
        <div className="row">
          <button type="submit" className="primary" disabled={busy || !file || !pass}>{busy ? '복원하는 중…' : '복원'}</button>
          <button type="button" onClick={onBack} disabled={busy}>돌아가기</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </div>
  )
}
