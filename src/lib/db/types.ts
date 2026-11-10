// 레코드 타입: 설계 문서 5절의 필드를 snake_case 그대로 따른다.

export interface BaseRecord {
  id: string
  created_at: string
  updated_at: string
  deleted: boolean
}

export type AttendanceKind = '결석' | '지각' | '조퇴' | '결과'
export type AttendanceCategory = '미인정' | '질병' | '출석인정'
export type EvidenceType = '2일 이내 질병' | '3일 이상 질병' | '법정전염병' | '경조사 참석' | '기타' | ''
export type RecognizedEvidence = '법정전염병' | '경조사 참석' | '기타'

export interface ClassRec extends BaseRecord {
  school_year: number
  grade: number
  class_no: number
}

export interface StudentRec extends BaseRecord {
  class_id: string
  number: number
  name: string
  address: string
  birth_date: string
  prev_school: string
  phone: string
  hobby: string
  talent: string
  commute: string
  friends: string
  memo: string
  guardian_name: string
  guardian_phone: string
  /** 남 / 여 / '' (예전 기록에는 없을 수 있음) */
  gender?: string
  /** 예: 어머니 */
  guardian_relation?: string
  active: boolean
}

export interface AttendanceRec extends BaseRecord {
  student_id: string
  date: string // YYYY-MM-DD
  kind: AttendanceKind
  category: AttendanceCategory
  /** 지각·조퇴·결과의 교시: '3' 또는 '3~4'. 결석이면 null */
  period: string | null
  reason: string
  evidence_type: RecognizedEvidence | null
  memo: string
}

export interface AbsenceReportRec extends BaseRecord {
  student_id: string
  start_date: string
  end_date: string
  kind: AttendanceKind
  category: AttendanceCategory
  period: string | null
  school_days: number
  evidence_type: EvidenceType
  /** 담임 확인 방법 0~4: 진료확인서·처방전 / 약봉투·영수증 / 소견서·진단서 / 보호자 통화(문자) / 기타 */
  confirm_methods: number[]
  written_date: string
  confirmed_date: string
  diagnosis_required: boolean
  diagnosis_received: boolean
  submitted: boolean
  submitted_at: string | null
  detail: string
  /** 사용자가 직접 고친 칸 이름 */
  overrides: string[]
  /** 출결이 바뀌어 다시 확인이 필요 */
  stale: boolean
}

export interface ReportAttendanceRec extends BaseRecord {
  report_id: string
  attendance_id: string
}

export type NugaStatus = '미정리' | '정리됨' | '나이스 입력 완료'

export interface CounselingLogRec extends BaseRecord {
  student_id: string
  date: string
  place: string
  content: string
  nuga_text: string
  nuga_status: NugaStatus
  nuga_entered_at: string | null
  /** 상담 대상·방법·분야·시각(예전 기록에는 없을 수 있음) */
  target?: string
  method?: string
  topic?: string
  time?: string
}

export interface Seat {
  row: number
  col: number
  student_id: string | null
  fixed: boolean
  disabled: boolean
}

export interface SeatingChartRec extends BaseRecord {
  class_id: string
  title: string
  date: string
  rows: number
  cols: number
  seats: Seat[]
  podium_position: 'bottom' | 'top'
  show_roster: boolean
  active: boolean
}

export interface CleaningColumn {
  id: string
  name: string
  type: 'text' | 'students'
  order: number
}

export interface CleaningRow {
  id: string
  order: number
  cells: Record<string, string | string[]>
}

export interface CleaningChartRec extends BaseRecord {
  class_id: string
  title: string
  date: string
  columns: CleaningColumn[]
  rows: CleaningRow[]
  active: boolean
}

export interface SchoolCalendarRec extends BaseRecord {
  date: string
  title: string
  type: '수업일' | '휴업일' | '행사' | '방학'
  is_class_day: boolean
  source: 'neis' | 'manual'
  /** 특정 학년만의 일정이면 학년 번호들, 전체면 null */
  grades: number[] | null
}

export interface NeisCacheRec extends BaseRecord {
  kind: 'schedule' | 'meal' | 'class_timetable'
  range_key: string
  payload: unknown
  fetched_at: string
}

export interface TeacherTimetableRec extends BaseRecord {
  weekday: number
  period: number
  subject: string
  class_label: string
  note: string
  source: 'estimated' | 'manual'
}

export interface AiPromptRec extends BaseRecord {
  kind: 'nuga' | 'briefing'
  instruction: string
  version: number
  active: boolean
}

export interface NoticeRec extends BaseRecord {
  raw_text: string
  source_kind: 'paste' | 'image' | 'memo'
  target_date: string
}

export interface BriefingItem {
  text: string
  order: number
  done: boolean
}

export interface BriefingRec extends BaseRecord {
  target_date: string
  slot: '조례' | '종례'
  items: BriefingItem[]
  edited: boolean
}

export interface HwpxTemplateRec extends BaseRecord {
  name: string
  version: number
  data: Uint8Array
  active: boolean
}

/** 동기화·백업 대상 설정. 기기 전용 값은 DeviceLocalRec에 둔다. */
export interface AppSettingsRec extends BaseRecord {
  teacher_name: string
  school_name: string
  neis_office_code: string
  neis_school_code: string
  ai_enabled: boolean
  /** 'claude-code' = 노트북의 Claude Code(Pro 구독), 'api-key' = Claude API 키 (예전 기록에는 없음) */
  ai_provider?: 'claude-code' | 'api-key' | 'antigravity'
  mask_names: boolean
  nuga_max_chars: number | null
  my_subjects: string[]
  my_class_labels: string[]
  pin_enabled: boolean
  pin_lock_on_resume: boolean
  backup_keep_count: number
  school_kind: SchoolKind
  /** 신고서를 만들 '구분:종류' 목록 */
  report_rules: string[]
  diagnosis_days: number
  student_code_format: string
}

export type SchoolKind = '초등학교' | '중학교' | '고등학교' | ''

export type DeviceLocalId = 'backupKey' | 'backupFolder' | 'lastBackupAt' | 'aiApiKey' | 'neisApiKey' | 'pin' | 'pinFails'

/** 이 기기에만 있는 값. 백업·동기화에서 통째로 제외한다. */
export interface DeviceLocalRec {
  id: DeviceLocalId | string
  value: unknown
}

/** 구글 캘린더 일정(가져오기 전용). id = 구글 일정 id */
export interface GoogleEventRec {
  id: string
  /** 시작 날짜 YYYY-MM-DD(여러 날이면 첫날) */
  date: string
  end_date: string
  /** 종일이 아니면 HH:MM */
  time: string
  title: string
  calendar: string
  updated: string
}
