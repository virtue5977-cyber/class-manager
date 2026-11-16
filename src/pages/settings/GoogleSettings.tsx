import { useCallback, useEffect, useState } from 'react'
import { useDb, useFs } from '../../app/context'
import { normStatus, ensureGoogleClient, getGoogle, hasCalendar, lastGoogleSync, syncGoogle, APP_CALENDAR_NAME, BASE_SCOPES, CALENDAR_SCOPES, type GoogleStatus } from '../../lib/google/google'
import { clearGoogleError, describeGoogleError, readGoogleError, recordGoogleError, type GoogleSyncError } from '../../lib/google/syncError'
import { withGoogleLock } from '../../lib/google/runner'
import { BUILTIN_GOOGLE_CLIENT } from '../../lib/google/client-config'
import { getCurrentClassId } from '../../lib/roster/roster'
import { toYmd } from '../../lib/schoolDays'

const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export default function GoogleSettings() {
  const db = useDb()
  const fs = useFs()
  const g = getGoogle()
  const [st, setSt] = useState<GoogleStatus>()
  const [last, setLast] = useState<string | null>(null)
  const [lastErr, setLastErr] = useState<GoogleSyncError | null>(null)
  const [msg, setMsg] = useState<string>()
  const [reconnect, setReconnect] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    if (g) setSt(await ensureGoogleClient(g, BUILTIN_GOOGLE_CLIENT).catch(() => g.status().then(normStatus)))
    setLast(await lastGoogleSync(db))
    setLastErr(await readGoogleError(db))
  }, [db, g])
  useEffect(() => {
    load()
  }, [load])

  async function run(label: string, fn: () => Promise<string | void>, opts?: { remember?: boolean }) {
    setBusy(true)
    setReconnect(false)
    setMsg(`${label}…`)
    try {
      setMsg((await fn()) || undefined)
      if (opts?.remember) await clearGoogleError(db)
    } catch (e) {
      const d = describeGoogleError(e)
      setMsg(d.known ? d.message : errText(e))
      setReconnect(d.reconnect)
      if (opts?.remember) await recordGoogleError(db, e).catch(() => {})
    }
    setBusy(false)
    await load()
  }
  const startLabel = '브라우저에서 구글 로그인을 마치세요'
  const connect = (scopes: string[], incremental: boolean, done: string) => run(startLabel, async () => { await g!.login(scopes, { incremental }); return done })
  const connected = !!st?.connected
  const calendar = hasCalendar(st)

  return (
    <div className="card stack wide" aria-label="구글 계정">
      <h3>구글 계정</h3>
      <p className="muted">{`구글 계정을 연결합니다(드라이브 동기화에 쓰입니다). 캘린더도 연결하면 학사일정·내 일정(학생 이름은 ○○로 가림)과 결석신고서 정리 알림(번호만)을 구글의 "${APP_CALENDAR_NAME}" 캘린더로 보내고, 구글 기본 캘린더의 일정을 달력·홈으로 가져옵니다. 구글에서 넣은 일정은 구글에서 고치세요.`}</p>
      {!g ? (
        <p className="muted">설치형(Windows 앱)에서만 됩니다(새로 받아야 할 수 있습니다). 구글 연결에는 데스크톱 앱이 필요합니다.</p>
      ) : (
        <>
          <div className="row">
            <span>{!st ? '확인 중…' : !st.client ? '연결 정보가 없습니다. 아래 "다른 연결 파일 쓰기"로 넣으세요.' : !connected ? '구글 계정이 연결되지 않았습니다.' : `${st.email ?? '연결됨'}${st.email ? ' · 연결됨' : ''}${calendar && last ? ` · 마지막 동기화 ${new Date(last).toLocaleString('ko-KR')}` : ''}`}</span>
          </div>
          {st?.sessionOnly && <p className="muted">이 PC에 로그인 정보를 저장할 수 없어 앱을 다시 켜면 다시 연결해야 합니다</p>}
          <div className="row">
            {!connected ? (
              <button type="button" className="primary" disabled={busy || !st?.client} onClick={() => connect(BASE_SCOPES, false, '구글에 연결했습니다.')}>
                구글로 시작
              </button>
            ) : (
              <>
                {!calendar && (
                  <>
                    <button type="button" className="primary" disabled={busy} onClick={() => connect(CALENDAR_SCOPES, true, '캘린더를 연결했습니다. "지금 동기화"를 누르세요.')}>
                      캘린더도 연결
                    </button>
                    <span className="muted">구글이 확인되지 않은 앱 경고를 보일 수 있습니다</span>
                  </>
                )}
                {calendar && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(
                        '동기화 중',
                        async () => {
                          const r = await withGoogleLock(async () => syncGoogle(db, g, toYmd(new Date()), await getCurrentClassId(db)))
                          return `보냄: 새 ${r.created} · 고침 ${r.updated} · 지움 ${r.removed} / 가져옴: ${r.pulled}개`
                        },
                        { remember: true },
                      )
                    }
                  >
                    지금 동기화
                  </button>
                )}
                <button type="button" className="link" disabled={busy} onClick={() => run('연결을 끊는 중', async () => { await g.logout(); return '구글 연결을 끊었습니다.' })}>
                  연결 끊기
                </button>
              </>
            )}
            {reconnect && (
              <button type="button" className="primary" disabled={busy} onClick={() => connect(calendar ? [...BASE_SCOPES, ...CALENDAR_SCOPES] : BASE_SCOPES, false, '다시 연결했습니다.')}>
                다시 연결
              </button>
            )}
          </div>
          {lastErr && (
            <p role="status" className="warn">
              {`마지막 오류(${new Date(lastErr.at).toLocaleString('ko-KR')}): ${lastErr.message}`}
              {lastErr.reconnect && !reconnect && connected && (
                <>
                  {' '}
                  <button type="button" className="link" disabled={busy} onClick={() => connect(calendar ? [...BASE_SCOPES, ...CALENDAR_SCOPES] : BASE_SCOPES, false, '다시 연결했습니다.')}>
                    다시 연결
                  </button>
                </>
              )}
            </p>
          )}
          <details open={st ? !st.client : undefined}>
            <summary>다른 연결 파일 쓰기(직접 만든 Google Cloud 프로젝트)</summary>
            <div className="row">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run('연결 파일 확인', async () => {
                    const f = await fs.pickFileToRead('.json')
                    if (!f) return
                    await g.setClient(new TextDecoder().decode(f.bytes))
                    return '연결 파일을 저장했습니다. 이제 "구글로 시작"을 누르세요.'
                  })
                }
              >
                연결 파일(JSON) 올리기
              </button>
            </div>
          </details>
          {calendar && <p className="muted">앱을 켤 때마다 저절로 동기화합니다. 실패하면 홈 위쪽에 알려 드립니다.</p>}
        </>
      )}
      {msg && <p role="status">{msg}</p>}
    </div>
  )
}
