import Dexie, { type Table } from 'dexie'
import type {
  AbsenceReportRec, AiPromptRec, AppSettingsRec, AttendanceRec, BriefingRec, ClassRec,
  CleaningChartRec, CounselingLogRec, DeviceLocalRec, HwpxTemplateRec, NeisCacheRec, NoticeRec,
  ReportAttendanceRec, SchoolCalendarRec, SeatingChartRec, StudentRec, TeacherTimetableRec, GoogleEventRec,
  NoticeItemRec, NoteRec, NoteFileRec, TodoRec, LocalEventRec, ChatRec, ReflectionRec, ReflectionPhraseRec,
  NoteBlobRec, MetaRec, SyncRowRec,
} from './types'

/** 백업 파일 형식 번호(표 구성이 바뀔 때 올린다). Dexie 판 번호와는 따로다. 1 = 0.16까지(표가 늘어도 1이었음) */
export const SCHEMA_VERSION = 2

export const SYNCED_TABLES = [
  'classes', 'students', 'attendance', 'absence_reports', 'report_attendance', 'counseling_logs',
  'seating_charts', 'cleaning_charts', 'school_calendar', 'neis_cache', 'teacher_timetable',
  'ai_prompts', 'notices', 'briefings', 'hwpx_templates', 'app_settings',
  'notice_items', 'notes', 'note_files', 'todos', 'local_events', 'chat_log', 'reflections', 'reflection_phrases',
] as const

export type SyncedTable = (typeof SYNCED_TABLES)[number]

/** 형식 번호별 백업 표 목록. SYNCED_TABLES를 바꾸면 SCHEMA_VERSION을 올리고 여기에 더한다(시험이 확인). */
export const BACKUP_TABLES_BY_VERSION: Record<number, readonly string[]> = {
  2: SYNCED_TABLES,
}

/** 평문 DB의 판별 표 정의. vault DB는 이들의 합집합에서 일부 색인을 뺀 VAULT_STORES로 새로 시작한다. */
const STORES_V1 = {
  classes: 'id, [school_year+grade+class_no]',
  students: 'id, class_id',
  attendance: 'id, student_id, date, &[student_id+date+kind]',
  absence_reports: 'id, student_id, start_date',
  report_attendance: 'id, report_id, attendance_id',
  counseling_logs: 'id, student_id, date',
  seating_charts: 'id, class_id',
  cleaning_charts: 'id, class_id',
  school_calendar: 'id, date',
  neis_cache: 'id, [kind+range_key]',
  teacher_timetable: 'id, [weekday+period]',
  ai_prompts: 'id, kind',
  notices: 'id, target_date',
  briefings: 'id, [target_date+slot]',
  hwpx_templates: 'id, name',
  app_settings: 'id',
  device_local: 'id',
}
const STORES_V2 = { google_events: 'id, date' }
const STORES_V3 = {
  notice_items: 'id, start_date, end_date',
  notes: 'id, updated_at',
  note_files: 'id, note_id',
  todos: 'id, order',
  local_events: 'id, date',
  chat_log: 'id, at, school_year',
  reflections: 'id, student_id, date',
  reflection_phrases: 'id',
}
const STORES_V4 = { note_blobs: 'id', meta: 'id', sync_rows: 'id' }

/** vault(watson-*) DB의 version(1) 표 정의: 최종 스키마에서 hwpx_templates.name, notes.updated_at 색인을 뺀다. */
export const VAULT_STORES: Record<string, string> = {
  ...STORES_V1, ...STORES_V2, ...STORES_V3, ...STORES_V4,
  hwpx_templates: 'id',
  notes: 'id',
}

/** 암호화하지 않는 표(note_blobs는 Task 6에서 따로 암호화) */
export const UNENCRYPTED_TABLES = ['neis_cache', 'meta', 'sync_rows', 'note_blobs'] as const

export class AppDB extends Dexie {
  classes!: Table<ClassRec, string>
  students!: Table<StudentRec, string>
  attendance!: Table<AttendanceRec, string>
  absence_reports!: Table<AbsenceReportRec, string>
  report_attendance!: Table<ReportAttendanceRec, string>
  counseling_logs!: Table<CounselingLogRec, string>
  seating_charts!: Table<SeatingChartRec, string>
  cleaning_charts!: Table<CleaningChartRec, string>
  school_calendar!: Table<SchoolCalendarRec, string>
  neis_cache!: Table<NeisCacheRec, string>
  teacher_timetable!: Table<TeacherTimetableRec, string>
  ai_prompts!: Table<AiPromptRec, string>
  notices!: Table<NoticeRec, string>
  briefings!: Table<BriefingRec, string>
  hwpx_templates!: Table<HwpxTemplateRec, string>
  app_settings!: Table<AppSettingsRec, string>
  device_local!: Table<DeviceLocalRec, string>
  /** 구글 캘린더에서 가져온 일정(다시 받을 수 있어 백업하지 않음) */
  google_events!: Table<GoogleEventRec, string>
  notice_items!: Table<NoticeItemRec, string>
  notes!: Table<NoteRec, string>
  note_files!: Table<NoteFileRec, string>
  todos!: Table<TodoRec, string>
  local_events!: Table<LocalEventRec, string>
  chat_log!: Table<ChatRec, string>
  reflections!: Table<ReflectionRec, string>
  reflection_phrases!: Table<ReflectionPhraseRec, string>

  note_blobs!: Table<NoteBlobRec, string>
  meta!: Table<MetaRec, string>
  sync_rows!: Table<SyncRowRec, string>
  readonly isVault: boolean

  /**
   * opts.immutableCache: Dexie 읽기 캐시를 'immutable'로(결과를 복제하지 않고 얼린다). 암호화 미들웨어가 그 위에서
   * 언제나 새 객체로 풀어 주므로 앱에는 차이가 없고, 암호문 행을 깊은 복제하지 않아도 된다(openVaultDb가 쓴다).
   */
  constructor(name: string = 'class-manager', opts?: { vault?: boolean; immutableCache?: boolean }) {
    super(name, opts?.immutableCache ? { cache: 'immutable' } : undefined)
    if (opts?.vault) {
      this.isVault = true
      this.version(1).stores(VAULT_STORES)
      return
    }
    this.isVault = false
    this.version(1).stores(STORES_V1)
    // 2: 구글 캘린더에서 가져온 일정
    this.version(2).stores(STORES_V2)
    // 3: 명령 홈·노트함·전달사항·반성문
    this.version(3).stores(STORES_V3)
    // 4: vault와 표 구성을 맞추기 위한 빈 표
    this.version(4).stores(STORES_V4)
  }

  /** 동기화·백업 대상 표를 이름으로 꺼낸다. */
  syncedTable(name: SyncedTable): Table<{ id: string }, string> {
    return this.table(name)
  }
}

export function createDb(name = 'class-manager'): AppDB {
  return new AppDB(name)
}
