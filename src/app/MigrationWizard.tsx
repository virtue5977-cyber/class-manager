import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { AppDB } from '../lib/db/schema'
import type { FsAdapter } from '../lib/fs/adapter'
import { createWebFsAdapter } from '../lib/fs/web'
import { createDesktopFsAdapter } from '../lib/fs/desktop'
import { getDesktop, type DesktopVaultApi, type SaveAsResult } from '../lib/desktop/bridge'
import { deriveKey, toBase64, verifyKeyCheck } from '../lib/backup/crypto'
import {
  backupFileName, buildBackupFile, buildBackupFileReport, cachedKeyFrom, deviceTag, getCachedKey, runBackupReport, type CachedKey, type DerivedPassKey,
} from '../lib/backup/service'
import { newRecoveryCode, passKeyRaw, recoveryKeyRaw, PASS_ITER, RECOVERY_ITER } from '../lib/vault/keys'
import {
  BITLOCKER_NOTICE_KEY, cleanupOrphans, dbExists, discardNewVault, type DiscardStatus, finishMigration, OLD_DB_NAME, openOldDb, planStorage, resumeOrReset,
  setupNewVault, skippedRefusal, type BackupProof, type Progress, type SetupResult,
} from '../lib/vault/migrate'
import GoogleStartStep from './GoogleStartStep'
import { ensureGoogleClient, getGoogle } from '../lib/google/google'
import { BUILTIN_GOOGLE_CLIENT } from '../lib/google/client-config'
import { RestoreScreen, saveCodeFile, type SetupKey, type SetupReason } from './VaultGate'

/** 시험에서 바꿔 끼우는 것들(기본은 exe의 preload·브라우저). */
export interface WizardDeps {
  api?: DesktopVaultApi
  fsFor?: (db: AppDB) => FsAdapter
  estimate?: () => Promise<{ usage?: number; quota?: number }>
  /** PBKDF2 반복 수(시험 속도용). 기본 PASS_ITER·RECOVERY_ITER */
  iterations?: { pass: number; recovery: number }
  oldName?: string
  now?: () => Date
  /** 다른 이름으로 저장(exe: desktop.file.saveAs). 실제로 쓴 때만 ok. */
  saveAs?: (name: string, bytes: Uint8Array) => Promise<SaveAsResult>
}

type Mode = 'migrate' | 'first-install'
type Step =
  | { k: 'checking' }
  | { k: 'blocked'; reason: string }
  | { k: 'restore'; reason: string }
  | { k: 'intro' }
  | { k: 'stopped'; message: string }
  | { k: 'pass' }
  | { k: 'recovery'; code: string }
  | { k: 'progress' }
  | { k: 'download' }
  | { k: 'bitlocker' }
  | { k: 'google'; opened?: SetupKey }
  | { k: 'failed'; message: string; discard?: DiscardStatus }

const MIN_PASS = 8
const INTRO = '학생 자료를 이 PC의 윈도우 계정과 백업 암호구로 잠급니다. 약 1분. 끝까지 창을 닫지 마세요.'
const BITLOCKER = '이전 평문 자료의 흔적이 디스크에 남아 있을 수 있습니다. 윈도우의 BitLocker(장치 암호화)를 켜 두세요.'

const TABLE_LABEL: Record<string, string> = {
  device_local: '이 기기 설정', classes: '학급', students: '학생', attendance: '출결', absence_reports: '결석신고서',
  report_attendance: '신고서 연결', counseling_logs: '상담·누가기록', seating_charts: '자리', cleaning_charts: '청소',
  school_calendar: '학사일정', neis_cache: '나이스 자료', teacher_timetable: '시간표', ai_prompts: '지시문', notices: '알림장',
  briefings: '브리핑', hwpx_templates: '양식', app_settings: '설정', notice_items: '전달사항', notes: '노트', note_files: '첨부',
  todos: '할 일', local_events: '일정', chat_log: '대화', reflections: '반성문', reflection_phrases: '반성문 문장', google_events: '구글 일정',
}

