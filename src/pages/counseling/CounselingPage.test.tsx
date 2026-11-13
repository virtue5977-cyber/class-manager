import { render, screen, waitFor, within } from '@testing-library/react'
import { pickExport } from '../../test/exportMenu'
import userEvent from '@testing-library/user-event'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent } from '../../lib/roster/roster'
import { updateSettings } from '../../lib/settings'
import { listLogsByStudent, saveLog } from '../../lib/counseling/counseling'
import type { AiRequest } from '../../lib/ai/client'
import CounselingPage from './CounselingPage'

test('기록 추가 → AI 정리(가짜) → 나이스 입력 완료, 미입력 필터, 내보내기', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  await saveStudent(db, c.id, emptyStudent(2, '박민수'))
  await updateSettings(db, { ai_enabled: true })
  const ai = async (req: AiRequest) => {
    const items = JSON.parse(req.user) as { id: string; 메모: string }[]
    return JSON.stringify({ items: items.map((i) => ({ id: i.id, text: `정리: ${i.메모}` })) })
  }
  const fs = createMemoryFsAdapter()
  render(
    <AppProviders db={db} fs={fs} ai={ai}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  await user.click(await screen.findByRole('button', { name: /^1번 김지훈/ }))
  await user.type(screen.getByLabelText('장소'), '교실')
  await user.type(screen.getByLabelText('내용(개조식 메모나 녹음 글)'), '박민수랑 말다툼')
  await user.click(screen.getByRole('button', { name: '기록 추가' }))
  const card = await screen.findByRole('article', { name: '2026.11.05.(목) | 교실 | 학생·대면 기록' })
  expect(within(card).getByText('미정리')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '미정리 1건 누가기록으로 정리' }))
  expect(await screen.findByText('1건을 누가기록으로 정리했습니다.')).toBeInTheDocument()
  const [log] = await listLogsByStudent(db, s.id)
  expect(log.nuga_text).toBe('정리: 박민수랑 말다툼')
  await user.click(within(await screen.findByRole('article')).getByLabelText('나이스 입력 완료'))
  await waitFor(async () => expect((await listLogsByStudent(db, s.id))[0].nuga_status).toBe('나이스 입력 완료'))
  await user.selectOptions(screen.getByLabelText('보기'), '나이스 미입력')
  expect(await screen.findByText('해당하는 기록이 없습니다.')).toBeInTheDocument()
  await pickExport(user, '한글(hwpx)')
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['1번_김지훈_누가기록.hwpx']))
})

test('AI가 꺼져 있으면 안내', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()} ai={async () => '{}'}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  await user.click(await screen.findByRole('button', { name: /^1번 김지훈/ }))
  await user.type(screen.getByLabelText('내용(개조식 메모나 녹음 글)'), '메모')
  await user.click(screen.getByRole('button', { name: '기록 추가' }))
  await user.click(await screen.findByRole('button', { name: '누가기록으로 정리' }))
  expect(await screen.findByText(/AI가 꺼져 있습니다/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '설정 > AI 열기' })).toHaveAttribute('href', '#/settings?tab=ai')
})

test('대상·방법·분야를 고르면 저장되고 분야로 걸러 본다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()} ai={async () => '{}'}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  await user.click(await screen.findByRole('button', { name: /^1번 김지훈/ }))
  await user.click(within(screen.getByRole('radiogroup', { name: '대상' })).getByRole('radio', { name: '보호자' }))
  await user.click(within(screen.getByRole('radiogroup', { name: '방법' })).getByRole('radio', { name: '전화' }))
  await user.click(within(screen.getByRole('radiogroup', { name: '분야' })).getByRole('radio', { name: '진로' }))
  await user.type(screen.getByLabelText('내용(개조식 메모나 녹음 글)'), '진학 상담')
  await user.click(screen.getByRole('button', { name: '기록 추가' }))
  expect(await screen.findByText('보호자 · 전화 · 진로')).toBeInTheDocument()
  expect((await listLogsByStudent(db, s.id))[0]).toMatchObject({ target: '보호자', method: '전화', topic: '진로' })
  await user.selectOptions(screen.getByLabelText('분야 보기'), '학업')
  expect(await screen.findByText('해당하는 기록이 없습니다.')).toBeInTheDocument()
})

test('정리 전 기록은 누가기록 칸 없이 짧게 보이고, "직접 쓰기"를 누르면 칸이 열린다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()} ai={async () => '{}'}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  await user.click(await screen.findByRole('button', { name: /^1번 김지훈/ }))
  await user.type(screen.getByLabelText('내용(개조식 메모나 녹음 글)'), '메모')
  await user.click(screen.getByRole('button', { name: '기록 추가' }))
  const card = await screen.findByRole('article')
  expect(within(card).queryByLabelText('누가기록')).not.toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: '복사' })).not.toBeInTheDocument()
  await user.click(within(card).getByRole('button', { name: '직접 쓰기' }))
  expect(within(card).getByLabelText('누가기록')).toBeInTheDocument()
})

