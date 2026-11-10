/** 나이스 자동 받기: 앱을 켤 때 학사일정(7일마다)·급식·시간표(하루마다). 시각은 이 기기에 남긴다. */
import type { AppDB } from '../db/schema'

export const NEIS_EVERY = { schedule: 7 * 86400000, week: 86400000 }
type Kind = keyof typeof NEIS_EVERY
export type NeisSyncTimes = Partial<Record<Kind, string>>
const KEY = 'neisAutoSync'

export async function readNeisSyncTimes(db: AppDB): Promise<NeisSyncTimes> {
  return ((await db.device_local.get(KEY))?.value as NeisSyncTimes | undefined) ?? {}
}

export function dueNeis(t: NeisSyncTimes, now: Date): Record<Kind, boolean> {
  const due = (k: Kind) => !t[k] || now.getTime() - new Date(t[k]!).getTime() >= NEIS_EVERY[k]
  return { schedule: due('schedule'), week: due('week') }
}

/** ready: 키와 학교가 정해졌는지. 한 일의 이름을 돌려준다(실패한 일은 시각을 남기지 않아 다음에 다시). */
export async function neisAutoSync(db: AppDB, now: Date, jobs: Record<Kind, () => Promise<void>>, ready: boolean): Promise<Kind[]> {
  if (!ready) return []
  const t = await readNeisSyncTimes(db)
  const due = dueNeis(t, now)
  const done: Kind[] = []
  for (const k of ['schedule', 'week'] as Kind[]) {
    if (!due[k]) continue
    try {
      await jobs[k]()
      t[k] = now.toISOString()
      done.push(k)
    } catch {
      /* 다음에 다시 */
    }
  }
  await db.device_local.put({ id: KEY, value: t })
  return done
}
