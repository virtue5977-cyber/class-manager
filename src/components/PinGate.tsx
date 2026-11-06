import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useDb } from '../app/context'
import { getPinFails, lockoutMs, pinActive, setPinFails, verifyPin } from '../lib/pin'
import { getSettings } from '../lib/settings'

/** 절전·화면 꺼짐 뒤로 보는 기준: 이만큼 이상 화면이 가려져 있었으면 다시 잠근다. */
export const RESUME_LOCK_MS = 5 * 60_000

declare global {
  interface Window {
    desktop?: { onLock?: (cb: () => void) => () => void }
  }
}

/** 시작할 때와 (켜 두었으면) 절전·화면 잠금에서 돌아올 때만 PIN을 묻는다. */
export default function PinGate({ children, now = () => Date.now() }: { children: ReactNode; now?: () => number }) {
  const db = useDb()
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking')
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    pinActive(db).then((on) => setState(on ? 'locked' : 'open'))
  }, [db])

  useEffect(() => {
    const lockIfOn = async () => {
      if ((await pinActive(db)) && (await getSettings(db)).pin_lock_on_resume) setState('locked')
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = now()
      else if (hiddenAt.current !== null && now() - hiddenAt.current >= RESUME_LOCK_MS) lockIfOn()
    }
    document.addEventListener('visibilitychange', onVis)
    const off = window.desktop?.onLock?.(lockIfOn)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      off?.()
    }
  }, [db, now])

  if (state === 'checking') return null
  const locked = state === 'locked'
  // 잠가도 화면 아래는 그대로 둔다(쓰던 글이 사라지지 않게). 잠긴 동안은 가리고 조작할 수 없다.
  const hide = locked ? ({ inert: '', 'aria-hidden': true, className: 'locked-under' } as Record<string, unknown>) : {}
  return (
    <>
      <div {...hide}>{children}</div>
      {locked && <LockScreen onOpen={() => setState('open')} now={now} />}
    </>
  )
}

function LockScreen({ onOpen, now }: { onOpen: () => void; now: () => number }) {
  const db = useDb()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string>()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const st = await getPinFails(db)
    if (now() < st.until) return setError(`${Math.ceil((st.until - now()) / 1000)}초 뒤에 다시 시도하세요.`)
    if (await verifyPin(db, pin)) {
      await setPinFails(db, { fails: 0, until: 0 })
      return onOpen()
    }
    const f = st.fails + 1
    const wait = lockoutMs(f)
    await setPinFails(db, { fails: f, until: wait ? now() + wait : 0 })
    setPin('')
    setError(wait ? `PIN이 ${f}번 틀렸습니다. ${wait / 1000}초 뒤에 다시 시도하세요.` : 'PIN이 맞지 않습니다.')
  }

  return (
    <div className="lock">
      <form className="card stack lock-card" onSubmit={submit} aria-label="잠금 해제">
        <h2>담임 업무</h2>
        <label>
          PIN
          <input type="password" inputMode="numeric" autoFocus autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={8} />
        </label>
        <button type="submit" className="primary">
          열기
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="muted">PIN을 잊었으면 백업 파일로 다른 기기에 복원하거나, 앱 데이터를 지우고 백업에서 복원하세요.</p>
      </form>
    </div>
  )
}