test('학생 목록에 마지막 상담일을 보이고, 한 달 넘게 기록이 없으면 표시하며, 오래된 순으로 정렬할 수 있다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const a = await saveStudent(db, c.id, emptyStudent(1, '가나'))
  const b = await saveStudent(db, c.id, emptyStudent(2, '다라'))
  await saveLog(db, { student_id: a.id, date: '2026-11-02', place: '', content: '최근' })
  await saveLog(db, { student_id: b.id, date: '2026-09-01', place: '', content: '오래전' })
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  const ga = await screen.findByRole('button', { name: /^1번 가나/ })
  await waitFor(() => expect(ga).toHaveTextContent('11/2'))
  expect(ga).not.toHaveTextContent('한 달 넘음')
  expect(screen.getByRole('button', { name: /^2번 다라/ })).toHaveTextContent('한 달 넘음')
  await user.selectOptions(screen.getByLabelText('정렬'), '오래된 순')
  const names = within(screen.getByRole('list', { name: '학생 목록' })).getAllByRole('button').map((x) => x.textContent)
  expect(names[0]).toMatch(/^2번 다라/)
})

test('새 기록을 저장하면 입력 칸이 닫히고 그 기록이 잠깐 강조된다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const a = await saveStudent(db, c.id, emptyStudent(1, '가나'))
  await saveLog(db, { student_id: a.id, date: '2026-11-01', place: '', content: '예전' })
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  await user.click(await screen.findByRole('button', { name: /^1번 가나/ }))
  await user.click(await screen.findByRole('button', { name: '+ 새 기록' }))
  await user.type(screen.getByLabelText('내용(개조식 메모나 녹음 글)'), '새 메모')
  await user.click(screen.getByRole('button', { name: '기록 추가' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '기록 추가' })).not.toBeInTheDocument())
  const fresh = (await screen.findAllByRole('article')).find((x) => x.textContent?.includes('새 메모'))!
  expect(fresh).toHaveClass('flash')
})

test('이름 가림 중에는 내보낸 파일 이름에 학생 이름 대신 번호만', async () => {
  const { setHideNames } = await import('../../components/HideNames')
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  await saveLog(db, { student_id: s.id, date: '2026-11-02', place: '교실', content: '진로 고민' })
  const fs = createMemoryFsAdapter()
  setHideNames(true)
  try {
    render(
      <AppProviders db={db} fs={fs}>
        <CounselingPage />
      </AppProviders>,
    )
    await user.click(await screen.findByRole('button', { name: /^1번/ }))
    await pickExport(user, '엑셀(xlsx)')
    await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['1번_누가기록.xlsx']))
  } finally {
    setHideNames(false)
  }
})

test('그 학생 반성문이 있으면 상담일지에 "반성문 n건" 링크', async () => {
  const { saveReflection, DEFAULT_LINES } = await import('../../lib/reflection/store')
  const { MemoryRouter } = await import('react-router-dom')
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  await saveReflection(db, { student_id: s.id, date: '2026-11-10', reason: '지각', lines: DEFAULT_LINES, t1: '', t2: '', mode: 'B4' })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <CounselingPage />
      </AppProviders>
    </MemoryRouter>,
  )
  await user.click(await screen.findByRole('button', { name: /^1번/ }))
  expect(await screen.findByRole('link', { name: '반성문 1건' })).toHaveAttribute('href', `/class/reflection?sid=${s.id}`)
})

test('주소의 ?sid= 학생이 처음부터 열린다(명령·할 일 링크)', async () => {
  const { MemoryRouter } = await import('react-router-dom')
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  const s2 = await saveStudent(db, c.id, emptyStudent(2, '박민수'))
  window.location.hash = `#/counseling?sid=${s2.id}`
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <CounselingPage />
      </AppProviders>
    </MemoryRouter>,
  )
  expect(await screen.findByRole('heading', { name: '2번 박민수' })).toBeInTheDocument()
  window.location.hash = ''
})