const mb = (n: number) => (Number.isFinite(n) ? `${Math.max(0, Math.ceil(n / 1048576))}MB` : '알 수 없음')
const msgOf = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

/** 옛 DB의 기기 표시(읽기만: 옛 DB에 쓰지 않는다). */
async function readTag(db: AppDB): Promise<string | undefined> {
  const v = (await db.device_local.get('deviceId'))?.value
  return typeof v === 'string' && /^[0-9a-f]{4}/.test(v) ? v.slice(0, 4) : undefined
}

function defaultFs(db: AppDB): FsAdapter {
  const backup = getDesktop()?.backup
  return backup ? createDesktopFsAdapter(db, backup) : createWebFsAdapter(db)
}

function Card({ title, label, children }: { title: string; label?: string; children: ReactNode }) {
  return (
    <div className="lock">
      <div className="card stack vault-card" role="region" aria-label={label ?? title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

/**
 * 옮기기·첫 설치 마법사(spec §4.2·§4.3). VaultGate의 renderSetup 자리에 들어간다.
 * 안내 → (옛 DB 백업) → 암호구 → 복구 코드 → 진행 → 확인 → 새 백업 → 옛 DB 지우기 → BitLocker 안내.
 */
export default function MigrationWizard({ reason, done, setupKey, deps = {} }: {
  reason: SetupReason
  done: (opened?: SetupKey) => void
  setupKey?: SetupKey
  deps?: WizardDeps
}) {
  const desktop = getDesktop()
  const api = deps.api ?? desktop?.vault ?? null
  // 새 백업 파일 저장: exe는 저장 대화 상자(실제로 썼을 때만 증거), 웹(개발)만 브라우저 내려받기 + 확인 체크.
  const saveAs = deps.saveAs ?? (desktop?.file?.saveAs ? (n: string, b: Uint8Array) => desktop.file!.saveAs(n, b) : undefined)
  const saveMode: 'dialog' | 'web' | 'none' = saveAs ? 'dialog' : desktop ? 'none' : 'web'
  const fsFor = deps.fsFor ?? defaultFs
  const oldName = deps.oldName ?? OLD_DB_NAME
  const now = () => (deps.now ? deps.now() : new Date())
  const iter = deps.iterations ?? { pass: PASS_ITER, recovery: RECOVERY_ITER }

  const [mode, setMode] = useState<Mode>(reason === 'first-install' ? 'first-install' : 'migrate')
  const [step, setStep] = useState<Step>(reason === 'incomplete' ? { k: 'checking' } : { k: 'intro' })
  const [restarted, setRestarted] = useState(false)
  const [note, setNote] = useState<string>()
  const [progress, setProgress] = useState<Progress | null>(null)
  const [phase, setPhase] = useState('')
  const [proof, setProof] = useState<BackupProof | null>(null)
  const [busy, setBusy] = useState(false)
  const [oldSaved, setOldSaved] = useState(false)
  const [webSaved, setWebSaved] = useState<string | null>(null)
  const [webAck, setWebAck] = useState(false)

  const oldDb = useRef<AppDB | null>(null)
  const oldKey = useRef<CachedKey | null>(null)
  const passOk = useRef<'old' | 'new' | null>(null)
  const passKey = useRef<DerivedPassKey | null>(null)
  const setup = useRef<SetupResult | null>(null)
  const started = useRef(false)
  /** 방금 옮긴 새 DB의 열쇠(시작하기에서 VaultGate가 암호구 없이 바로 열도록 넘긴다) */
  const openedKey = useRef<SetupKey | null>(null)
  /** 정리하지 못한 새 DB 이름(다시 시도 때 먼저 정리한다) */
  const pending = useRef<string | null>(null)

  const resetFn = () => (api?.reset ? api.reset() : Promise.reject(new Error('이 프로그램에서는 열쇠 파일을 지울 수 없습니다. 새 Watson.exe를 쓰세요.')))

  useEffect(() => () => { oldDb.current?.close(); setup.current?.db.close() }, [])

  // 끝나지 않은 옮기기: 이어 하거나(옛 DB 지우던 중) 조건이 맞을 때만 지우고 처음부터.
  useEffect(() => {
    if (reason !== 'incomplete' || started.current || !api) return
    started.current = true
    void (async () => {
      try {
        const dbName = setupKey?.dbName ?? (await api.status()).vault?.dbName
        if (!dbName) {
          setMode((await dbExists(oldName)) ? 'migrate' : 'first-install')
          setStep({ k: 'intro' })
          return
        }
        const r = await resumeOrReset({ dbName, reset: resetFn, oldName, key: setupKey })
        if (r.action === 'resumed') return r.bitlocker ? setStep({ k: 'bitlocker' }) : done(setupKey)
        if (r.action === 'blocked') return setStep({ k: 'blocked', reason: r.reason })
        if (r.action === 'backup') {
          // 완료된 새 DB(다시 확인함)와 옛 DB: 새 백업을 받은 뒤에만 옛 DB를 지운다.
          const vault = (await api.status()).vault
          if (!vault || !setupKey) {
            r.db.close(); r.oldDb.close()
            return setStep({ k: 'blocked', reason: '열쇠 파일을 읽지 못했습니다. 아무것도 지우지 않았습니다.' })
          }
          oldDb.current = r.oldDb
          setup.current = {
            db: r.db, dek: setupKey.dek, keyId: setupKey.keyId, counts: {}, verify: r.verify,
            payload: { v: 1, keyId: vault.keyId, dbName: vault.dbName, pass: vault.pass, ...(vault.recovery ? { recovery: vault.recovery } : {}), dekB64: toBase64(setupKey.dek) },
          }
          setMode('migrate')
          setNote('지난번에 옮긴 자료를 확인했습니다. 새 백업 파일을 받은 뒤 옛 자료를 지웁니다.')
          setStep({ k: 'progress' })
          await backupNew(setup.current)
          return
        }
        setMode(r.restart)
        setRestarted(true)
        setStep({ k: 'intro' })
      } catch (e) {
        setStep({ k: 'blocked', reason: `확인하지 못했습니다: ${msgOf(e, '알 수 없는 오류')}. 아무것도 지우지 않았습니다.` })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!api) return <Card title="Watson"><p className="error" role="alert">이 화면은 Watson 프로그램에서만 쓸 수 있습니다.</p></Card>

  async function begin() {
    setBusy(true)
    setNote(undefined)
    try {
      // 지난 실패·중단으로 남은 watson-* DB(완료 행 없음)를 먼저 정리한다. 완료된 것은 건드리지 않는다.
      await cleanupOrphans()
      if (mode === 'first-install') { setStep({ k: 'pass' }); return }
      const plan = await planStorage(deps.estimate)
      if (!plan.ok) {
        setStep({ k: 'stopped', message: `저장 공간이 모자랍니다. 옮기는 동안 자료가 잠시 두 벌 있어야 해서 ${mb(plan.need)}가 남아 있어야 하는데 ${mb(plan.free)}만 남았습니다. 디스크의 필요 없는 파일을 지우고 다시 시도하세요.` })
        return
      }
      if (!oldDb.current) oldDb.current = openOldDb(oldName)
      const db = oldDb.current
      await db.open()
      oldKey.current = await getCachedKey(db)
      // 옛 DB 백업: 백업 폴더와 옛 캐시 열쇠가 있으면 지금 형식으로 하나(옛 DB에는 쓰지 않는다).
      if (oldKey.current) {
        try {
          const st = await fsFor(db).restoreFolder()
          if (st.status === 'ready') {
            const t = now()
            const name = backupFileName(t, new Set(await st.folder.listFiles()), '백업_', await readTag(db))
            await st.folder.writeFile(name, await buildBackupFile(db, oldKey.current, t))
            setNote(`옮기기 전 자료를 백업 폴더에 '${name}'로 남겼습니다.`)
          }
        } catch (e) {
          setNote(`옮기기 전 자료 백업을 만들지 못했습니다(${msgOf(e, '알 수 없는 오류')}). 옛 자료는 새 자료를 확인하고 새 백업을 만든 뒤에만 지웁니다.`)
        }
      }
      setStep({ k: 'pass' })
    } catch (e) {
      setStep({ k: 'failed', message: msgOf(e, '옛 자료를 열지 못했습니다.') })
    } finally {
      setBusy(false)
    }
  }

  /** 마지막: 데스크톱이고 구글이 아직 연결 안 됐으면 '구글로 시작' 단계, 아니면 바로 done. */
  async function finishWizard(opened?: SetupKey) {
    const g = getGoogle()
    if (g) {
      try {
        const st = await ensureGoogleClient(g, BUILTIN_GOOGLE_CLIENT)
        if (!st.connected) { setStep({ k: 'google', opened }); return }
      } catch { /* 상태를 못 읽으면 이 단계는 건너뛴다 */ }
    }
    done(opened)
  }

  async function derive(passphrase: string, from: 'old' | 'new') {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    passKey.current = { salt, iter: iter.pass, raw: await passKeyRaw(passphrase, salt, iter.pass) }
    passOk.current = from
    setStep({ k: 'recovery', code: newRecoveryCode() })
  }

  async function run(code: string | null) {
    setStep({ k: 'progress' })
    setProgress(null)
    setPhase('준비하는 중')
    try {
      let recovery: { raw: Uint8Array; salt: Uint8Array; iter: number } | undefined
      if (code) {
        const salt = crypto.getRandomValues(new Uint8Array(16))
        recovery = { raw: await recoveryKeyRaw(code, salt, iter.recovery), salt, iter: iter.recovery }
      }
      setPhase(mode === 'migrate' ? '자료를 옮기는 중' : '새 자료를 만드는 중')
      const r = await setupNewVault({
        passKey: passKey.current!, recovery, store: (p) => api!.store(p), reset: resetFn,
        migrateFrom: mode === 'migrate' ? oldDb.current! : undefined,
        onProgress: (p) => { setProgress(p); if (p.done >= p.total && p.overall.done >= p.overall.total) setPhase('옮긴 자료를 확인하는 중') },
      })
      setup.current = r
      if (mode === 'first-install') {
        r.db.close()
        setup.current = null
        void finishWizard({ dek: r.dek, keyId: r.keyId, dbName: r.db.name })
        return
      }
      await backupNew(r)
    } catch (e) {
      await fail(e)
    }
  }

  /** 새 DB로 백업 하나: 백업 폴더가 있으면 거기에 쓰고 끝내기, 없으면 내려받기 단계. */
  async function backupNew(r: SetupResult) {
    try {
      setPhase('새 자료로 백업을 만드는 중')
      let st: Awaited<ReturnType<FsAdapter['restoreFolder']>> = { status: 'none' }
      try { st = await fsFor(r.db).restoreFolder() } catch { st = { status: 'none' } }
      if (st.status === 'ready') {
        let rep: Awaited<ReturnType<typeof runBackupReport>> | null = null
        try {
          rep = await runBackupReport(r.db, st.folder, { now: now() })
        } catch (e) {
          setNote(`백업 폴더에 쓰지 못했습니다(${msgOf(e, '알 수 없는 오류')}). 대신 백업 파일을 내려받으세요.`)
        }
        if (rep) {
          // 새 DB에서 첨부가 풀리지 않아 백업에서 빠졌다: 그 첨부는 옛 DB에만 성하다. 끝내지 않고(옛 DB 유지) 새 DB를 버린다.
          if (rep.skipped > 0) { await fail(new Error(skippedRefusal(rep.skipped))); return }
          await finish({ kind: 'folder', name: rep.name, skipped: 0 })
          return
        }
      }
      setProof(null)
      setWebSaved(null)
      setWebAck(false)
      setStep({ k: 'download' })
    } catch (e) {
      await fail(e)
    }
  }

  async function downloadNew() {
    const r = setup.current
    if (!r) return
    setBusy(true)
    try {
      const cached = await getCachedKey(r.db)
      if (!cached) throw new Error('백업 열쇠가 없습니다.')
      const t = now()
      const name = backupFileName(t, new Set(), '백업_', await deviceTag(r.db))
      const { bytes, skipped } = await buildBackupFileReport(r.db, cached, t)
      if (skipped > 0) { await fail(new Error(skippedRefusal(skipped))); return }
      setNote(undefined)
      if (saveMode === 'dialog') {
        const res = await saveAs!(name, bytes)
        if (res.ok) setProof({ kind: 'download', name: res.name, skipped: 0 })
        else setNote("저장하지 않았습니다. 백업 파일을 저장해야 옛 자료를 지울 수 있습니다. 다시 '내려받기'를 눌러 저장할 곳을 고르세요.")
      } else if (saveMode === 'web') {
        fsFor(r.db).downloadFile(name, bytes)
        setWebSaved(name)
      } else {
        setNote('이 프로그램에서는 파일로 저장할 수 없습니다. 새 Watson.exe로 다시 시도하세요. 옛 자료는 그대로입니다.')
      }
    } catch (e) {
      setNote(`백업 파일을 만들지 못했습니다: ${msgOf(e, '알 수 없는 오류')}`)
    } finally {
      setBusy(false)
    }
  }

  async function finish(p: BackupProof) {
    const r = setup.current!
    setStep({ k: 'progress' })
    setPhase('옛 자료를 지우는 중')
    try {
      await finishMigration(oldDb.current!, r.db, { vault: r.payload, verify: r.verify!, backup: p })
      oldDb.current = null
      try { await r.db.device_local.put({ id: BITLOCKER_NOTICE_KEY, value: now().toISOString() }) } catch { /* 안내 표시는 막지 않는다 */ }
      const opened: SetupKey = { dek: r.dek, keyId: r.keyId, dbName: r.db.name }
      r.db.close()
      setup.current = null
      openedKey.current = opened
      setStep({ k: 'bitlocker' })
    } catch (e) {
      await fail(e)
    }
  }

  /** 실패: 새 DB·vault를 지운다(조건이 맞을 때만, 옛 DB는 그대로). 무엇을 지웠는지 그대로 보인다. */
  async function fail(e: unknown) {
    const info = (e ?? {}) as { discard?: DiscardStatus; dbName?: string }
    let discard = info.discard
    let dbName = info.dbName
    const r = setup.current
    if (r) {
      try { r.db.close() } catch { /* ignore */ }
      setup.current = null
      dbName = r.db.name
      discard = await discardNewVault({ dbName, reset: resetFn, oldName })
    }
    pending.current = discard === 'db-failed' || discard === 'reset-failed' ? dbName ?? null : null
    setStep({ k: 'failed', message: msgOf(e, '옮기지 못했습니다.'), discard })
  }

  async function downloadOld() {
    setBusy(true)
    try {
      const db = oldDb.current ?? openOldDb(oldName)
      oldDb.current = db
      if (!(await dbExists(oldName))) throw new Error('옛 자료가 없습니다.')
      await db.open()
      const cached = passOk.current === 'old' ? await getCachedKey(db) : passKey.current ? await cachedKeyFrom(passKey.current) : null
      if (!cached) throw new Error('암호구를 먼저 확인해야 백업 파일을 만들 수 있습니다.')
      const t = now()
      const name = backupFileName(t, new Set(), '백업_', await readTag(db))
      const bytes = await buildBackupFile(db, cached, t)
      if (saveMode === 'dialog') {
        const res = await saveAs!(name, bytes)
        if (!res.ok) { setNote('저장하지 않았습니다.'); return }
      } else if (saveMode === 'web') fsFor(db).downloadFile(name, bytes)
      else throw new Error('이 프로그램에서는 파일로 저장할 수 없습니다.')
      setOldSaved(true)
    } catch (e) {
      setNote(`백업 파일을 만들지 못했습니다: ${msgOf(e, '알 수 없는 오류')}`)
    } finally {
      setBusy(false)
    }
  }

  async function retry() {
    if (pending.current) {
      setBusy(true)
      const st = await discardNewVault({ dbName: pending.current, reset: resetFn, oldName })
      setBusy(false)
      if (st !== 'done') {
        if (step.k === 'failed') setStep({ ...step, discard: st })
        return
      }
      pending.current = null
    }
    passOk.current = null
    passKey.current = null
    setProof(null)
    setNote(undefined)
    setOldSaved(false)
    setStep({ k: 'intro' })
  }

  switch (step.k) {
    case 'checking':
      return <Card title="자료 확인"><p role="status">지난번 작업을 확인하는 중…</p></Card>
    case 'blocked':
      return (
        <Card title="자료 열기">
          <div className="stack" role="alert">
            <p>지난번 옮기기가 끝나지 않았습니다. {step.reason}</p>
          </div>
          <p className="muted">백업 파일과 그 파일을 만든 때의 암호구가 있으면 자료를 되살릴 수 있습니다. 지금 자료는 이 PC에 그대로 남습니다.</p>
          <button type="button" className="primary" onClick={() => setStep({ k: 'restore', reason: step.reason })}>백업 파일에서 복원</button>
        </Card>
      )
    case 'restore':
      return <RestoreScreen api={api} replacing onBack={() => setStep({ k: 'blocked', reason: step.reason })} onDone={done} />
    case 'intro':
      return (
        <Card title={mode === 'migrate' ? '자료 잠그기' : 'Watson 시작하기'}>
          {restarted && <p className="notice">지난번 작업이 끝나지 않아 처음부터 다시 합니다. 옛 자료는 그대로입니다. 지난번에 받은 복구 코드는 쓸 수 없습니다. 새 복구 코드를 다시 받으세요.</p>}
          <p>{INTRO}</p>
          {mode === 'first-install' && <p className="muted">먼저 백업 암호구를 정합니다. 이 암호구로 백업 파일을 열고, 다른 PC에서도 자료를 엽니다.</p>}
          <button type="button" className="primary" onClick={() => void begin()} disabled={busy}>{busy ? '확인하는 중…' : '시작'}</button>
        </Card>
      )
    case 'stopped':
      return (
        <Card title="자료 잠그기">
          <p className="error" role="alert">{step.message}</p>
          <p className="muted">옛 자료는 그대로입니다.</p>
          <button type="button" className="primary" onClick={() => void begin()} disabled={busy}>다시 시도</button>
        </Card>
      )
    case 'pass':
      return (
        <PassStep
          hasOld={mode === 'migrate' && !!oldKey.current}
          oldKey={oldKey.current}
          note={note}
          onDone={(p, from) => derive(p, from)}
        />
      )
    case 'recovery':
      return (
        <Card title="복구 코드">
          <p>암호구를 잊었을 때 자료를 여는 코드입니다. 지금 한 번만 보입니다. 인쇄하거나 파일로 저장해 남이 보지 못하는 곳에 두세요.</p>
          <p className="recovery-code" data-testid="recovery-code">{step.code}</p>
          <div className="row">
            <button type="button" onClick={() => window.print()}>인쇄</button>
            <button type="button" onClick={() => saveCodeFile(step.code)}>파일로 저장</button>
          </div>
          <button type="button" className="primary" onClick={() => void run(step.code)}>적어 두었습니다. 다음</button>
          <button type="button" onClick={() => void run(null)}>건너뛰기(권장하지 않음)</button>
        </Card>
      )
    case 'progress': {
      const o = progress?.overall
      return (
        <Card title={mode === 'migrate' ? '자료 옮기는 중' : '새 자료 만드는 중'}>
          <p className="notice">끝까지 창을 닫지 마세요.</p>
          <progress
            style={{ width: '100%' }}
            max={o && o.total > 0 ? o.total : 1}
            value={o ? Math.min(o.done, o.total) : 0}
            aria-label="진행"
          />
          <p role="status" aria-live="polite">
            {phase}
            {progress && phase === '자료를 옮기는 중' ? ` — ${TABLE_LABEL[progress.table] ?? progress.table} ${progress.done}/${progress.total}` : ''}
          </p>
        </Card>
      )
    }
    case 'download':
      return (
        <Card title="새 백업 파일 받기">
          <p>새 자료로 만든 백업 파일 하나를 받아 두어야 옛 자료를 지울 수 있습니다. 백업 폴더가 정해져 있지 않아 파일로 내려받습니다.</p>
          {note && <p className="muted">{note}</p>}
          <button type="button" className={proof || webSaved ? '' : 'primary'} onClick={() => void downloadNew()} disabled={busy}>내려받기</button>
          {proof && <p role="status">'{proof.name}'(으)로 저장했습니다. 안전한 곳(USB 등)에도 옮겨 두세요.</p>}
          {!proof && webSaved && (
            <label className="row">
              <input type="checkbox" checked={webAck} onChange={(e) => setWebAck(e.target.checked)} disabled={busy} />
              파일이 저장된 것을 확인했습니다
            </label>
          )}
          {(() => {
            const p: BackupProof | null = proof ?? (webSaved && webAck ? { kind: 'download', name: webSaved, skipped: 0 } : null)
            return <button type="button" className="primary" disabled={!p || busy} onClick={() => p && void finish(p)}>계속</button>
          })()}
        </Card>
      )
    case 'bitlocker':
      return (
        <Card title="다 됐습니다">
          <p>학생 자료를 잠갔습니다. 이제 이 PC의 윈도우 계정과 백업 암호구로 엽니다.</p>
          <p className="notice">{BITLOCKER}</p>
          <button type="button" className="primary" autoFocus onClick={() => void finishWizard(openedKey.current ?? setupKey)}>시작하기</button>
        </Card>
      )
    case 'google':
      return <GoogleStartStep onDone={() => done(step.opened)} />
    case 'failed':
      return (
        <Card title={mode === 'migrate' ? '옮기지 못했습니다' : '만들지 못했습니다'}>
          <p className="error" role="alert">{step.message}</p>
          <p className="muted">{failNote(step.discard, mode)}</p>
          {note && <p className="muted">{note}</p>}
          <div className="row">
            <button type="button" className="primary" onClick={() => void retry()} disabled={busy}>다시 시도</button>
            {mode === 'migrate' && (oldKey.current || passKey.current) && (
              <button type="button" onClick={() => void downloadOld()} disabled={busy}>백업 파일 내려받기</button>
            )}
          </div>
          {oldSaved && <p role="status">옛 자료 백업 파일을 내려받았습니다.</p>}
        </Card>
      )
  }
}

/** 실패 화면의 정리 결과 문구(지우지 못한 것을 지웠다고 말하지 않는다). */
function failNote(d: DiscardStatus | undefined, mode: Mode): string {
  const old = mode === 'migrate' ? ' 옛 자료는 그대로입니다.' : ''
  switch (d) {
    case 'done': return mode === 'migrate' ? '옛 자료는 그대로입니다. 새로 만들던 자료는 지웠습니다.' : '만들던 자료는 지웠습니다.'
    case 'refused': return '새 자료는 지우지 않고 남겨 두었습니다. 프로그램을 다시 켜면 이어서 확인합니다.' + old
    case 'db-failed': return "새로 만들던 자료를 지우지 못했습니다. '다시 시도'하면 먼저 정리합니다." + old
    case 'reset-failed': return "새로 만들던 자료는 지웠지만 열쇠 파일을 지우지 못했습니다. '다시 시도'하면 먼저 정리합니다." + old
    default: return mode === 'migrate' ? '옛 자료는 그대로입니다.' : '아직 아무것도 만들지 않았습니다.'
  }
}

/** 암호구 확인(옛 백업 열쇠가 있으면) 또는 정하기. '나중에'는 없다. */
function PassStep({ hasOld, oldKey, note, onDone }: {
  hasOld: boolean
  oldKey: CachedKey | null
  note?: string
  onDone: (passphrase: string, from: 'old' | 'new') => Promise<void>
}) {
  const [mode, setMode] = useState<'confirm' | 'new' | 'forgot'>(hasOld ? 'confirm' : 'new')
  const [value, setValue] = useState('')
  const [again, setAgain] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (error && !busy) inputRef.current?.focus() }, [error, busy])

  async function confirm(e: FormEvent) {
    e.preventDefault()
    if (busy || !value || !oldKey) return
    setBusy(true)
    setError(undefined)
    try {
      const key = await deriveKey(value, oldKey.salt, oldKey.iterations)
      if (!(await verifyKeyCheck(key, oldKey.check))) {
        setValue('')
        setError('암호구가 맞지 않습니다. 다시 입력해 주세요.')
        return
      }
      await onDone(value, 'old')
    } catch {
      setError('암호구를 확인하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const newReady = value.length >= MIN_PASS && value === again && (mode !== 'forgot' || ack)
  async function setNew(e: FormEvent) {
    e.preventDefault()
    if (busy || !newReady) return
    setBusy(true)
    try { await onDone(value, 'new') } finally { setBusy(false) }
  }

  if (mode === 'confirm') {
    return (
      <div className="lock">
        <form className="card stack vault-card" onSubmit={confirm} aria-label="백업 암호구 확인">
          <h2>백업 암호구 확인</h2>
          {note && <p className="muted">{note}</p>}
          <p>지금 쓰는 백업 암호구를 입력하세요. 이 암호구로 학생 자료를 잠급니다.</p>
          <label>
            백업 암호구
            <input ref={inputRef} type="password" autoFocus autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
          </label>
          <div className="row">
            <button type="submit" className="primary" disabled={busy || !value}>{busy ? '확인하는 중…' : '확인'}</button>
            <button type="button" onClick={() => { setMode('forgot'); setValue(''); setError(undefined) }} disabled={busy}>잊었어요</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </div>
    )
  }

  const mismatch = again.length > 0 && value !== again
  return (
    <div className="lock">
      <form className="card stack vault-card" onSubmit={setNew} aria-label="백업 암호구 정하기">
        <h2>백업 암호구 정하기</h2>
        {note && <p className="muted">{note}</p>}
        <p>백업 파일을 열고, 이 PC에서 자동으로 열리지 않을 때 자료를 여는 암호구입니다. 잊지 않을 문장으로 정하세요.</p>
        <label>
          새 암호구(8자 이상)
          <input type="password" autoFocus autoComplete="new-password" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
        </label>
        <label>
          한 번 더
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} disabled={busy} aria-invalid={mismatch || undefined} />
        </label>
        {value.length > 0 && value.length < MIN_PASS && <p className="muted">{MIN_PASS}자 이상이어야 합니다.</p>}
        {mismatch && <p className="muted">두 칸이 같지 않습니다.</p>}
        {mode === 'forgot' && (
          <label className="row">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} />
            이전 백업 파일은 이전 암호구로만 열립니다
          </label>
        )}
        <div className="row">
          <button type="submit" className="primary" disabled={busy || !newReady}>{busy ? '정하는 중…' : '정하기'}</button>
          {mode === 'forgot' && <button type="button" onClick={() => { setMode('confirm'); setValue(''); setAgain(''); setAck(false) }} disabled={busy}>돌아가기</button>}
        </div>
      </form>
    </div>
  )
}
