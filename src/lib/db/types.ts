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
  /** 명단 양식에 더한 칸 값(열쇠 x_…) */
  extra?: Record<string, string>
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
  /** 기록 종류(없으면 상담) */
  kind?: '상담' | '관찰'
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
  kind: 'nuga' | 'briefing' | 'command' | 'message' | 'reflection'
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
  /** 누가기록 '미정리' 알림(메뉴 숫자) 끄기 */
  nuga_alert_off?: boolean
  teacher_name: string
  school_name: string
  neis_office_code: string
  neis_school_code: string
  ai_enabled: boolean
  /** 'claude-code' = 노트북의 Claude Code(Pro 구독), 'api-key' = Claude API 키 (예전 기록에는 없음) */
  ai_provider?: 'claude-code' | 'api-key' | 'antigravity' | 'gemini'
  /** 구글 Gemini 모델(없으면 기본) */
  gemini_model?: string
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
  /** 명단 양식(칸 순서·보이기·추가 칸). 없으면 기본 */
  roster_fields?: RosterField[]
  /** 노트함 폴더(상하위). 없으면 폴더 없음 */
  note_folders?: NoteFolder[]
}
export interface NoteFolder {
  id: string
  name: string
  /** 위 폴더 id(맨 위면 null) */
  parent: string | null
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

// ---- v3: 명령 홈 · 노트함 · 전달사항 · 반성문 ----
/** 전달사항(기간 안 날짜의 홈에 보임) */
export interface NoticeItemRec extends BaseRecord {
  text: string
  start_date: string
  end_date: string
  done: boolean
  pinned: boolean
  order: number
  /** 짝 노트(그날 전달사항 노트)와 그 노트의 줄 */
  note_id?: string
  block_id?: string
  /** @노트 링크가 든 글(할 일과 같은 형식). 없으면 text 그대로 */
  parts?: TodoPart[]
}

export type NoteBlockType = 'p' | 'h1' | 'h2' | 'check' | 'bullet' | 'number' | 'divider' | 'file' | 'folder' | 'roster' | 'table' | 'image' | 'pagebreak'
export interface NoteBlock {
  id: string
  type: NoteBlockType
  text?: string
  checked?: boolean
  file_id?: string
  path?: string
  /** 개요 깊이 0~4 */
  indent?: number
  /** 문단 정렬(없으면 양쪽) */
  align?: 'left' | 'center' | 'right' | 'justify'
  /** 줄 간격 %(없으면 160) */
  line?: 130 | 160 | 200
  /** 학생 체크 표(roster): 만든 때의 학생(번호 이름)과 체크. text는 표 제목 */
  rows?: { sid: string; label: string; checked: boolean }[]
  /** 학생 체크 표 크기(작게 = 여러 칸 격자, 기본 보통) */
  size?: 'sm' | 'md' | 'lg'
  /** 체크한 학생 숨기기 */
  hide_done?: boolean
  /** 표 접기 */
  collapsed?: boolean
  /** 표(table): 칸 글[줄][칸], 칸 너비 %, 첫 줄 머리 */
  cells?: string[][]
  widths?: number[]
  head?: boolean
  /** 그림(image): 너비 %(기본 100), 설명 */
  width?: number
  caption?: string
  /** 글자 서식(text 안 위치 [from,to)). 없으면 서식 없음 */
  marks?: import('../notes/marks').Mark[]
  /** @노트 링크(text 안 위치) */
  links?: import('../notes/marks').NoteLink[]
}
export interface NotePage {
  view: boolean
  margin: 'narrow' | 'normal' | 'wide'
  grid: boolean
  /** 확대 %(50~200) */
  zoom?: number
  header?: string
  footer?: string
  /** 쪽 보기에서 센 쪽 수(한글 내보내기의 {전체쪽}) */
  pages?: number
}
export interface NoteRec extends BaseRecord {
  title: string
  blocks: NoteBlock[]
  pinned: boolean
  /** 들어 있는 폴더(없거나 지운 폴더면 맨 위) */
  folder_id?: string | null
  /** 끌어서 정한 순서(없으면 맨 위, 최근 고친 순) */
  order?: number
  /** 이 날짜 전달사항과 짝인 노트(YYYY-MM-DD) */
  notice_date?: string
  /** 쪽 보기·여백·격자·확대·머리말·꼬리말(없으면 화면 너비 보기) */
  page?: NotePage
}
/** 노트 첨부(내용은 base64, 50MB까지) */
export interface NoteFileRec extends BaseRecord {
  note_id: string
  name: string
  mime: string
  size: number
  data: string
}

export type TodoPart = string | { note: string } | { student: string }
export interface TodoRec extends BaseRecord {
  parts: TodoPart[]
  due: string | null
  done: boolean
  done_at: string | null
  order: number
}

export interface LocalEventRec extends BaseRecord {
  date: string
  end_date: string | null
  time: string | null
  title: string
  tag: '개인' | '업무'
  google_id: string | null
  /** 장소(선택) */
  place?: string
  /** 메모(선택) */
  memo?: string
}

export interface ChatRec extends BaseRecord {
  at: string
  school_year: number
  input: string
  mode: 'rule' | 'hybrid' | 'ai'
  summary: string
  links: { label: string; to: string }[]
  status: '성공' | '실패' | '확인 필요'
  detail?: string
  /** 대화 묶음(새 채팅마다). 없으면 '이전 대화' */
  thread?: string
}

export interface ReflectionRec extends BaseRecord {
  student_id: string
  date: string
  reason: string
  lines: string[]
  t1: string
  t2: string
  mode: 'B4' | 'A4'
}
export interface ReflectionPhraseRec extends BaseRecord {
  text: string
  starred_at: string
  /** 좋은 글(16줄 전체)이면 이름과 줄. 없으면 예전 '좋은 문장' 한 줄 */
  title?: string
  lines?: string[]
}

/** 명단 양식 한 칸. builtin이면 key는 학생 글 칸 이름, 아니면 x_… (값은 StudentRec.extra) */
export interface RosterField {
  key: string
  label: string
  builtin: boolean
  visible: boolean
}