test('기본 화면은 학급 전체 누가기록(종류·학생 거르기), 관찰 기록은 대상·방법 없이, 줄을 누르면 그 학생', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const students = [await saveStudent(db, c.id, emptyStudent(1, '김지훈')), await saveStudent(db, c.id, emptyStudent(2, '박민수'))]
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  await saveLog(db, { student_id: students[0].id, date: '2026-11-03', place: '교실', content: '진로 상담' })
  await saveLog(db, { student_id: students[1].id, date: '2026-11-05', place: '복도', content: '친구를 도움', kind: '관찰' })
  const all = await screen.findByRole('region', { name: '전체 누가기록' })
  await waitFor(() => expect(within(all).getAllByRole('row')).toHaveLength(3))
  expect(within(all).getAllByRole('row')[1]).toHaveTextContent('관찰')
  await user.selectOptions(within(all).getByLabelText('종류'), '상담')
  expect(within(all).getAllByRole('row')).toHaveLength(2)
  expect(within(all).getAllByRole('row')[1]).toHaveTextContent('진로 상담')
  await user.click(within(all).getByText('진로 상담'))
  expect(await screen.findByRole('button', { name: '전체 기록' })).toBeInTheDocument()
  // 새 기록에서 관찰을 고르면 대상·방법이 사라진다
  await user.click(screen.getByRole('button', { name: '+ 새 기록' }))
  const form = screen.getByLabelText('새 기록')
  await user.click(within(within(form).getByRole('radiogroup', { name: '종류' })).getByRole('radio', { name: '관찰' }))
  expect(within(form).queryByRole('radiogroup', { name: '대상' })).toBeNull()
})

test('0.14: 전체 목록 내보내기, 대상에 교사 없음, 관찰도 분야, 고른 학생 다시 누르면 전체로, 미정리 알림 끄기', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  await saveLog(db, { student_id: s.id, date: '2026-11-03', place: '교실', content: '진로 상담' })
  const fs = createMemoryFsAdapter()
  render(
    <AppProviders db={db} fs={fs}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  const all = await screen.findByRole('region', { name: '전체 누가기록' })
  await waitFor(() => expect(within(all).getAllByRole('row')).toHaveLength(2))
  await pickExport(user, '엑셀(xlsx)')
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['누가기록_전체.xlsx']))
  // 미정리 알림 끄기(설정에 저장)
  await user.click(within(all).getByRole('checkbox', { name: '미정리 알림' }))
  const { getSettings } = await import('../../lib/settings')
  await waitFor(async () => expect((await getSettings(db)).nuga_alert_off).toBe(true))
  // 학생 고르기 → 다시 누르면 전체
  await user.click(within(screen.getByRole('list', { name: '학생 목록' })).getByRole('button', { name: /^1번 김지훈/ }))
  expect(await screen.findByRole('button', { name: '전체 기록' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '+ 새 기록' }))
  const form = screen.getByLabelText('새 기록')
  expect(within(within(form).getByRole('radiogroup', { name: '대상' })).queryByRole('radio', { name: '교사' })).toBeNull()
  await user.click(within(within(form).getByRole('radiogroup', { name: '종류' })).getByRole('radio', { name: '관찰' }))
  expect(within(form).getByRole('radiogroup', { name: '분야' })).toBeInTheDocument()
  await user.click(within(screen.getByRole('list', { name: '학생 목록' })).getByRole('button', { name: /^1번 김지훈/ }))
  expect(await screen.findByRole('region', { name: '전체 누가기록' })).toBeInTheDocument()
})

async function oneLog() {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()} ai={async () => '{}'}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  await user.click(await screen.findByRole('button', { name: /^1번 김지훈/ }))
  await user.type(screen.getByLabelText('내용(개조식 메모나 녹음 글)'), '메모')
  await user.click(screen.getByRole('button', { name: '기록 추가' }))
  const card = await screen.findByRole('article')
  return { user, db, s, card }
}

test('누가기록 칸에 쓰다가 창을 닫으면(flushAll) 저장된다', async () => {
  const { flushAll } = await import('../../lib/ui/flush')
  const { user, db, s, card } = await oneLog()
  await user.click(within(card).getByRole('button', { name: '직접 쓰기' }))
  await user.type(within(card).getByLabelText('누가기록'), '닫기 전에 쓴 누가기록')
  flushAll()
  await waitFor(async () => expect((await listLogsByStudent(db, s.id))[0].nuga_text).toBe('닫기 전에 쓴 누가기록'))
})

test('기록 지우기는 한 번 더 묻는다(취소하면 남음)', async () => {
  const { user, db, s, card } = await oneLog()
  await user.click(within(card).getByRole('button', { name: '지우기' }))
  const ask = within(card).getByRole('group', { name: '기록 지우기 확인' })
  await user.click(within(ask).getByRole('button', { name: '취소' }))
  expect(await listLogsByStudent(db, s.id)).toHaveLength(1)
  await user.click(within(card).getByRole('button', { name: '지우기' }))
  await user.click(within(within(card).getByRole('group', { name: '기록 지우기 확인' })).getByRole('button', { name: '지우기' }))
  await waitFor(async () => expect(await listLogsByStudent(db, s.id)).toHaveLength(0))
})
