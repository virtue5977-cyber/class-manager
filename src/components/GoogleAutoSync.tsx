import { useEffect, useMemo, useRef } from 'react'
import { useDb } from '../app/context'
import { ensureGoogleClient, getGoogle, syncGoogle } from '../lib/google/google'
import { BUILTIN_GOOGLE_CLIENT } from '../lib/google/client-config'
import { createSyncRunner } from '../lib/google/runner'
import { getCurrentClassId } from '../lib/roster/roster'
import { toYmd } from '../lib/schoolDays'
import { useLive } from '../lib/ui/useLive'

export const GOOGLE_EVERY_MS = 30 * 60_000
export const GOOGLE_AFTER_CHANGE_MS = 10_000

/** 구글 달력 자동 맞춤(로그인돼 있을 때만, 조용히): 켤 때(5초 뒤) · 켜 있는 동안 30분마다 · 내 일정·학사일정이 바뀌면 10초 뒤 한 번. */
export default function GoogleAutoSync() {
  const db = useDb()
  const g = getGoogle()
  const runner = useMemo(
    () =>
      g
        ? createSyncRunner(async () => {
            if ((await ensureGoogleClient(g, BUILTIN_GOOGLE_CLIENT)).loggedIn) await syncGoogle(db, g, toYmd(new Date()), await getCurrentClassId(db))
          }, GOOGLE_AFTER_CHANGE_MS)
        : null,
    [db, g],
  )
  useEffect(() => {
    if (!runner) return undefined
    const first = setTimeout(() => void runner.now(), 5000)
    const every = setInterval(() => void runner.now(), GOOGLE_EVERY_MS)
    return () => {
      clearTimeout(first)
      clearInterval(every)
      runner.stop()
    }
  }, [runner])
  // 내 일정·학사일정이 바뀌었는지(개수 + 마지막 고친 때)
  const sig = useLive<string>(
    async () => {
      if (!runner) return ''
      const parts: string[] = []
      for (const t of [db.local_events, db.school_calendar] as const) {
        const rows = (await t.toArray()) as { updated_at?: string }[]
        parts.push(`${rows.length}:${rows.reduce((m, r) => ((r.updated_at ?? '') > m ? r.updated_at ?? '' : m), '')}`)
      }
      return parts.join('|')
    },
    [db, runner],
    '',
  )
  const seen = useRef<string>('')
  useEffect(() => {
    if (!sig) return
    if (seen.current && seen.current !== sig) runner?.poke()
    seen.current = sig
  }, [sig, runner])
  return null
}
