import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { edition } from '../lib/update/update'
import HtmlEndBanner from './HtmlEndBanner'

afterEach(() => void (edition.single = false))

test('HTML판(단일 파일)이면 종료 안내와 옮기는 방법이 늘 보인다', () => {
  edition.single = true
  render(<MemoryRouter><HtmlEndBanner /></MemoryRouter>)
  expect(screen.getByRole('status')).toHaveTextContent('HTML판은 0.17로 끝납니다')
  expect(screen.getByRole('link', { name: '백업 파일 내려받기' })).toHaveAttribute('href', '/settings?tab=backup')
})

test('설치형·웹 빌드에서는 보이지 않는다', () => {
  render(<MemoryRouter><HtmlEndBanner /></MemoryRouter>)
  expect(screen.queryByRole('status')).toBeNull()
})
