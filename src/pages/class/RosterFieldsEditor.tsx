import { useState } from 'react'
import { useDb } from '../../app/context'
import type { RosterField } from '../../lib/db/types'
import { addField, DEFAULT_FIELDS, moveField, removeField, renameField, saveFields } from '../../lib/roster/fields'

/** 명단 양식 고치기: 칸 보이기·순서·이름(추가 칸)·추가·지우기. 번호·이름은 고정. 숨겨도 학생 값은 남는다. */
export default function RosterFieldsEditor({ fields, onClose }: { fields: RosterField[]; onClose: () => void }) {
  const db = useDb()
  const [list, setList] = useState(fields)
  const [label, setLabel] = useState('')
  const [msg, setMsg] = useState<string>()
  return (
    <section className="card stack fields-editor" aria-label="명단 양식 고치기">
      <h3>명단 양식 고치기</h3>
      <p className="muted">번호·이름은 늘 맨 앞입니다. 숨긴 칸의 값은 지워지지 않고 다시 보이면 그대로 나옵니다. 이 양식은 학생 상세, 엑셀 양식·올리기, 명렬표 칸 고르기에 함께 쓰입니다.</p>
      <ul className="plain fields-list">
        {list.map((f, i) => (
          <li key={f.key} className="row">
            <label className="check">
              <input type="checkbox" aria-label={`${f.label} 보이기`} checked={f.visible} onChange={(e) => setList(list.map((x) => (x.key === f.key ? { ...x, visible: e.target.checked } : x)))} />
            </label>
            {f.builtin ? <span className="fields-name">{f.label}</span> : <input aria-label={`${f.label} 이름`} value={f.label} onChange={(e) => setList(renameField(list, f.key, e.target.value))} />}
            {!f.builtin && <span className="tag">추가 칸</span>}
            <span className="spacer" />
            <button type="button" className="link" aria-label={`${f.label} 위로`} disabled={i === 0} onClick={() => setList(moveField(list, f.key, -1))}>↑</button>
            <button type="button" className="link" aria-label={`${f.label} 아래로`} disabled={i === list.length - 1} onClick={() => setList(moveField(list, f.key, 1))}>↓</button>
            {!f.builtin && (
              <button type="button" className="danger-text" aria-label={`${f.label} 지우기`} onClick={() => setList(removeField(list, f.key))}>
                지우기
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="row">
        <input aria-label="새 칸 이름" placeholder="예: 방과후, 알레르기, 비상연락처" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="button" disabled={!label.trim()} onClick={() => { setList(addField(list, label)); setLabel('') }}>
          칸 추가
        </button>
      </div>
      {msg && <p className="error" role="alert">{msg}</p>}
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={async () => {
            try {
              await saveFields(db, list)
              onClose()
            } catch (e) {
              setMsg(e instanceof Error ? e.message : String(e))
            }
          }}
        >
          저장
        </button>
        <button type="button" onClick={() => setList(DEFAULT_FIELDS.map((f) => ({ ...f })).concat(list.filter((f) => !f.builtin)))}>
          기본 순서로
        </button>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </section>
  )
}
