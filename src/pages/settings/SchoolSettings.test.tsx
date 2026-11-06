import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb, type AppDB } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { getSettings, setNeisKey, updateSettings } from '../../lib/settings'
import { fakeFetch, neisPage, neisResult } from '../../lib/neis/fixtures'
import type { FetchLike } from '../../lib/neis/client'
import SchoolSettings from './SchoolSettings'

const SCHOOL = { ATPT_OFCDC_SC_CODE: 'B10', ATPT_OFCDC_SC_NM: '서울특별시교육청', SD_SCHUL_CODE: '7130165', SCHUL_NM: '가락중학교', SCHUL_KND_SC_NM: '중학교', ORG_RDNMA: '서울특별시 송파구' }
const sched = (AA_YMD: string, EVENT_NM: string, SBTR_DD_SC_NM: string) => ({ AA_YMD, EVENT_NM, SBTR_DD_SC_NM, ONE_GRADE_EVENT_YN: 'N', TW_GRADE_EVENT_YN: 'N', THREE_GRADE_EVENT_YN: 'N' })

function renderWith(db: AppDB, fetch: FetchLike) {
  return render(
    <AppProviders db={db} fs={createMemoryFsAdapter()} fetch={fetch}>
      <SchoolSettings today="2026-11-05" />
    </AppProviders>,
  )
}

async function readyDb() {
  const db = createDb('test-' + crypto.randomUUID())
  await setNeisKey(db, 'K')
  await updateSettings(db, { school_name: '가락중학교', neis_office_code: 'B10', neis_school_code: '7130165', school_kind: '중학교' })
  return db
}

test('키 저장 후 값은 보이지 않고 "인증키가 저장되어 있습니다."', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  renderWith(db, fakeFetch(() => ({})))
  await user.type(await screen.findByLabelText('NEIS 인증키'), 'my-neis-key')
  await user.click(screen.getByRole('button', { name: '인증키 저장' }))
  expect(await screen.findByText('인증키가 저장되어 있습니다.')).toBeInTheDocument()
  expect(screen.getByLabelText('NEIS 인증키')).toHaveValue('')
  expect(document.body.textContent).not.toContain('my-neis-key')
})

test('학교 검색 → 선택하면 "선택한 학교: 가락중학교"이고 설정에 코드·종류가 저장된다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await setNeisKey(db, 'K')
  renderWith(db, fakeFetch(() => neisPage('schoolInfo', [SCHOOL])))
  await user.type(await screen.findByLabelText('학교 이름'), '가락')
  await user.click(screen.getByRole('button', { name: '검색' }))
  await user.click(await screen.findByRole('button', { name: '가락중학교 선택' }))
  expect(await screen.findByText('선택한 학교: 가락중학교')).toBeInTheDocument()
  expect(await getSettings(db)).toMatchObject({ school_name: '가락중학교', neis_office_code: 'B10', neis_school_code: '7130165', school_kind: '중학교' })
})

test('학사일정 가져오기 → 건수 문구와 다가오는 일정 미리보기(휴업 표시)', async () => {
  const user = userEvent.setup()
  const db = await readyDb()
  renderWith(db, fakeFetch(() => neisPage('SchoolSchedule', [sched('20261110', '체육대회', '해당없음'), sched('20261111', '개교기념일', '휴업일'), sched('20261001', '지난 행사', '해당없음')])))
  await user.click(await screen.findByRole('button', { name: /학사일정 가져오기/ }))
  expect(await screen.findByText('학사일정 3건을 가져왔습니다.')).toBeInTheDocument()
  expect(screen.getByText('11/10 체육대회')).toBeInTheDocument()
  expect(screen.getByText('11/11 개교기념일 (휴업)')).toBeInTheDocument()
  expect(screen.queryByText(/지난 행사/)).not.toBeInTheDocument()
})

test('키 오류면 "NEIS 인증키가 올바르지 않습니다."', async () => {
  const user = userEvent.setup()
  renderWith(await readyDb(), fakeFetch(() => neisResult('ERROR-290', 'x')))
  await user.click(await screen.findByRole('button', { name: /학사일정 가져오기/ }))
  expect(await screen.findByText('NEIS 인증키가 올바르지 않습니다.')).toBeInTheDocument()
})

test('오프라인(fetch 실패)이면 연결 오류 문구, 이전 미리보기는 유지', async () => {
  const user = userEvent.setup()
  const db = await readyDb()
  let online = true
  const f: FetchLike = async (url) => {
    if (!online) throw new TypeError('offline')
    return fakeFetch(() => neisPage('SchoolSchedule', [sched('20261110', '체육대회', '해당없음')]))(url)
  }
  renderWith(db, f)
  await user.click(await screen.findByRole('button', { name: /학사일정 가져오기/ }))
  await screen.findByText('11/10 체육대회')
  online = false
  await user.click(screen.getByRole('button', { name: /학사일정 가져오기/ }))
  expect(await screen.findByText('NEIS에 연결하지 못했습니다. 인터넷 연결을 확인하세요.')).toBeInTheDocument()
  expect(screen.getByText('11/10 체육대회')).toBeInTheDocument()
})

test('이번 주 급식·시간표 가져오기 → 끼니·칸 수 문구', async () => {
  const user = userEvent.setup()
  const db = await readyDb()
  renderWith(db, fakeFetch((u) => u.pathname.endsWith('mealServiceDietInfo')
    ? neisPage('mealServiceDietInfo', [{ MLSV_YMD: '20261102', MMEAL_SC_NM: '중식', DDISH_NM: '밥', CAL_INFO: '' }])
    : neisPage('misTimetable', [{ ALL_TI_YMD: '20261102', GRADE: '1', CLASS_NM: '1', PERIO: '1', ITRT_CNTNT: '수학' }, { ALL_TI_YMD: '20261102', GRADE: '1', CLASS_NM: '1', PERIO: '2', ITRT_CNTNT: '과학' }])))
  await user.click(await screen.findByRole('button', { name: '이번 주 급식·시간표 가져오기' }))
  await waitFor(() => expect(screen.getByText('급식 1끼, 시간표 2칸을 가져왔습니다.')).toBeInTheDocument())
})
