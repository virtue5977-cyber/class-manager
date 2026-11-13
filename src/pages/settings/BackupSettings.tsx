import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useBackupEvents, useDb, useFs } from '../../app/context'
import type { BackupFolder } from '../../lib/fs/adapter'
import type { SafetyTarget } from '../../lib/backup/service'
import { PBKDF2_ITERATIONS } from '../../lib/backup/crypto'
import { getCachedKey, getLastBackupAt, restoreFromBytes, runBackup, setupPassphrase } from '../../lib/backup/service'
import * as reload from '../../lib/ui/reload'

const pad = (n: number) => String(n).padStart(2, '0')
function formatLocal(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function BackupSettings({ iterations = PBKDF2_ITERATIONS }: { iterations?: number }) {
  const db = useDb()
  const fs = useFs()
  const { notifyChanged } = useBackupEvents()
  const [hasKey, setHasKey] = useState(false)
  const [folder, setFolder] = useState<BackupFolder | null>(null)
  const [lastBackup, setLastBackup] = useState<string>()
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  const [notice, setNotice] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [restoreFile, setRestoreFile] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [restorePass, setRestorePass] = useState('')

  const refresh = useCallback(async () => {
    setHasKey(!!(await getCachedKey(db)))
    setLastBackup(await getLastBackupAt(db))
    const st = await fs.restoreFolder()
    setFolder(st.status === 'ready' ? st.folder : null)
  }, [db, fs])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function run(task: () => Promise<string | void>) {
    setBusy(true)
    setNotice(undefined)
    try {
      const msg = await task()
      if (msg) setNotice(msg)
      await refresh()
    } catch (e) {
      setNotice(message(e))
    } finally {
      setBusy(false)
      notifyChanged()
    }
  }

  function savePassphrase(e: FormEvent) {
    e.preventDefault()
    if (pass1 !== pass2) {
      setNotice('두 암호구가 일치하지 않습니다.')
      return
    }
    run(async () => {
      await setupPassphrase(db, pass1, { iterations })
      setPass1('')
      setPass2('')
      return '암호구를 저장했습니다.'
    })
  }

  const pickFolder = () =>
    run(async () => {
      const f = await fs.pickFolder()
      return f ? `백업 폴더를 지정했습니다: ${f.name}` : undefined
    })

  const backupNow = () =>
    run(async () => {
      let target = folder
      if (!target) {
        const st = await fs.restoreFolder()
        if (st.status === 'needs-permission') target = await fs.requestPermission()
      }
      if (!target) throw new Error('먼저 백업 폴더를 지정하세요.')
      const name = await runBackup(db, target)
      return `백업했습니다: ${name}`
    })

  const downloadBackup = () =>
    run(async () => {
      const files = new Map<string, Uint8Array>()
      const memory: BackupFolder = {
        name: '내려받기',
        writeFile: async (n, b) => void files.set(n, b),
        readFile: async (n) => files.get(n)!,
        listFiles: async () => [...files.keys()],
        deleteFile: async (n) => void files.delete(n),
      }
      const name = await runBackup(db, memory)
      fs.downloadFile(name, files.get(name)!)
      return `백업 파일을 내려받았습니다: ${name}`
    })

  const chooseRestore = () =>
    run(async () => {
      const f = await fs.pickFileToRead()
      if (f) setRestoreFile(f)
    })

  /** 안전 백업 위치: 지정 폴더(필요하면 허용 요청) → 없으면 내려받기. */
  async function safetyTarget(): Promise<SafetyTarget> {
    const st = await fs.restoreFolder()
    let target: BackupFolder | null = st.status === 'ready' ? st.folder : null
    if (st.status === 'needs-permission') target = await fs.requestPermission()
    return target ? { folder: target } : { download: (n, b) => fs.downloadFile(n, b) }
  }

  function doRestore(e: FormEvent) {
    e.preventDefault()
    if (!restoreFile) return
    run(async () => {
      await restoreFromBytes(db, restoreFile.bytes, restorePass, { safety: await safetyTarget() })
      setRestoreFile(null)
      setRestorePass('')
      // 학급·명단·노트가 모두 바뀌었으니 화면을 새로 불러온다
      setTimeout(() => reload.reloadApp(), 1200)
      return '복원했습니다. 화면을 새로 불러옵니다.'
    })
  }

  return (
    <div className="card stack settings-card">
      <h3>백업</h3>
      <p className="status-line">
        <span className={`tag ${hasKey ? 'status-나이스' : 'status-미정리'}`}>{hasKey ? '암호구 설정됨' : '암호구 없음'}</span>
        {` 마지막 백업: ${lastBackup ? formatLocal(lastBackup) : '아직 없음'}`}
      </p>

      <form onSubmit={savePassphrase} className="stack">
        <h4>{hasKey ? '백업 암호구 변경' : '백업 암호구 설정'}</h4>
        <p className="muted">암호구를 잃으면 백업 파일을 복구할 수 없습니다. 종이 등에 적어 보관하세요.</p>
        {hasKey && <p className="muted">암호구를 바꾸면 앞으로의 백업만 새 암호구를 씁니다. 이전 백업 파일은 예전 암호구로만 열립니다.</p>}
        <div className="row">
        <label>
          새 암호구
          <input type="password" value={pass1} onChange={(e) => setPass1(e.target.value)} autoComplete="new-password" />
        </label>
        <label>
          암호구 확인
          <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
        </label>
        <button type="submit" className={hasKey ? undefined : 'primary'} disabled={busy}>
          {hasKey ? '암호구 바꾸기' : '암호구 저장'}
        </button>
        </div>
      </form>

      <div className="stack">
        <h4>백업 폴더</h4>
        {fs.isFolderSupported() ? (
          <>
            <div className="row">
              <span>{`백업 폴더: ${folder ? folder.name : '지정 안 됨'}`}</span>
              <button type="button" onClick={pickFolder} disabled={busy}>
                백업 폴더 지정
              </button>
              <button type="button" className={hasKey ? 'primary' : undefined} onClick={backupNow} disabled={busy || !hasKey}>
                지금 백업
              </button>
            </div>
          </>
        ) : (
          <>
            <p>이 브라우저는 폴더 자동 백업을 지원하지 않습니다. '백업 파일 내려받기'를 사용하세요.</p>
            <button type="button" onClick={downloadBackup} disabled={busy || !hasKey}>
              백업 파일 내려받기
            </button>
          </>
        )}
      </div>

      <div className="stack">
        <h4>복원</h4>
        {!restoreFile ? (
          <button type="button" onClick={chooseRestore} disabled={busy}>
            백업 파일에서 복원
          </button>
        ) : (
          <form onSubmit={doRestore} className="stack">
            <p>선택한 파일: {restoreFile.name}</p>
            <p className="warn">현재 데이터가 백업 내용으로 바뀝니다. 복원 전에 현재 상태를 한 번 더 백업합니다.</p>
            <label>
              백업 암호구
              <input type="password" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} autoComplete="current-password" />
            </label>
            <div className="row">
              <button type="submit" disabled={busy}>
                복원 실행
              </button>
              <button type="button" onClick={() => setRestoreFile(null)} disabled={busy}>
                취소
              </button>
            </div>
          </form>
        )}
      </div>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </div>
  )
}
