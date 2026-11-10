import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { addNotice, noticesOn } from '../../lib/notices/notices'
import { listNotes } from '../../lib/notes/notes'
import { updateSettings } from '../../lib/settings'
import { pickExport } from '../../test/exportMenu'
import NoticeTab from './NoticeTab'

async function setup(ai?: () => Promise<string>) {
  const db = createDb('test-' + crypto.randomUUID())
  const fs = createMemoryFsAdapter()
  await addNotice(db, { text: '동의서 걷기', start_date: '2026-11-10', end_date: '2026-11-12' })
  await addNotice(db, { text: '체육복', start_date: '2026-11-11' })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={fs} ai={ai}>
        <NoticeTab date="2026-11-11" />
      </AppProviders>
    </MemoryRouter>,
  )
  return { db, fs }
}
const rows = () => within(screen.getByRole('list', { name: '전달사항 목록' })).getAllByRole('listitem')

test('기간 안 항목이 보이고, 고정하면 맨 위, 체크·지우기·되돌리기', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  await waitFor(() => expect(rows().map((r) => r.querySelector('input[type=text]')?.getAttribute('value'))).toEqual(['동의서 걷기', '체육복']))
  expect(within(rows()[0]).getByText('11/10~11/12')).toBeInTheDocument()
  await user.click(within(rows()[1]).getByRole('button', { name: '체육복 고정' }))
  await waitFor(() => expect(rows()[0].querySelector('input[type=text]')).toHaveValue('체육복'))
  await user.click(within(rows()[1]).getByRole('checkbox', { name: '동의서 걷기 완료' }))
  await waitFor(async () => expect((await noticesOn(db, '2026-11-11')).find((n) => n.text === '동의서 걷기')!.done).toBe(true))
  await user.click(within(rows()[0]).getByRole('button', { name: '체육복 지우기' }))
  await waitFor(() => expect(rows()).toHaveLength(1))
  await user.click(screen.getByRole('button', { name: /되돌리기/ }))
  await waitFor(() => expect(rows()).toHaveLength(2))
})

test('직접 추가는 기간을 고를 수 있고, 끝이 시작보다 앞이면 오류', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  await user.type(screen.getByLabelText('새 전달사항'), '우산')
  await user.clear(screen.getByLabelText('끝 날짜'))
  await user.type(screen.getByLabelText('끝 날짜'), '2026-11-09')
  await user.click(screen.getByRole('button', { name: '추가' }))
  expect(await screen.findByText('끝 날짜가 시작 날짜보다 앞입니다.')).toBeInTheDocument()
  await user.clear(screen.getByLabelText('끝 날짜'))
  await user.type(screen.getByLabelText('끝 날짜'), '2026-11-13')
  await user.click(screen.getByRole('button', { name: '추가' }))
  await waitFor(async () => expect((await noticesOn(db, '2026-11-13')).map((n) => n.text)).toEqual(['우산']))
})

test('노트로 보내기 → 체크 블록 노트, 내보내기 엑셀', async () => {
  const user = userEvent.setup()
  const { db, fs } = await setup()
  await waitFor(() => expect(rows()).toHaveLength(2))
  await user.click(screen.getByRole('button', { name: '노트로 보내기' }))
  await waitFor(async () => expect((await listNotes(db))[0].blocks.map((b) => [b.type, b.text])).toEqual([['check', '동의서 걷기'], ['check', '체육복']]))
  await pickExport(user, '엑셀(xlsx)')
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['전달사항_2026-11-11.xlsx']))
})

test('붙여넣어 AI로 나누기 → 항목 추가', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await updateSettings(db, { ai_enabled: true })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()} ai={async () => '{"조례":["강당 집합"],"종례":["체육복"]}'}>
        <NoticeTab date="2026-11-11" />
      </AppProviders>
    </MemoryRouter>,
  )
  await user.click(screen.getByRole('button', { name: '붙여넣어 AI로 나누기' }))
  await user.type(screen.getByLabelText('붙여 넣을 글'), '공지 글')
  await user.click(screen.getByRole('button', { name: 'AI로 나누기' }))
  await waitFor(async () => expect((await noticesOn(db, '2026-11-11')).map((n) => n.text)).toEqual(['강당 집합', '체육복']))
})
