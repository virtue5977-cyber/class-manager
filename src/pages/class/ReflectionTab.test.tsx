import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent } from '../../lib/roster/roster'
import { updateSettings } from '../../lib/settings'
import { listReflections } from '../../lib/reflection/store'
import { pickExport } from '../../test/exportMenu'
import ReflectionTab from './ReflectionTab'

async function setup(ai?: () => Promise<string>, path = '/class/reflection') {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(3, '박도윤'))
  const fs = createMemoryFsAdapter()
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders db={db} fs={fs} ai={ai}>
        <ReflectionTab classRec={c} today="2026-11-10" />
      </AppProviders>
    </MemoryRouter>,
  )
  return { db, c, s, fs }
}

test('학생을 고르면 날짜·학번·이름이 양식에 들어가고, 저장하면 목록에 생긴다', async () => {
  const user = userEvent.setup()
  const { db, s } = await setup()
  await user.click(await screen.findByRole('button', { name: '3번 박도윤' }))
  const paper = screen.getByRole('region', { name: '반성문 양식' })
  expect(within(paper).getByText('2026.11.10.')).toBeInTheDocument()
  expect(within(paper).getByText('10503')).toBeInTheDocument()
  expect(within(paper).getByText('박도윤')).toBeInTheDocument()
  expect(within(paper).getAllByRole('textbox', { name: /^\d+번 줄$/ })).toHaveLength(16)
  await user.type(screen.getByLabelText('사유'), '수업 중 휴대폰')
  await user.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(async () => expect((await listReflections(db, s.id)).map((r) => r.reason)).toEqual(['수업 중 휴대폰']))
  expect(await screen.findByRole('list', { name: '지난 반성문' })).toHaveTextContent('11/10')
})

test('넘치는 줄은 표시되고, 붙여 넣은 글은 16줄로 나뉜다', async () => {
  const user = userEvent.setup()
  await setup(undefined, '/class/reflection')
  const line1 = await screen.findByRole('textbox', { name: '1번 줄' })
  await user.clear(line1)
  await user.type(line1, '가'.repeat(130))
  expect(line1).toHaveAttribute('aria-invalid', 'true')
  await user.type(screen.getByLabelText('붙여 넣을 글'), '첫째 문장입니다. 둘째 문장입니다.')
  await user.click(screen.getByRole('button', { name: '16줄로 나누기' }))
  expect(screen.getByRole('textbox', { name: '1번 줄' })).toHaveValue('첫째 문장입니다.')
  expect(screen.getByRole('textbox', { name: '2번 줄' })).toHaveValue('둘째 문장입니다.')
  expect(screen.getByRole('textbox', { name: '3번 줄' })).toHaveValue('')
})

test('AI로 16줄 채우기 · 한글로 내보내기', async () => {
  const user = userEvent.setup()
  const lines = Array.from({ length: 16 }, (_, i) => `AI 문장 ${i + 1}입니다.`)
  const { db, fs } = await setup(async () => JSON.stringify({ lines }))
  await updateSettings(db, { ai_enabled: true })
  await user.click(await screen.findByRole('button', { name: '3번 박도윤' }))
  await user.type(screen.getByLabelText('사유'), '지각')
  await user.click(screen.getByRole('button', { name: 'AI로 16줄 채우기' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '16번 줄' })).toHaveValue('AI 문장 16입니다.'))
  await pickExport(user, '한글(hwpx)')
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['반성문_박도윤_2026-11-10.hwpx']))
})

test('좋은 문장 모음에서 고른 줄에 넣기', async () => {
  const user = userEvent.setup()
  await setup()
  const line3 = await screen.findByRole('textbox', { name: '3번 줄' })
  await user.clear(line3)
  await user.click(screen.getByRole('tab', { name: '좋은 문장 모음' }))
  const box = await screen.findByRole('list', { name: '좋은 문장' })
  await waitFor(() => expect(within(box).getAllByRole('button', { name: '넣기' }).length).toBeGreaterThanOrEqual(16))
  await user.click(within(box).getAllByRole('button', { name: '넣기' })[0])
  expect((screen.getByRole('textbox', { name: '3번 줄' }) as HTMLInputElement).value).not.toBe('')
})

test('A4를 고르면 한글 파일도 A4 쪽 크기', async () => {
  const JSZip = (await import('jszip')).default
  const { MODES } = await import('../../lib/reflection/fit')
  const user = userEvent.setup()
  const { fs } = await setup()
  await user.click(await screen.findByRole('radio', { name: 'A4' }))
  await pickExport(user, '한글(hwpx)')
  await waitFor(() => expect(fs.downloads).toHaveLength(1))
  const sec = await (await JSZip.loadAsync(fs.downloads[0].bytes)).file('Contents/section0.xml')!.async('string')
  expect(sec).toContain(`width="${MODES.A4.pageW}" height="${MODES.A4.pageH}"`)
})

test('반성문 지시문을 화면에서 고치고 기본으로 되돌린다', async () => {
  const { getPrompt, DEFAULT_PROMPTS } = await import('../../lib/ai/prompts')
  const user = userEvent.setup()
  const { db } = await setup()
  await user.click(await screen.findByText('AI 지시문 고치기'))
  const box = await screen.findByLabelText('반성문 AI 지시문')
  await waitFor(() => expect(box).toHaveValue(DEFAULT_PROMPTS.reflection))
  await user.clear(box)
  await user.type(box, '짧게 써')
  await user.click(screen.getByRole('button', { name: '지시문 저장' }))
  await waitFor(async () => expect(await getPrompt(db, 'reflection')).toBe('짧게 써'))
  await user.click(screen.getByRole('button', { name: '기본으로 되돌리기' }))
  await waitFor(async () => expect(await getPrompt(db, 'reflection')).toBe(DEFAULT_PROMPTS.reflection))
  expect(screen.getByLabelText('반성문 AI 지시문')).toHaveValue(DEFAULT_PROMPTS.reflection)
})

test('저장하지 않고 다른 학생을 누르면 먼저 묻는다', async () => {
  const user = userEvent.setup()
  const { db, c } = await setup()
  await saveStudent(db, c.id, emptyStudent(4, '최하은'))
  await user.click(await screen.findByRole('button', { name: '3번 박도윤' }))
  await user.type(screen.getByLabelText('사유'), '지각')
  await user.click(await screen.findByRole('button', { name: '4번 최하은' }))
  expect(screen.getByRole('alertdialog', { name: '저장하지 않은 반성문' })).toBeInTheDocument()
  expect(screen.getByLabelText('사유')).toHaveValue('지각')
  await user.click(screen.getByRole('button', { name: '버리고 바꾸기' }))
  expect(screen.getByLabelText('사유')).toHaveValue('')
})
