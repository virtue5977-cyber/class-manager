import { useCallback, useEffect, useState } from 'react'
import { useDb, useFs } from '../../app/context'
import { getGoogle, lastGoogleSync, syncGoogle, APP_CALENDAR_NAME } from '../../lib/google/google'
import { getCurrentClassId } from '../../lib/roster/roster'
import { toYmd } from '../../lib/schoolDays'

const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export default function GoogleSettings() {
  const db = useDb()
  const fs = useFs()
  const g = getGoogle()
  const [st, setSt] = useState<{ client: boolean; loggedIn: boolean }>()
  const [last, setLast] = useState<string | null>(null)
  const [msg, setMsg] = useState<string>()
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    if (g) setSt(await g.status())
    setLast(await lastGoogleSync(db))
  }, [db, g])
  useEffect(() => {
    load()
  }, [load])

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(true)
    setMsg(`${label}…`)
    try {
      setMsg((await fn()) || undefined)
    } catch (e) {
      setMsg(errText(e))
    }
    setBusy(false)
    await load()
  }

  return (
    <div className="card stack wide" aria-label="구글 캘린더">
      <h3>구글 캘린더</h3>
      <p className="muted">{`학사일정과 결석신고서 정리 알림을 구글의 "${APP_CALENDAR_NAME}" 캘린더로 보내고, 구글 기본 캘린더의 일정을 달력·홈으로 가져옵니다. 구글에서 넣은 일정은 구글에서 고치세요.`}</p>
      {!g ? (
        <p className="warn">exe 버전에서만 됩니다(새 exe가 필요할 수 있습니다).</p>
      ) : (
        <>
          <div className="row">
            <span>{!st ? '확인 중…' : !st.client ? '① 연결 파일이 없습니다.' : !st.loggedIn ? '② 연결 파일 있음 · 로그인 필요' : `연결됨${last ? ` · 마지막 동기화 ${new Date(last).toLocaleString('ko-KR')}` : ''}`}</span>
          </div>
          <div className="row">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run('연결 파일 확인', async () => {
                  const f = await fs.pickFileToRead('.json')
                  if (!f) return
                  await g.setClient(new TextDecoder().decode(f.bytes))
                  return '연결 파일을 저장했습니다. 이제 "구글로 로그인"을 누르세요.'
                })
              }
            >
              {st?.client ? '연결 파일 바꾸기' : '연결 파일(JSON) 올리기'}
            </button>
            <button type="button" className="primary" disabled={busy || !st?.client} onClick={() => run('브라우저에서 구글 로그인을 마치세요', async () => { await g.login(); return '구글에 연결했습니다. "지금 동기화"를 누르세요.' })}>
              구글로 로그인
            </button>
            <button
              type="button"
              disabled={busy || !st?.loggedIn}
              onClick={() =>
                run('동기화 중', async () => {
                  const r = await syncGoogle(db, g, toYmd(new Date()), await getCurrentClassId(db))
                  return `보냄: 새 ${r.created} · 고침 ${r.updated} · 지움 ${r.removed} / 가져옴: ${r.pulled}개`
                })
              }
            >
              지금 동기화
            </button>
            {st?.loggedIn && (
              <button type="button" className="link" disabled={busy} onClick={() => run('로그아웃', async () => { await g.logout(); return '구글 연결을 끊었습니다.' })}>
                로그아웃
              </button>
            )}
          </div>
          <p className="muted">앱을 켤 때마다 저절로 동기화합니다. 처음 로그인할 때 "확인하지 않은 앱" 경고가 뜨면 고급 → 담임업무(으)로 이동을 누르세요.</p>
        </>
      )}
      {msg && <p role="status">{msg}</p>}
    </div>
  )
}
