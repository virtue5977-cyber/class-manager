import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppProviders } from '../app/context'
import { createDb } from '../lib/db/schema'
import { createMemoryFsAdapter } from '../lib/fs/memory'
import { appendChat, listChat } from '../lib/command/chatLog'
import { currentThread, newThread, LEGACY_THREAD, setCurrentThread } from '../lib/command/chatThreads'
import RecentChats from './RecentChats'
import ChatLog from './command/ChatLog'

const e = (input: string) => ({ input, mode: 'rule' as const, summary: '요약', links: [], status: '성공' as const })

test('최근 대화: 묶음을 누르면 그 대화가 열리고, 휴지통은 한 번 더 물은 뒤 지운다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  setCurrentThread(LEGACY_THREAD)
  const a = newThread()
  await appendChat(db, e('/할일 첫 대화'))
  const b = newThread()
  await appendChat(db, e('/찾기 둘째 대화'))
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <RecentChats />
        <ChatLog today={new Date().toISOString().slice(0, 10)} onRun={() => {}} />
      </AppProviders>
    </MemoryRouter>,
  )
  expect(await screen.findByText('/찾기 둘째 대화', { selector: '.bubble' })).toBeInTheDocument()
  expect(screen.queryByText('/할일 첫 대화', { selector: '.bubble' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '/할일 첫 대화' }))
  expect(currentThread()).toBe(a)
  expect(await screen.findByText('/할일 첫 대화', { selector: '.bubble' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: "대화 '/찾기 둘째 대화' 지우기" }))
  const { within } = await import('@testing-library/react')
  await user.click(within(screen.getByRole('group', { name: '대화 지우기 확인' })).getByRole('button', { name: '지우기' }))
  await waitFor(async () => expect((await listChat(db, 2026, b)).length).toBe(0))
  expect((await listChat(db, 2026, a)).length).toBe(1)
})
