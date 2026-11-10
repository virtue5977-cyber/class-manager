import type { AppDB } from './db/schema'
import { newRecord, save } from './db/records'
import type { AppSettingsRec, BaseRecord } from './db/types'
import { APP_SETTINGS_ID } from './backup/service'

export type SettingsFields = Omit<AppSettingsRec, keyof BaseRecord>

export const DEFAULT_SETTINGS: SettingsFields = {
  teacher_name: '',
  school_name: '',
  neis_office_code: '',
  neis_school_code: '',
  ai_enabled: false,
  mask_names: true,
  nuga_max_chars: null,
  my_subjects: [],
  my_class_labels: [],
  pin_enabled: false,
  pin_lock_on_resume: true,
  backup_keep_count: 14,
  school_kind: '',
  report_rules: ['결석:질병', '결석:출석인정', '지각:출석인정', '조퇴:출석인정', '결과:출석인정'],
  diagnosis_days: 3,
  student_code_format: '{학년}{반}{번호2}',
}

/** 단일 설정 행. 없으면 기본값으로 만든다. 예전 행에 없는 칸은 기본값으로 채운다. */
export async function getSettings(db: AppDB): Promise<AppSettingsRec> {
  const found = await db.app_settings.get(APP_SETTINGS_ID)
  if (found) return { ...DEFAULT_SETTINGS, ...found }
  const rec = { ...newRecord(DEFAULT_SETTINGS), id: APP_SETTINGS_ID }
  await db.app_settings.put(rec)
  return rec
}

/** 읽기·쓰기를 한 트랜잭션에서 해 동시에 바꿔도 서로 덮어쓰지 않는다. */
export async function updateSettings(
  db: AppDB,
  patch: Partial<SettingsFields> | ((cur: AppSettingsRec) => Partial<SettingsFields>),
): Promise<AppSettingsRec> {
  return db.transaction('rw', db.app_settings, async () => {
    const cur = await getSettings(db)
    return save(db.app_settings, { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) })
  })
}

export async function getNeisKey(db: AppDB): Promise<string> {
  return ((await db.device_local.get('neisApiKey'))?.value as string | undefined) ?? ''
}

export async function setNeisKey(db: AppDB, key: string): Promise<void> {
  await db.device_local.put({ id: 'neisApiKey', value: key.trim() })
}

/** exe(Electron)인지. HTML판은 file:// 주소라 같은 노트북의 다른 HTML 파일이 저장 자료를 읽을 수 있다. */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!(window as { desktop?: unknown }).desktop
}

/** HTML판 AI 키: 저장하지 않고 창을 닫을 때까지만(자료 묶음마다). */
const memoryKeys = new Map<string, string>()

export async function getAiKey(db: AppDB): Promise<string> {
  if (!isDesktopApp()) {
    if (await db.device_local.get('aiApiKey')) await db.device_local.delete('aiApiKey') // 예전 HTML판이 저장해 둔 키
    return memoryKeys.get(db.name) ?? ''
  }
  return ((await db.device_local.get('aiApiKey'))?.value as string | undefined) ?? ''
}

export async function setAiKey(db: AppDB, key: string): Promise<void> {
  if (!isDesktopApp()) {
    memoryKeys.set(db.name, key.trim())
    await db.device_local.delete('aiApiKey') // 예전 버전이 저장해 둔 키도 지운다
    return
  }
  await db.device_local.put({ id: 'aiApiKey', value: key.trim() })
}

/** 실제로 이름을 가릴지. Antigravity(개인 구글 계정)는 약관상 학습에 쓰일 수 있어 늘 가린다. */
export function effectiveMask(s: Pick<AppSettingsRec, 'mask_names' | 'ai_provider'>): boolean {
  return s.mask_names || s.ai_provider === 'antigravity'
}
