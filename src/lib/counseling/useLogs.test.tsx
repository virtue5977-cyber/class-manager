import { render, screen, waitFor, act } from '@testing-library/react'
import { createDb } from '../db/schema'
import { createMemoryFsAdapter } from '../fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent, setCurrentClassId } from '../roster/roster'
import { saveLog } from './counseling'
import { useCounselingLogs, logSubscriberCount } from './useLogs'
import { useBadges } from '../ui/badges'
import CounselingPage from '../../pages/counseling/CounselingPage'

/** counseling_logs 표를 읽는 길(where·toArray·get·count·toCollection·orderBy·filter)마다 센다. */
function spyReads(db: ReturnType<typeof createDb>) {
  const t = db.counseling_logs as unknown as Record<string, (...a: unknown[]) => unknown>
  let n = 0
  for (const k of ['where', 'toArray', 'get', 'count', 'toCollection', 'orderBy', 'filter', 'each', 'bulkGet']) {
    const orig = t[k]
    if (typeof orig !== 'function') continue
    t[k] = function (this: unknown, ...a: unknown[]) { n++; return orig.apply(this, a) }
  }
  return { reads: () => n, reset: () => { n = 0 } }
}

async function seed() {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  const s = await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  await saveLog(db, { student_id: s.id, date: '2026-11-03', place: '교실', content: '하나' })
  await saveLog(db, { student_id: s.id, date: '2026-11-04', place: '교실', content: '둘' })
  return { db, c, s }
}

function Badge() {
  const b = useBadges()
  return <p>배지 {b.unorganizedLogs}</p>
}
function Count({ db, classId }: { db: ReturnType<typeof createDb>; classId: string }) {
  const logs = useCounselingLogs(db, classId)
  return <p>건수 {logs?.length ?? '읽는 중'}</p>
}

test('누가기록 첫 화면(페이지 + 사이드바 배지 + 전체 목록)은 counseling_logs를 1번만 읽는다', async () => {
  const { db } = await seed()
  const spy = spyReads(db)
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()} ai={async () => '{}'}>
      <Badge />
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  expect(await screen.findByText('배지 2')).toBeInTheDocument()
  await screen.findByRole('region', { name: '전체 누가기록' })
  await waitFor(() => expect(screen.getAllByText(/하나|둘/).length).toBeGreaterThan(0))
  await new Promise((r) => setTimeout(r, 200))
  expect(spy.reads()).toBe(1)
})

test('같은 학급을 쓰는 훅은 하나의 구독을 나누고, 모두 떠나면 구독을 끊는다', async () => {
  const { db, c, s } = await seed()
  const spy = spyReads(db)
  const a = render(<Count db={db} classId={c.id} />)
  const b = render(<Count db={db} classId={c.id} />)
  await waitFor(() => expect(screen.getAllByText('건수 2')).toHaveLength(2))
  expect(logSubscriberCount(db, c.id)).toBe(2)
  expect(spy.reads()).toBe(1)
  await act(async () => { await saveLog(db, { student_id: s.id, date: '2026-11-05', place: '', content: '셋' }) })
  await waitFor(() => expect(screen.getAllByText('건수 3')).toHaveLength(2))
  a.unmount()
  expect(logSubscriberCount(db, c.id)).toBe(1)
  b.unmount()
  expect(logSubscriberCount(db, c.id)).toBe(0)
})
