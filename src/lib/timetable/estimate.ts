import type { AppDB } from '../db/schema'
import { newRecord } from '../db/records'
import type { TeacherTimetableRec } from '../db/types'
import type { ClassPeriod } from '../neis/timetable'
import { weekday } from '../schoolDays'

export interface Slot {
  weekday: number
  period: number
  subject: string
  class_label: string
}

export const classLabelOf = (grade: number, classNo: string) => `${grade}-${classNo}`

const ko = new Intl.Collator('ko')

export function subjectsForClasses(periods: ClassPeriod[], classLabels: string[]): string[] {
  const set = new Set(periods.filter((p) => classLabels.includes(classLabelOf(p.grade, p.classNo)) && p.subject).map((p) => p.subject))
  return [...set].sort(ko.compare)
}

const byLabel = (a: string, b: string) => {
  const [ag, ac] = a.split('-').map(Number)
  const [bg, bc] = b.split('-').map(Number)
  return ag - bg || ac - bc || ko.compare(a, b)
}

/** 고른 학급에서 고른 과목(정확히 일치)인 칸을 모은다. 교사 정보가 없어 과목명으로만 추정한다. */
export function estimateSlots(periods: ClassPeriod[], subjects: string[], classLabels: string[]) {
  const seen = new Map<string, Slot>()
  for (const p of periods) {
    const label = classLabelOf(p.grade, p.classNo)
    if (!classLabels.includes(label) || !subjects.includes(p.subject)) continue
    const s: Slot = { weekday: weekday(p.date), period: p.period, subject: p.subject, class_label: label }
    seen.set(`${s.weekday}|${s.period}|${label}`, s)
  }
  const slots = [...seen.values()].sort((a, b) => a.weekday - b.weekday || a.period - b.period || byLabel(a.class_label, b.class_label))
  const groups = new Map<string, string[]>()
  for (const s of slots) {
    const k = `${s.weekday}|${s.period}`
    groups.set(k, [...(groups.get(k) ?? []), s.class_label])
  }
  const conflicts = [...groups.entries()]
    .filter(([, labels]) => labels.length > 1)
    .map(([k, labels]) => {
      const [w, pr] = k.split('|').map(Number)
      return { weekday: w, period: pr, labels }
    })
  return { slots, conflicts }
}

/** 데이터에 실제로 나오는 요일(월=1…금=5). 휴업일·방학 요일은 빠진다. */
export function coveredWeekdays(periods: ClassPeriod[]): number[] {
  return [...new Set(periods.map((p) => weekday(p.date)).filter((w) => w <= 5))].sort((a, b) => a - b)
}

export async function listMyTimetable(db: AppDB): Promise<TeacherTimetableRec[]> {
  return (await db.teacher_timetable.toArray())
    .filter((r) => !r.deleted)
    .sort((a, b) => a.weekday - b.weekday || a.period - b.period || byLabel(a.class_label || '0-0', b.class_label || '0-0'))
}

/**
 * 추정 칸을 새로 바꾼다. 데이터가 있는 요일(weekdays)만 바꾸고, 시간표가 없는 요일(휴업일 등)의
 * 기존 추정 칸은 남긴다. 수동 칸이 있는 요일·교시는 건드리지 않는다.
 */
export async function applyEstimate(db: AppDB, slots: Slot[], weekdays: number[]): Promise<void> {
  const now = new Date()
  const ts = now.toISOString()
  await db.transaction('rw', db.teacher_timetable, async () => {
    const all = (await db.teacher_timetable.toArray()).filter((r) => !r.deleted)
    const manual = new Set(all.filter((r) => r.source === 'manual').map((r) => `${r.weekday}|${r.period}`))
    for (const r of all) if (r.source === 'estimated' && weekdays.includes(r.weekday)) await db.teacher_timetable.put({ ...r, deleted: true, updated_at: ts })
    const add = slots
      .filter((s) => !manual.has(`${s.weekday}|${s.period}`))
      .map((s) => newRecord({ ...s, note: '', source: 'estimated' as const }, now))
    if (add.length) await db.teacher_timetable.bulkAdd(add)
  })
}

/** 한 칸을 직접 정한다. 과목이 비면 "수업 없음"으로 남아 재추정이 채우지 않는다. */
export async function saveManualSlot(db: AppDB, slot: Slot & { note?: string }): Promise<void> {
  const now = new Date()
  await db.transaction('rw', db.teacher_timetable, async () => {
    const same = (await db.teacher_timetable.where('[weekday+period]').equals([slot.weekday, slot.period]).toArray()).filter((r) => !r.deleted)
    for (const r of same) await db.teacher_timetable.put({ ...r, deleted: true, updated_at: now.toISOString() })
    await db.teacher_timetable.add(
      newRecord({ weekday: slot.weekday, period: slot.period, subject: slot.subject.trim(), class_label: slot.class_label.trim(), note: slot.note ?? '', source: 'manual' as const }, now),
    )
  })
}
