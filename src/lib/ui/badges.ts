import type { AppDB } from '../db/schema'
import { listReportsForMonth } from '../absenceReports/list'
import { listLogsByStudents } from '../counseling/counseling'
import { getCurrentClassId } from '../roster/roster'
import { APP_SETTINGS_ID } from '../backup/service'
import { toYmd } from '../schoolDays'
import { useDb } from '../../app/context'
import { useCounselingLogs } from '../counseling/useLogs'
import { useLive } from './useLive'

export interface Badges {
  openReports: number
  unorganizedLogs: number
}

/** 메뉴 옆 숫자: 이번 달 미제출 결석신고서, 아직 누가기록으로 정리하지 않은 상담 기록. */
export async function countBadges(db: AppDB, classId: string, month: string): Promise<Badges> {
  const openReports = (await listReportsForMonth(db, classId, month)).filter((r) => !r.report.submitted).length
  const ids = (await db.students.where('class_id').equals(classId).toArray()).filter((s) => !s.deleted).map((s) => s.id)
  // 알림을 끄면 세지 않는다(liveQuery 안이라 읽기만)
  const off = (await db.app_settings.get(APP_SETTINGS_ID))?.nuga_alert_off
  if (off) return { openReports, unorganizedLogs: 0 }
  const logs = Object.values(await listLogsByStudents(db, ids)).flat()
  return { openReports, unorganizedLogs: logs.filter((l) => l.nuga_status === '미정리').length }
}

/** 자료가 바뀌면 다시 센다(Dexie liveQuery). 누가기록은 페이지와 같은 읽기를 나눠 쓴다. */
export function useBadges(): Badges {
  const db = useDb()
  const classId = useLive<string | undefined>(() => getCurrentClassId(db), [db], undefined)
  const openReports = useLive<number>(async () => {
    const cid = await getCurrentClassId(db)
    return cid ? (await listReportsForMonth(db, cid, toYmd(new Date()).slice(0, 7))).filter((r) => !r.report.submitted).length : 0
  }, [db], 0)
  const alertOff = useLive<boolean>(async () => !!(await db.app_settings.get(APP_SETTINGS_ID))?.nuga_alert_off, [db], false)
  const logs = useCounselingLogs(db, classId)
  return { openReports, unorganizedLogs: alertOff || !logs ? 0 : logs.filter((l) => l.nuga_status === '미정리').length }
}
