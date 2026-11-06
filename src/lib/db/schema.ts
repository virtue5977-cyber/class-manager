import Dexie, { type Table } from 'dexie'
import type {
  AbsenceReportRec, AiPromptRec, AppSettingsRec, AttendanceRec, BriefingRec, ClassRec,
  CleaningChartRec, CounselingLogRec, DeviceLocalRec, HwpxTemplateRec, NeisCacheRec, NoticeRec,
  ReportAttendanceRec, SchoolCalendarRec, SeatingChartRec, StudentRec, TeacherTimetableRec,
} from './types'

export const SCHEMA_VERSION = 1

export const SYNCED_TABLES = [
  'classes', 'students', 'attendance', 'absence_reports', 'report_attendance', 'counseling_logs',
  'seating_charts', 'cleaning_charts', 'school_calendar', 'neis_cache', 'teacher_timetable',
  'ai_prompts', 'notices', 'briefings', 'hwpx_templates', 'app_settings',
] as const

export type SyncedTable = (typeof SYNCED_TABLES)[number]

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

  constructor(name: string) {
    super(name)
    this.version(SCHEMA_VERSION).stores({
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
    })
  }

  /** 동기화·백업 대상 표를 이름으로 꺼낸다. */
  syncedTable(name: SyncedTable): Table<{ id: string }, string> {
    return this.table(name)
  }
}

export function createDb(name = 'class-manager'): AppDB {
  return new AppDB(name)
}
