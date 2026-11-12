import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import UpdateSettings from './UpdateSettings'

test('exe(데스크톱)에서만 바로가기·자동 실행 도우미, 누르면 .cmd를 받는다', async () => {
  const fs = createMemoryFsAdapter()
  const db = createDb('t-' + crypto.randomUUID())
  const { unmount } = render(
    <AppProviders db={db} fs={fs}>
      <UpdateSettings />
    </AppProviders>,
  )
  expect(screen.queryByLabelText('바로가기·자동 실행')).toBeNull()
  unmount()
  ;(globalThis as { desktop?: unknown }).desktop = { update: { check: async () => ({ status: 'latest' }), get: async () => ({}), restart: async () => {}, onState: () => () => {} } }
  render(
    <AppProviders db={db} fs={fs}>
      <UpdateSettings />
    </AppProviders>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '바로가기·자동 실행 만들기(.cmd 받기)' }))
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['Watson_바로가기_만들기.cmd']))
  delete (globalThis as { desktop?: unknown }).desktop
})
