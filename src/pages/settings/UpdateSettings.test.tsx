import { render, screen } from '@testing-library/react'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import UpdateSettings from './UpdateSettings'

test('.cmd 도우미 안내가 없다(바로가기는 설정 > 화면)', () => {
  ;(globalThis as { desktop?: unknown }).desktop = { update: { check: async () => ({ status: 'latest' }), get: async () => ({}), restart: async () => {}, onState: () => () => {} } }
  render(
    <AppProviders db={createDb('t-' + crypto.randomUUID())} fs={createMemoryFsAdapter()}>
      <UpdateSettings />
    </AppProviders>,
  )
  expect(screen.queryByLabelText('바로가기·자동 실행')).toBeNull()
  expect(document.body.textContent).not.toMatch(/\.cmd|도우미/)
  delete (globalThis as { desktop?: unknown }).desktop
})
