import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import SettingsPage from './SettingsPage'

const renderSettings = () =>
  render(
    <MemoryRouter>
      <AppProviders db={createDb('test-' + crypto.randomUUID())} fs={createMemoryFsAdapter()}>
        <SettingsPage />
      </AppProviders>
    </MemoryRouter>,
  )

test('첫 탭은 "잠금·백업"이고 PIN 잠금이 백업보다 먼저 나온다', async () => {
  renderSettings()
  const tab = screen.getAllByRole('tab')[0]
  expect(tab).toHaveTextContent('잠금·백업')
  const panel = screen.getByRole('tabpanel')
  const titles = (await within(panel).findAllByRole('heading', { level: 3 })).map((h) => h.textContent)
  expect(titles.findIndex((t) => t?.startsWith('PIN 잠금'))).toBeLessThan(titles.indexOf('백업'))
})

test('할 일이 남은 탭(백업 암호구 없음, 나이스 미연결)에는 점이 붙는다', async () => {
  renderSettings()
  expect(await screen.findByRole('tab', { name: /잠금·백업 · 할 일 있음/ })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /학교·나이스 · 할 일 있음/ })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '화면' })).toBeInTheDocument()
})
