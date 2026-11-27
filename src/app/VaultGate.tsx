import Dexie from 'dexie'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createDb, type AppDB } from '../lib/db/schema'
import { isDesktopApp } from '../lib/settings'
import { getDesktop, type DesktopVaultApi, type PublicVault } from '../lib/desktop/bridge'
import { openVaultDb } from '../lib/vault/vaultDb'
import { vaultTestDb } from '../lib/vault/benchHook'
import { VaultRewrapContext } from '../lib/vault/rewrapContext'
import { normalizeRecoveryCode, passKeyRaw, recoveryKeyRaw, unwrapDek, verifyMetaCheck, wrapDek, type VaultPayload } from '../lib/vault/keys'
import { fromBase64, toBase64 } from '../lib/backup/crypto'
import { restoreIntoNewVault } from '../lib/backup/restoreVault'
import type { DerivedPassKey } from '../lib/backup/service'
import { canStartOver, MIGRATION_MARKER, startOver } from '../lib/vault/migrate'

export type SetupReason = 'migrate' | 'first-install' | 'incomplete'
/** incomplete일 때 key: 이 열쇠의 DEK·keyId·DB 이름(마법사가 완료 행을 확인해 이어 할지 정한다). */
export interface SetupKey { dek: Uint8Array; keyId: string; dbName: string }
/** done(opened): 마법사가 방금 만든·확인한 열쇠. 주면 그 열쇠로 바로 연다(checkOpen 확인은 그대로). 없으면 상태를 다시 읽는다. */
export type RenderSetup = (p: { reason: SetupReason; done: (opened?: SetupKey) => void; key?: SetupKey }) => ReactNode

/** 이만큼 틀리면 백업 파일에서 복원하는 길을 보인다(다시 시도는 계속 된다). */
export const RESTORE_HINT_AFTER = 5
const OLD_DB = 'class-manager'

type Phase =
  | { k: 'loading' }
  | { k: 'setup'; reason: SetupReason; key?: SetupKey }
  | { k: 'open'; db: AppDB; notice?: string }
  | { k: 'unlock'; vault: PublicVault; dpapi?: boolean; startOver?: boolean }
  | { k: 'broken' }
  /** 열쇠는 있는데 그 DB가 이 PC(이 계정)에 없다. 아무것도 만들거나 쓰지 않는다. */
  | { k: 'missing' }
  /** DB의 meta 확인값이 이 열쇠와 맞지 않는다. 아무것도 쓰지 않는다. */
  | { k: 'wrong-key' }
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
    try { return await Dexie.exists(OLD_DB) } catch { return false }
  }
}

