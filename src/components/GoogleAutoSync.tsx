import { useEffect } from 'react'
import { useDb } from '../app/context'
import { ensureGoogleClient, getGoogle, syncGoogle } from '../lib/google/google'
import { BUILTIN_GOOGLE_CLIENT } from '../lib/google/client-config'
import { getCurrentClassId } from '../lib/roster/roster'
import { toYmd } from '../lib/schoolDays'

/** 앱을 켤 때 한 번 조용히 구글과 동기화(로그인돼 있을 때만). 실패해도 화면을 막지 않는다. */
export default function GoogleAutoSync() {
  const db = useDb()
  useEffect(() => {
    const g = getGoogle()
    if (!g) return
    const t = setTimeout(async () => {
      try {
        if ((await ensureGoogleClient(g, BUILTIN_GOOGLE_CLIENT)).loggedIn) await syncGoogle(db, g, toYmd(new Date()), await getCurrentClassId(db))
      } catch {
        /* 설정 > 구글 캘린더에서 직접 동기화하면 오류 문구를 볼 수 있다 */
      }
    }, 5000)
    return () => clearTimeout(t)
  }, [db])
  return null
}
