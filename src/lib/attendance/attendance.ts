import type { AppDB } from '../db/schema'
import { newRecord, save, softDelete } from '../db/records'
import type { AttendanceRec, BaseRecord } from '../db/types'

export type AttendanceInput = Omit<AttendanceRec, keyof BaseRecord>

const PERIOD_RE = /^\d{1,2}(~\d{1,2})?$/

/** 결석이면 교시를 비우고, 출석인정이 아니면 증빙 구분을 비운다. */
function normalize(input: AttendanceInput): AttendanceInput {
  return {
    ...input,
    period: input.kind === '결석' ? null : (input.period?.trim() || null),
    evidence_type: input.category === '출석인정' ? input.evidence_type : null,
    reason: input.reason.trim(),
  }
}

export function validateAttendance(input: AttendanceInput, sameDay: AttendanceRec[], selfId?: string): string | null {
  const n = normalize(input)
  if (n.kind !== '결석') {
    if (!n.period) return '교시를 입력하세요.'
    if (!PERIOD_RE.test(n.period)) return '교시는 3 또는 3~4처럼 입력하세요.'
  }
  const others = sameDay.filter((r) => !r.deleted && r.id !== selfId && r.student_id === n.student_id && r.date === n.date)
  if (others.some((r) => r.kind === n.kind)) return '이 날짜에 같은 구분의 출결이 이미 있습니다.'
  if (others.length && (n.kind === '결석' || others.some((r) => r.kind === '결석'))) return '결석한 날에는 지각·조퇴·결과를 함께 입력할 수 없습니다.'
  return null
}

export async function saveAttendance(db: AppDB, input: AttendanceInput, id?: string): Promise<AttendanceRec> {
  const n = normalize(input)
  return db.transaction('rw', db.attendance, async () => {
    const prev = id ? await db.attendance.get(id) : undefined
    if (id && !prev) throw new Error('출결을 찾을 수 없습니다.')
    // 화면이 늦게 갱신돼 다른 날짜의 기록 id가 넘어오면 그 기록을 옮겨 덮어쓰지 않는다.
    if (prev && (prev.student_id !== n.student_id || prev.date !== n.date)) throw new Error('다른 날짜의 출결은 고칠 수 없습니다. 다시 열어 주세요.')
    const sameDay = await db.attendance.where('student_id').equals(n.student_id).filter((r) => r.date === n.date).toArray()
    const err = validateAttendance(n, sameDay, id)
    if (err) throw new Error(err)
    if (prev) {
      // 같은 칸(학생·날짜·구분)은 유일 색인이라, 지운 행이 그 구분을 차지하고 있으면 비워 준다.
      const tombOfKind = sameDay.find((r) => r.deleted && r.kind === n.kind && r.id !== prev.id)
      if (tombOfKind) await db.attendance.delete(tombOfKind.id)
      return save(db.attendance, { ...prev, ...n })
    }
    // 삭제 표시된 같은 칸(학생·날짜·구분 유일)이 있으면 그 행을 되살려 쓴다.
    const tomb = sameDay.find((r) => r.deleted && r.kind === n.kind)
    if (tomb) return save(db.attendance, { ...tomb, ...n, deleted: false })
    const rec = newRecord(n)
    await db.attendance.add(rec)
    return rec
  })
}

export async function deleteAttendance(db: AppDB, id: string): Promise<void> {
  await softDelete(db.attendance, id)
}

export async function listAttendanceByDate(db: AppDB, studentIds: string[], date: string): Promise<AttendanceRec[]> {
  const rows = await db.attendance.where('date').equals(date).toArray()
  return rows.filter((r) => !r.deleted && studentIds.includes(r.student_id))
}

export async function listAttendanceByStudent(db: AppDB, studentId: string): Promise<AttendanceRec[]> {
  return (await db.attendance.where('student_id').equals(studentId).toArray())
    .filter((r) => !r.deleted)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** 고른 학생들의 기간 안 출결(날짜 순서로 한 번에 읽음). */
export async function listAttendanceInRange(db: AppDB, ids: string[], from: string, to: string): Promise<AttendanceRec[]> {
  const set = new Set(ids)
  return (await db.attendance.where('date').between(from, to, true, true).toArray()).filter((r) => !r.deleted && set.has(r.student_id))
}
