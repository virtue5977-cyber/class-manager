import { useEffect } from 'react'
import { useDb } from '../app/context'
import { migrateBriefings } from '../lib/notices/notices'
import { pruneChat } from '../lib/command/chatLog'
import { toYmd } from '../lib/schoolDays'

/** 켤 때 한 번: 예전 조례·종례 → 전달사항 옮기기, 지난 학년도 대화 정리. */
export default function StartupTasks() {
  const db = useDb()
  useEffect(() => {
    migrateBriefings(db).catch(() => {})
    pruneChat(db, toYmd(new Date())).catch(() => {})
  }, [db])
  return null
}
