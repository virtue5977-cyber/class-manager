import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { setNeisKey, updateSettings } from '../../lib/settings'
import { fakeFetch, neisPage } from '../../lib/neis/fixtures'
import SchoolSettings from './SchoolSettings'
import MyTimetable from './MyTimetable'

test('급식·시간표를 가져오면 같은 화면의 내 시간표가 바로 갱신된다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await setNeisKey(db, 'K')
  await updateSettings(db, { school_name: '가락중학교', neis_office_code: 'B10', neis_school_code: '7130165', school_kind: '중학교' })
  const f = fakeFetch((u) => u.pathname.endsWith('mealServiceDietInfo')
    ? neisPage('mealServiceDietInfo', [])
    : neisPage('misTimetable', [{ ALL_TI_YMD: '20261102', GRADE: '1', CLASS_NM: '1', PERIO: '1', ITRT_CNTNT: '수학' }]))
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()} fetch={f}>
      <SchoolSettings today="2026-11-05" />
      <MyTimetable today="2026-11-05" />
    </AppProviders>,
  )
  expect(await screen.findByText("먼저 '이번 주 급식·시간표 가져오기'를 하세요.")).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '이번 주 급식·시간표 가져오기' }))
  expect(await screen.findByLabelText('1-1')).toBeInTheDocument()
})

test('설정 탭 옆 점의 뜻을 탭 아래에 알려 준다', async () => {
  const { MemoryRouter } = await import('react-router-dom')
  const { default: SettingsPage } = await import('./SettingsPage')
  const db = createDb('test-' + crypto.randomUUID())
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <SettingsPage />
      </AppProviders>
    </MemoryRouter>,
  )
  expect(await screen.findByText('설정할 것이 남은 메뉴')).toBeInTheDocument()
})
