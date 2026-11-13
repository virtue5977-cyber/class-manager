import type { RosterField } from '../../lib/db/types'
import { DEFAULT_FIELDS, fieldValue, setFieldValue } from '../../lib/roster/fields'
import { useState, type FormEvent } from 'react'
import { useDb } from '../../app/context'
import type { StudentRec } from '../../lib/db/types'
import { deleteStudent, emptyStudent, saveStudent, type StudentFields } from '../../lib/roster/roster'



function toFields(s?: StudentRec): StudentFields {
  if (!s) return emptyStudent(0, '')
  const { id: _i, class_id: _c, created_at: _a, updated_at: _u, deleted: _d, ...f } = s
  return f
}

/** closable=false: 명단 오른쪽에 늘 열려 있는 상세(닫기 버튼 없음). */
export default function StudentDetail({ classId, student, onDone, closable = true, fields = DEFAULT_FIELDS }: { classId: string; student?: StudentRec; onDone: () => void; closable?: boolean; fields?: RosterField[] }) {
  const db = useDb()
  const [f, setF] = useState<StudentFields>(() => toFields(student))
  const [num, setNum] = useState(student ? String(student.number) : '')
  const [error, setError] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    if (!/^\d+$/.test(num.trim()) || Number(num) < 1) return setError('번호는 1 이상의 정수여야 합니다.')
    if (!f.name.trim()) return setError('이름이 비어 있습니다.')
    try {
      await saveStudent(db, classId, { ...f, name: f.name.trim(), number: Number(num) }, student?.id)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove() {
    if (!student) return
    await deleteStudent(db, student.id)
    onDone()
  }

  return (
    <form className="card stack detail" onSubmit={submit} aria-label="학생 정보">
      <h3>{student ? `${student.number}번 ${student.name}` : '학생 추가'}</h3>
      <div className="grid-form">
        <label>
          번호
          <input inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value)} />
        </label>
        <label>
          이름
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        {fields.filter((x) => x.visible).map((x) => (
          <label key={x.key}>
            {x.label}
            <input value={fieldValue(f, x)} onChange={(e) => setF(setFieldValue(f, x, e.target.value))} />
          </label>
        ))}
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          재적
        </label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button type="submit" className="primary">저장</button>
        {closable && (
          <button type="button" onClick={onDone}>
            {student ? '닫기' : '취소'}
          </button>
        )}
        {student && !confirmDelete && (
          <button type="button" className="danger-text push-right" onClick={() => setConfirmDelete(true)}>
            지우기
          </button>
        )}
      </div>
      {confirmDelete && (
        <div className="row confirm">
          <span>이 학생을 지울까요?</span>
          <button type="button" className="danger" onClick={remove}>
            지우기 확인
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)}>
            취소
          </button>
        </div>
      )}
    </form>
  )
}
