import { Link, useLocation } from 'react-router-dom'
import { useDb } from '../app/context'
import { hiddenGoogleErrorAt, hideGoogleError, readGoogleError, type GoogleSyncError } from '../lib/google/syncError'
import { useLive } from '../lib/ui/useLive'

/** 구글 자동 맞춤이 실패했을 때 홈 위 띠. 닫으면 그 오류는 다시 안 보이고, 다음 새 실패나 설정 탭에서는 보인다. */
export default function GoogleErrorBanner() {
  const db = useDb()
  const loc = useLocation()
  const st = useLive(async () => ({ err: await readGoogleError(db), hidden: await hiddenGoogleErrorAt(db) }), [db], null as null | { err: GoogleSyncError | null; hidden: string | null })
  if (!st?.err || st.hidden === st.err.at) return null
  const onSettings = loc.pathname.startsWith('/settings')
  return (
    <div className="banner" role="status">
      <span>{`구글 동기화에 실패했습니다: ${st.err.message}`}</span>
      {onSettings ? null : <Link to="/settings?tab=google">설정으로 이동</Link>}
      <button type="button" className="link banner-dismiss" onClick={() => void hideGoogleError(db, st.err!.at)}>
        닫기
      </button>
    </div>
  )
}
