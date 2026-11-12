import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import type { AppDB } from '../db/schema'
import { listReportsForMonth } from '../absenceReports/list'
import { listLogsByStudents } from '../counseling/counseling'
import { getCurrentClassId } from '../roster/roster'
import { APP_SETTINGS_ID } from '../backup/service'
import { toYmd } from '../schoolDays'
import { useDb } from '../../app/context'

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

/** 자료가 바뀌면 다시 센다(Dexie liveQuery). */
export function useBadges(): Badges {
  const db = useDb()
  const [b, setB] = useState<Badges>({ openReports: 0, unorganizedLogs: 0 })
  useEffect(() => {
    const sub = liveQuery(async () => {
      const cid = await getCurrentClassId(db)
      return cid ? countBadges(db, cid, toYmd(new Date()).slice(0, 7)) : { openReports: 0, unorganizedLogs: 0 }
    }).subscribe({ next: setB, error: () => {} })
    return () => sub.unsubscribe()
  }, [db])
  return b
}
