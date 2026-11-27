import { useEffect, useRef, useState } from 'react'
import { BASE_SCOPES, getGoogle } from '../lib/google/google'
import { describeGoogleError } from '../lib/google/syncError'

const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 마법사 끝: 구글 계정을 연결하거나 나중으로 미룬다. 어느 쪽이든 끝나면 onDone. */
export default function GoogleStartStep({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const finished = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  /** 어느 길로든 한 번만 끝낸다(늦게 끝난 로그인이 다시 부르지 못하게). */
  const finish = () => { if (finished.current) return; finished.current = true; onDone() }

  async function start() {
    const g = getGoogle()
    if (!g) return finish()
    setBusy(true)
    setError(undefined)
    try {
      await g.login(BASE_SCOPES, { incremental: false })
      if (alive.current) finish()
    } catch (e) {
      if (!alive.current || finished.current) return
      const d = describeGoogleError(e)
      setError(d.known ? d.message : errText(e) || d.message)
      setBusy(false)
    }
  }

  return (
    <div className="lock">
      <div className="card stack vault-card" role="region" aria-label="구글로 시작">
        <h2>구글로 시작</h2>
        <p>구글 계정을 연결하면 캘린더를 쓰고, 다음 업데이트부터 여러 PC가 자료를 함께 씁니다.</p>
        {busy && <p role="status">브라우저에서 구글 로그인을 마치세요…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button type="button" className="primary" autoFocus disabled={busy} onClick={() => void start()}>구글로 시작</button>
          <button type="button" onClick={finish}>나중에</button>
        </div>
      </div>
    </div>
  )
}