export const STORE_FAILED_NOTICE = '이 PC에 열쇠를 저장하지 못해 다음에도 암호구를 묻습니다'

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
  // vaultTestDb: 성능 시험 전용(DEV·bench 빌드에서 ?vaultTest=1). 배포 빌드에서는 늘 null.
  const [webDb] = useState<AppDB | null>(() => (api ? null : vaultTestDb() ?? createDb()))
  const [phase, setPhase] = useState<Phase>({ k: 'loading' })
  const phaseRef = useRef<Phase['k']>('loading')
  phaseRef.current = phase.k
  const dekRef = useRef<Uint8Array | null>(null)
  const vaultRef = useRef<PublicVault | null>(null)
  const runId = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const current = (id: number) => mounted.current && id === runId.current

  /**
   * 이 열쇠의 DB를 확인하고 연다. 없으면 만들지 않고 'missing', 확인값이 다르면 'wrong-key'(쓰지 않음),
   * 완료 행이 없으면 'incomplete'. 그 사이 다른 실행이 시작됐거나 언마운트됐으면 열었던 DB를 닫고 null.
   */
  const checkOpen = useCallback(async (dek: Uint8Array, vault: PublicVault, id: number): Promise<Phase | null> => {
    let exists: boolean
    try { exists = await Dexie.exists(vault.dbName) } catch { return current(id) ? { k: 'error', message: '자료를 열지 못했습니다.' } : null }
    if (!current(id)) return null
    if (!exists) return { k: 'missing' }
    const db = openVaultDb(vault.dbName, dek)
    let row: Record<string, unknown> | undefined
    let migrating = false
    try {
      await db.open()
      row = await db.meta.get('vault')
      // 옮기기 표시가 남아 있으면(완료 행 뒤 새 백업·옛 DB 지우기 전에 꺼짐) 앱을 열지 않는다(평문·암호화 두 길을 함께 두지 않음).
      migrating = !!(await db.meta.get(MIGRATION_MARKER))
    } catch {
      db.close()
      return current(id) ? { k: 'error', message: '자료를 열지 못했습니다.' } : null
    }
    if (!current(id)) { db.close(); return null }
    const bound = row && (row.keyId !== undefined || row.check !== undefined)
    const incomplete: Phase = { k: 'setup', reason: 'incomplete', key: { dek, keyId: vault.keyId, dbName: vault.dbName } }
    let next: Phase
    if (!row) next = incomplete
    else if (bound) {
      if (!verifyMetaCheck(dek, vault.keyId, row)) next = { k: 'wrong-key' }
      else next = row.complete === true && !migrating ? { k: 'open', db } : incomplete
    } else next = row.complete === true ? { k: 'wrong-key' } : incomplete // 묶음 확인값 없는 완료 행은 믿지 않는다
    if (next.k !== 'open') db.close()
    return next
  }, [])

  const commitOpen = (p: Phase, dek: Uint8Array, vault: PublicVault) => {
    if (p.k === 'open') {
      dekRef.current = dek
      vaultRef.current = vault
    }
    setPhase(p)
  }

  const run = useCallback(async () => {
    if (!api) return
    const id = ++runId.current
    dekRef.current = null
    vaultRef.current = null
    const set = (p: Phase) => { if (current(id)) setPhase(p) }
    set({ k: 'loading' })
    try {
      const st = await api.status()
      if (st.state === 'none') return set({ k: 'setup', reason: (await hasOldDb()) ? 'migrate' : 'first-install' })
      if (st.state === 'broken' || !st.vault) return set({ k: 'broken' })
      if (st.state === 'ok') {
        const b64 = st.dekB64 ?? (await api.unlockDpapi().catch(() => null))
        if (b64) {
          const dek = fromBase64(b64)
          const p = await checkOpen(dek, st.vault, id)
          if (p) commitOpen(p, dek, st.vault)
          return
        }
      }
      // 완료 행 없는 새 DB(끝나지 않은 옮기기·첫 설치)면 '처음부터 다시'를 보인다(완료 행이 있으면 절대 아님).
      let over = false
      if (api.reset) { try { over = await canStartOver(st.vault.dbName, OLD_DB) } catch { over = false } }
      set({ k: 'unlock', vault: st.vault, dpapi: st.dpapiAvailable, startOver: over })
    } catch (e) {
      set({ k: 'error', message: e instanceof Error && e.message ? e.message : '열쇠를 읽지 못했습니다.' })
    }
  }, [api, checkOpen])

  /** 마법사가 넘긴 열쇠로 곧바로 연다. 열쇠 파일(공개 부분)이 그 열쇠와 맞지 않거나 읽지 못하면 상태를 다시 읽는다. */
  const openWith = useCallback(async (opened: SetupKey) => {
    if (!api || phaseRef.current !== 'setup') return // 이미 열렸거나 다른 화면이면 늦은 호출은 무시
    const id = ++runId.current
    dekRef.current = null
    vaultRef.current = null
    try {
      const st = await api.status()
      if (!current(id)) return
      if (st.vault && st.vault.keyId === opened.keyId && st.vault.dbName === opened.dbName) {
        const p = await checkOpen(opened.dek, st.vault, id)
        if (p) commitOpen(p, opened.dek, st.vault)
        return
      }
    } catch { /* 아래에서 상태를 다시 읽는다 */ }
    if (current(id)) void run()
  }, [api, checkOpen, run])

  /** 암호구·복구 코드로 푼 DEK: DB를 먼저 확인하고, 열 수 있을 때만 DPAPI로 다시 감싸 저장한다. */
  const unlocked = useCallback(async (dek: Uint8Array, vault: PublicVault) => {
    if (!api) return
    const id = ++runId.current
    const p = await checkOpen(dek, vault, id)
    if (!p) return
    if (p.k !== 'open') return commitOpen(p, dek, vault)
    let notice: string | undefined
    try { await api.store(payloadOf(vault, dek)) } catch { notice = STORE_FAILED_NOTICE }
    if (!current(id)) { p.db.close(); return }
    commitOpen({ ...p, notice }, dek, vault)
  }, [api, checkOpen])

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
      return (
        <VaultRewrapContext.Provider value={rewrap}>
          {phase.notice && <p className="banner vault-notice" role="status">{phase.notice}</p>}
          {children(phase.db)}
        </VaultRewrapContext.Provider>
      )
    case 'setup': {
      const done = (opened?: SetupKey) => { void (opened ? openWith(opened) : run()) }
      return <>{renderSetup ? renderSetup({ reason: phase.reason, done, key: phase.key }) : <SetupPending reason={phase.reason} />}</>
    }
    case 'unlock':
      return (
        <UnlockScreen
          vault={phase.vault}
          dpapi={phase.dpapi}
          api={api}
          onUnlocked={(dek) => unlocked(dek, phase.vault)}
          onRestored={run}
          onStartOver={phase.startOver && api.reset ? async () => {
            const st = await startOver({ dbName: phase.vault.dbName, reset: () => api.reset!(), oldName: OLD_DB })
            if (st === 'done') { void run(); return null }
            return st === 'refused' ? '새 자료에 기록이 있어 지우지 않았습니다.'
              : st === 'db-failed' ? '새로 만들던 자료를 지우지 못했습니다. 다시 시도하세요.'
                : '새로 만들던 자료는 지웠지만 열쇠 파일을 지우지 못했습니다. 다시 시도하세요.'
          } : undefined}
        />
      )
    case 'broken':
      return (
        <ProblemScreen api={api} onRestored={run}>
          <p>열쇠 파일이 손상되어 자료를 열 수 없습니다. 직전 열쇠 파일(.bak)도 쓸 수 없었습니다.</p>
        </ProblemScreen>
      )
    case 'missing':
      return (
        <ProblemScreen api={api} replacing onRestored={run}>
          <p>이 열쇠의 자료가 이 PC에 없습니다. 다른 PC나 다른 윈도우 계정에서 만든 열쇠일 수 있습니다.</p>
          <p className="muted">아무것도 바꾸지 않았습니다. 자료가 있는 PC·계정에서 열거나, 백업 파일에서 복원하세요.</p>
        </ProblemScreen>
      )
    case 'wrong-key':
      return (
        <ProblemScreen api={api} replacing onRestored={run}>
          <p>열쇠와 자료가 서로 맞지 않습니다. 이 열쇠로는 이 자료를 열 수 없습니다.</p>
          <p className="muted">아무것도 쓰지 않았습니다. 백업 파일에서 복원할 수 있습니다.</p>
        </ProblemScreen>
      )
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

