import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppProviders } from '../../app/context'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import SuggestCard from './SuggestCard'

test('추천 카드: 칸에서 고쳐 넣기, 모두 넣기, 넣은 줄은 넣음', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <SuggestCard today="2026-11-12" items={[{ kind: 'notice', text: '강당 교육', date: '2026-11-12' }, { kind: 'event', text: '올림픽', date: '2026-11-13', time: '09:00' }, { kind: 'todo', text: '명단 입력', date: '' }]} />
      </AppProviders>
    </MemoryRouter>,
  )
  const t = screen.getByRole('textbox', { name: '전달사항 1 내용' })
  await user.clear(t)
  await user.type(t, '강당 교육(3교시)')
  await user.click(screen.getAllByRole('button', { name: '넣기' })[0])
  await waitFor(async () => expect((await db.notice_items.toArray()).map((n) => n.text)).toEqual(['강당 교육(3교시)']))
  expect(screen.getByRole('button', { name: '넣음' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '모두 넣기(2)' }))
  await waitFor(async () => expect((await db.todos.toArray()).map((x) => x.parts)).toEqual([['명단 입력']]))
  expect((await db.local_events.toArray()).map((e) => [e.date, e.time, e.title])).toEqual([['2026-11-13', '09:00', '올림픽']])
})
