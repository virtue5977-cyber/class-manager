import { useEffect } from 'react'
import { useDb, useNeisEvents, useNetFetch } from '../app/context'
import { neisAutoSync } from '../lib/neis/autoSync'
import { importSchoolSchedule } from '../lib/neis/schedule'
import { fetchMeals } from '../lib/neis/meal'
import { fetchWeekTimetable } from '../lib/neis/timetable'
import { currentSchoolYear } from '../lib/roster/schoolYear'
import { getNeisKey, getSettings } from '../lib/settings'
import { migrateBriefings } from '../lib/notices/notices'
import { pruneChat } from '../lib/command/chatLog'
import { addDays, toYmd } from '../lib/schoolDays'
import { weekRange } from '../lib/neis/cache'

/** 켤 때 한 번: 예전 조례·종례 → 전달사항 옮기기, 지난 학년도 대화 정리. */
export default function StartupTasks() {
  const db = useDb()
  useEffect(() => {
    migrateBriefings(db).catch(() => {})
    pruneChat(db, toYmd(new Date())).catch(() => {})
  }, [db])
  // 나이스 자동 받기: 켜고 8초 뒤(첫 화면을 막지 않게), 켜 있는 동안 1시간마다 '받을 때가 됐는지' 확인.
  // 학사일정 7일마다(학년도 전체), 급식은 이번 주·다음 주, 시간표는 이번 주를 하루마다.
  const fetch = useNetFetch()
  const { notifyChanged: notify } = useNeisEvents()
  useEffect(() => {
    const check = async () => {
      try {
        const s = await getSettings(db)
        const ready = !!(await getNeisKey(db)) && !!s.neis_school_code && !!s.neis_office_code
        const today = toYmd(new Date())
        const done = await neisAutoSync(db, new Date(), {
          schedule: async () => void (await importSchoolSchedule(db, currentSchoolYear(new Date()), { fetch })),
          week: async () => {
            await fetchMeals(db, today, { fetch })
            await fetchMeals(db, addDays(weekRange(today).from, 7), { fetch })
            await fetchWeekTimetable(db, today, { fetch })
          },
        }, ready)
        if (done.length) notify()
      } catch {
        /* 설정 > 학교에서 직접 받으면 오류를 볼 수 있다 */
      }
    }
    const t = setTimeout(check, 8000)
    const every = setInterval(check, 3600_000)
    return () => {
      clearTimeout(t)
      clearInterval(every)
    }
  }, [db, fetch, notify])
  return null
}