function UnlockScreen({ vault, dpapi, api, onUnlocked, onRestored, onStartOver }: {
  vault: PublicVault
  dpapi?: boolean
  api: DesktopVaultApi
  onUnlocked: (dek: Uint8Array) => Promise<void>
  onRestored: () => void
  /** 끝나지 않은 옮기기·첫 설치일 때만: 새 DB·vault를 지우고 처음부터. 실패하면 이유 문구. */
  onStartOver?: () => Promise<string | null>
}) {
  const [tab, setTab] = useState<Tab>('pass')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [fails, setFails] = useState(0)
  const [restoring, setRestoring] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const tabRefs = { pass: useRef<HTMLButtonElement>(null), recovery: useRef<HTMLButtonElement>(null) }
  const uid = useId()
  const tabId = (t: Tab) => `${uid}-tab-${t}`
  const panelId = `${uid}-panel`

  useEffect(() => { if (error && !busy) inputRef.current?.focus() }, [error, busy])

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
      setValue('')
      await onUnlocked(dek) // DB 확인 → (열 수 있으면) DPAPI로 다시 감싸 저장 → 열기
    } finally {
      setBusy(false)
    }
  }

  const pick = (t: Tab) => { setTab(t); setValue(''); setError(undefined) }
  const onTabKey = (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const next: Tab = e.key === 'Home' ? 'pass' : e.key === 'End' ? 'recovery' : tab === 'pass' ? 'recovery' : 'pass'
    pick(next)
    tabRefs[next].current?.focus()
  }
  const tabProps = (t: Tab) => ({
    ref: tabRefs[t], id: tabId(t), type: 'button' as const, role: 'tab', 'aria-selected': tab === t, 'aria-controls': panelId,
    tabIndex: tab === t ? 0 : -1, className: tab === t ? 'active' : '', onClick: () => pick(t),
  })

  return (
    <div className="lock">
      <form className="card stack vault-card" onSubmit={submit} aria-label="자료 열기">
        <h2>자료 열기</h2>
        <p className="muted">
          {dpapi === false
            ? '이 PC에서는 윈도우 보호 저장소(DPAPI)를 쓸 수 없어, 켤 때마다 암호구를 묻습니다.'
            : '이 PC의 윈도우 계정으로 열쇠를 자동으로 열지 못했습니다(다른 PC·다른 계정이거나 윈도우 보호 저장소를 쓸 수 없음). 한 번 열면 다음부터는 묻지 않으며, 보호 저장소를 쓸 수 없는 PC라면 켤 때마다 암호구를 묻습니다.'}
        </p>
        <div className="tabs" role="tablist" aria-label="여는 방법" onKeyDown={onTabKey}>
          <button {...tabProps('pass')}>백업 암호구</button>
          <button {...tabProps('recovery')}>복구 코드</button>
        </div>
        <div role="tabpanel" id={panelId} aria-label={tab === 'pass' ? '백업 암호구로 열기' : '복구 코드로 열기'} className="stack">
          {tab === 'pass' ? (
            <label>
              백업 암호구
              <input ref={inputRef} type="password" autoFocus autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
            </label>
          ) : vault.recovery ? (
            <label>
              복구 코드
              <input ref={inputRef} type="text" autoFocus autoComplete="off" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
            </label>
          ) : (
            <p className="muted">이 열쇠에는 복구 코드가 없습니다. 백업 암호구로 여세요.</p>
          )}
        </div>
        <button type="submit" className="primary" disabled={busy || !value}>{busy ? '여는 중…' : '열기'}</button>
        {error && <p className="error" role="alert">{error}</p>}
        {onStartOver && (
          <div className="stack">
            <p className="muted">지난번 시작(자료 옮기기·처음 설정)이 끝나지 않았습니다. 암호구가 생각나지 않으면 처음부터 다시 할 수 있습니다. 옛 자료가 있으면 그대로 두고 다시 옮깁니다.</p>
            <button type="button" disabled={busy} onClick={async () => {
              setBusy(true)
              setError(undefined)
              try {
                const why = await onStartOver()
                if (why) setError(why)
              } catch { setError('처음부터 다시 하지 못했습니다.') } finally { setBusy(false) }
            }}>처음부터 다시</button>
          </div>
        )}
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

/** 열 수 없는 상태(손상·DB 없음·열쇠 불일치): 설명 + 백업 파일에서 복원. */
function ProblemScreen({ api, replacing, onRestored, children }: { api: DesktopVaultApi; replacing?: boolean; onRestored: () => void; children: ReactNode }) {
  const [restoring, setRestoring] = useState(false)
  if (restoring) return <RestoreScreen api={api} replacing={replacing} onBack={() => setRestoring(false)} onDone={onRestored} />
  return (
    <div className="lock">
      <div className="card stack vault-card">
        <h2>자료 열기</h2>
        {children}
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

export function saveCodeFile(code: string) {
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

/** 백업 파일에서 새 열쇠·새 DB로 되살리기(마법사의 '끝나지 않은 옮기기' 화면도 쓴다). */
export function RestoreScreen({ api, replacing, onBack, onDone }: {
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
  const [confirmed, setConfirmed] = useState(false)
  const ready = !!file && !!pass && (!replacing || confirmed)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !ready) return
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
        {replacing && (
          <div className="stack vault-warn">
            <p className="notice">지금 열쇠 파일을 새 열쇠로 바꿉니다. 암호구나 복구 코드를 찾을 수 있다면 먼저 그것으로 여세요.</p>
            <p className="muted">원래 윈도우 계정이나 원래 PC에서는 지금 자료가 여전히 자동으로 열릴 수 있습니다. 그쪽에서 열 수 있다면 거기서 백업을 새로 만드는 편이 낫습니다.</p>
            <p className="muted">복원하면 지금 자료는 이 PC에 그대로 남지만, 이 계정에서는 더 이상 열 수 없습니다.</p>
            <label className="row">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />
              현재 열쇠 파일을 새 것으로 바꿉니다
            </label>
          </div>
        )}
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
          <button type="submit" className="primary" disabled={busy || !ready}>{busy ? '복원하는 중…' : '복원'}</button>
          <button type="button" onClick={onBack} disabled={busy}>돌아가기</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </div>
  )
}
