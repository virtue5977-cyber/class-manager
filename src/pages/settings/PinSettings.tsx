import { useCallback, useEffect, useState } from 'react'
import { useDb } from '../../app/context'
import { clearPin, pinActive, setPin, validatePin, verifyPin } from '../../lib/pin'
import { getSettings, updateSettings } from '../../lib/settings'

export default function PinSettings() {
  const db = useDb()
  const [on, setOn] = useState(false)
  const [resume, setResume] = useState(true)
  const [cur, setCur] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [message, setMessage] = useState<string>()

  const load = useCallback(async () => {
    setOn(await pinActive(db))
    setResume((await getSettings(db)).pin_lock_on_resume)
  }, [db])
  useEffect(() => {
    load()
  }, [load])

  async function save() {
    setMessage(undefined)
    if (on && !(await verifyPin(db, cur))) return setMessage('지금 PIN이 맞지 않습니다.')
    const err = validatePin(a)
    if (err) return setMessage(err)
    if (a !== b) return setMessage('새 PIN 두 칸이 다릅니다.')
    await setPin(db, a)
    setCur('')
    setA('')
    setB('')
    setMessage(on ? 'PIN을 바꿨습니다.' : 'PIN 잠금을 켰습니다. 다음에 앱을 열 때부터 PIN을 묻습니다.')
    await load()
  }

  async function off() {
    if (!(await verifyPin(db, cur))) return setMessage('지금 PIN이 맞지 않습니다.')
    await clearPin(db)
    setCur('')
    setMessage('PIN 잠금을 껐습니다.')
    await load()
  }

  return (
    <div className="card stack wide" aria-label="PIN 잠금">
      <h3>PIN 잠금 {on ? '(켜짐)' : '(꺼짐)'}</h3>
      <p className="muted">앱을 열 때 PIN을 묻습니다. 데이터 암호화가 아니라 화면을 가리는 용도이며, PIN은 이 노트북에만 저장됩니다.</p>
      <div className="row">
        {on && (
          <label>
            지금 PIN
            <input type="password" inputMode="numeric" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="off" />
          </label>
        )}
        <label>
          {on ? '새 PIN' : 'PIN(숫자 4~8자리)'}
          <input type="password" inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} autoComplete="off" />
        </label>
        <label>
          한 번 더
          <input type="password" inputMode="numeric" value={b} onChange={(e) => setB(e.target.value)} autoComplete="off" />
        </label>
      </div>
      <div className="row">
        <button type="button" className="primary" onClick={save}>
          {on ? 'PIN 바꾸기' : 'PIN 잠금 켜기'}
        </button>
        {on && (
          <button type="button" onClick={off}>
            PIN 잠금 끄기
          </button>
        )}
      </div>
      <label className="inline">
        <input
          type="checkbox"
          checked={resume}
          onChange={async (e) => {
            setResume(e.target.checked)
            await updateSettings(db, { pin_lock_on_resume: e.target.checked })
          }}
        />
        절전·화면 잠금에서 돌아올 때도 묻기(창을 5분 넘게 내려 둔 경우 포함)
      </label>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
