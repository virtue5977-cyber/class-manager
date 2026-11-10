import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useBackupEvents, useDb, useFs } from '../app/context'
import { checkBackupStatus, runStartup, type StartupStatus } from '../app/startup'
import { runBackup } from '../lib/backup/service'
import { toYmd } from '../lib/schoolDays'

const MESSAGES: Partial<Record<StartupStatus, string>> = {
  'needs-setup': '백업 암호구가 설정되지 않았습니다. 설정에서 백업을 켜 주세요.',
  'needs-folder': '백업 폴더가 지정되지 않았습니다.',
  'needs-permission': '백업 폴더 접근 허용이 필요합니다.',
}

/** device_local 'backupBannerHidden' = 그만 보기를 누른 날짜(그날만 숨김). */
export default function BackupBanner({ today = toYmd(new Date()) }: { today?: string }) {
  const db = useDb()
  const loc = useLocation()
  const [hidden, setHidden] = useState<boolean>()
  useEffect(() => {
    db.device_local.get('backupBannerHidden').then((r) => setHidden(r?.value === today))
  }, [db, today])
  const hideToday = () => {
    setHidden(true)
    db.device_local.put({ id: 'backupBannerHidden', value: today })
  }
  const fs = useFs()
  const { version } = useBackupEvents()
  const started = useRef(false)
  const [status, setStatus] = useState<StartupStatus | null>(null)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (started.current) return
    started.current = true
    runStartup(db, fs).then((r) => {
      setStatus(r.backup)
      setError(r.error)
    })
  }, [db, fs])

  // 설정 화면에서 암호구·폴더가 바뀌면 백업을 다시 돌리지 않고 상태만 다시 확인한다.
  useEffect(() => {
    if (version === 0) return
    checkBackupStatus(db, fs).then((h) => {
      setError(undefined)
      setStatus(h === 'ok' ? 'not-due' : h)
    })
  }, [version, db, fs])

  async function allow() {
    try {
      const folder = await fs.requestPermission()
      if (!folder) return
      await runBackup(db, folder)
      setStatus('done')
    } catch (e) {
      setStatus('failed')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // 설정 화면에서는 '설정으로 이동'이 필요 없다
  const onSettings = loc.pathname.startsWith('/settings')
  if (hidden !== false || !status || status === 'done' || status === 'not-due') return null
  const text = status === 'failed' ? `자동 백업에 실패했습니다: ${error ?? ''}` : MESSAGES[status]
  return (
    <div className="banner" role="status">
      <span>{text}</span>
      {status === 'needs-permission' ? (
        <button type="button" onClick={allow}>
          허용
        </button>
      ) : onSettings ? null : (
        <Link to="/settings?tab=backup">설정으로 이동</Link>
      )}
      <button type="button" className="link banner-dismiss" onClick={hideToday}>
        오늘은 그만 보기
      </button>
    </div>
  )
}
