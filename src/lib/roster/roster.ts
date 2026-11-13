import type { AppDB } from '../db/schema'
import { listActive, newRecord, save, softDelete } from '../db/records'
import type { BaseRecord, ClassRec, StudentRec } from '../db/types'
import type { RosterPatch } from './columns'

export type StudentFields = Omit<StudentRec, keyof BaseRecord | 'class_id'>

/** 올린 명렬표 한 줄: 번호 + 채워진 칸만 */
export interface RosterRow {
  number: number
  fields: RosterPatch
}

export function emptyStudent(number: number, name: string): StudentFields {
  return {
    number, name, address: '', birth_date: '', prev_school: '', phone: '', hobby: '', talent: '',
    commute: '', friends: '', memo: '', guardian_name: '', guardian_phone: '', gender: '', guardian_relation: '', active: true,
  }
}

export async function createClass(db: AppDB, input: { school_year: number; grade: number; class_no: number }): Promise<ClassRec> {
  const exists = (await listActive(db.classes)).some(
    (c) => c.school_year === input.school_year && c.grade === input.grade && c.class_no === input.class_no,
  )
  if (exists) throw new Error('이미 있는 학급입니다.')
  const rec = newRecord(input)
  await db.classes.add(rec)
  return rec
}

export async function listClasses(db: AppDB): Promise<ClassRec[]> {
  return (await listActive(db.classes)).sort(
    (a, b) => b.school_year - a.school_year || a.grade - b.grade || a.class_no - b.class_no,
  )
}

export function classLabel(c: ClassRec): string {
  return `${c.grade}학년 ${c.class_no}반`
}

export async function listStudents(db: AppDB, classId: string, opts: { includeInactive?: boolean } = {}): Promise<StudentRec[]> {
  const includeInactive = opts.includeInactive ?? true
  const all = await db.students.where('class_id').equals(classId).toArray()
  return all.filter((s) => !s.deleted && (includeInactive || s.active)).sort((a, b) => a.number - b.number)
}

/** AI로 보내기 전에 가릴 이름: 앱에 있는 모든 학생(다른 반·전출 포함, 지운 학생 제외). */
/** AI·밖으로 보낼 때 가릴 이름: 모든 학생(지운 학생 포함)과 보호자 이름 */
export async function allStudentNames(db: AppDB): Promise<string[]> {
  const all = await db.students.toArray()
  return [...new Set(all.flatMap((s) => [s.name, s.guardian_name ?? '']).map((x) => x.trim()).filter(Boolean))]
}

export async function saveStudent(db: AppDB, classId: string, fields: StudentFields, id?: string): Promise<StudentRec> {
  const clash = (await listStudents(db, classId)).some((s) => s.number === fields.number && s.id !== id)
  if (clash) throw new Error('같은 번호의 학생이 이미 있습니다.')
  if (id) {
    const prev = await db.students.get(id)
    if (!prev) throw new Error('학생을 찾을 수 없습니다.')
    return save(db.students, { ...prev, ...fields, class_id: classId })
  }
  const rec = newRecord({ ...fields, class_id: classId })
  await db.students.add(rec)
  return rec
}

export async function deleteStudent(db: AppDB, id: string): Promise<void> {
  await softDelete(db.students, id)
}

/** 번호가 같은 학생은 채워진 칸만 갱신하고(빈 칸은 기존 값 유지), 없으면 추가한다. 이름 없는 새 번호는 건너뛴다. */
export async function upsertRosterRows(db: AppDB, classId: string, rows: RosterRow[]): Promise<{ added: number; updated: number; skipped: number[] }> {
  let added = 0
  let updated = 0
  const skipped: number[] = []
  await db.transaction('rw', db.students, async () => {
    const byNumber = new Map((await listStudents(db, classId, { includeInactive: true })).map((s) => [s.number, s]))
    const now = new Date()
    for (const r of rows) {
      const given = Object.fromEntries(Object.entries(r.fields).filter(([, v]) => typeof v === 'string' && v.trim() !== '')) as RosterPatch
      // 추가 칸: 채운 값만, 있던 다른 추가 칸 값은 그대로
      const extra = Object.fromEntries(Object.entries(r.fields.extra ?? {}).filter(([, v]) => v.trim() !== ''))
      const prev = byNumber.get(r.number)
      if (Object.keys(extra).length) given.extra = { ...prev?.extra, ...extra }
      if (prev) {
        if (!Object.keys(given).length) continue
        await save(db.students, { ...prev, ...given }, now)
        updated++
      } else if (given.name) {
        const rec = newRecord({ ...emptyStudent(r.number, given.name), ...given, class_id: classId }, now)
        await db.students.add(rec)
        byNumber.set(r.number, rec)
        added++
      } else skipped.push(r.number)
    }
  })
  return { added, updated, skipped }
}

export async function getCurrentClassId(db: AppDB): Promise<string | undefined> {
  return (await db.device_local.get('currentClassId'))?.value as string | undefined
}

export async function setCurrentClassId(db: AppDB, id: string): Promise<void> {
  await db.device_local.put({ id: 'currentClassId', value: id })
}
