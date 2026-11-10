import type { AppDB } from '../db/schema'
import { APP_SETTINGS_ID } from '../backup/service'
import { updateSettings } from '../settings'
import type { AppSettingsRec, RosterField, StudentRec } from '../db/types'
import { ROSTER_COLUMNS } from './columns'
import type { StudentFields } from './roster'

/** 학생 상세의 기본 칸(이름 뺌), 지금까지의 순서 그대로. */
export const DEFAULT_FIELDS: RosterField[] = (
  [
    ['gender', '성별'],
    ['birth_date', '생년월일'],
    ['phone', '전화번호'],
    ['guardian_name', '보호자 이름'],
    ['guardian_relation', '보호자 관계'],
    ['guardian_phone', '보호자 연락처'],
    ['address', '주소'],
    ['prev_school', '졸업학교'],
    ['hobby', '취미'],
    ['talent', '특기'],
    ['commute', '통학방법'],
    ['friends', '교우관계'],
    ['memo', '참고사항'],
  ] as const
).map(([key, label]) => ({ key, label, builtin: true, visible: true }))

const BUILTIN = new Set(DEFAULT_FIELDS.map((f) => f.key))

/** 저장된 양식 + 기본 칸 합치기: 저장 순서를 따르고, 저장에 없는 기본 칸은 끝에, 모르는 기본 칸은 버린다. */
export function readFields(s: Pick<AppSettingsRec, 'roster_fields'> | Partial<Pick<AppSettingsRec, 'roster_fields'>>): RosterField[] {
  const saved = (s.roster_fields ?? []).filter((f) => (f.builtin ? BUILTIN.has(f.key) : /^x_/.test(f.key)))
  const seen = new Set(saved.map((f) => f.key))
  return [...saved.map((f) => ({ ...f })), ...DEFAULT_FIELDS.filter((f) => !seen.has(f.key)).map((f) => ({ ...f }))]
}

const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')

export function addField(list: RosterField[], label: string): RosterField[] {
  return [...list, { key: `x_${rid()}`, label: label.trim() || '새 칸', builtin: false, visible: true }]
}
export function renameField(list: RosterField[], key: string, label: string): RosterField[] {
  return list.map((f) => (f.key === key && !f.builtin ? { ...f, label } : f))
}
export function moveField(list: RosterField[], key: string, dir: -1 | 1): RosterField[] {
  const i = list.findIndex((f) => f.key === key)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}
/** 기본 칸은 지울 수 없다(숨기기만). 추가 칸을 지워도 학생 값(extra)은 남는다. */
export function removeField(list: RosterField[], key: string): RosterField[] {
  return list.filter((f) => f.builtin || f.key !== key)
}

export function fieldValue(st: StudentRec | StudentFields, f: RosterField): string {
  return f.builtin ? String((st as unknown as Record<string, unknown>)[f.key] ?? '') : (st.extra?.[f.key] ?? '')
}
export function setFieldValue(fields: StudentFields, f: RosterField, v: string): StudentFields {
  return f.builtin ? { ...fields, [f.key]: v } : { ...fields, extra: { ...fields.extra, [f.key]: v } }
}

export interface ColumnDef {
  key: string
  label: string
  aliases: string[]
  builtin: boolean
}

/** 엑셀 양식 머리글·열 찾기: 번호·이름 + 보이는 칸(양식 순서). 기본 칸은 원래 별칭도. */
export function templateColumns(fields: RosterField[]): ColumnDef[] {
  const known = new Map(ROSTER_COLUMNS.map((c) => [c.key as string, c.aliases]))
  return [
    ...ROSTER_COLUMNS.slice(0, 2).map((c) => ({ key: c.key as string, label: c.label, aliases: c.aliases, builtin: true })),
    ...fields.filter((f) => f.visible).map((f) => ({
      key: f.key,
      label: f.label,
      aliases: f.builtin ? [...new Set([f.label, ...(known.get(f.key) ?? []), DEFAULT_FIELDS.find((d) => d.key === f.key)!.label])] : [f.label],
      builtin: f.builtin,
    })),
  ]
}

/** 읽기만(liveQuery 안에서 써도 됨). */
export async function loadFields(db: AppDB): Promise<RosterField[]> {
  return readFields((await db.app_settings.get(APP_SETTINGS_ID)) ?? {})
}

export async function saveFields(db: AppDB, list: RosterField[]): Promise<void> {
  await updateSettings(db, { roster_fields: list.map((f) => ({ ...f, label: f.label.trim() || '새 칸' })) })
}

const normLabel = (s: string) => s.replace(/\s+/g, '').toLowerCase()

/** 칸 이름 검사: 비었거나, 다른 칸(번호·이름 포함)과 같거나, 기본 칸의 엑셀 별칭이면 문제. key는 고치는 칸 자신. */
export function fieldLabelProblem(list: RosterField[], label: string, key?: string): string | undefined {
  const t = label.trim()
  if (!t) return '칸 이름을 쓰세요.'
  const n = normLabel(t)
  const names = [{ key: 'number', label: '번호' }, { key: 'name', label: '이름' }, ...list, ...DEFAULT_FIELDS]
  if (names.some((f) => f.key !== key && normLabel(f.label) === n)) return `'${t}'은(는) 이미 있는 칸 이름입니다.`
  const alias = ROSTER_COLUMNS.find((c) => c.aliases.some((a) => normLabel(a) === n))
  if (alias) return `'${t}'은(는) 기본 칸(${alias.label})을 엑셀에서 찾는 이름이라 쓸 수 없습니다.`
  return undefined
}
