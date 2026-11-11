import { screen } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

/** '내보내기 ▾'(또는 아이콘 '내보내기')를 열고 형식(한글(hwpx)·엑셀(xlsx)·PDF)을 고른다. */
export async function pickExport(user: UserEvent, format: '한글(hwpx)' | '엑셀(xlsx)' | 'PDF') {
  await user.click(screen.getByRole('button', { name: /^내보내기/ }))
  await user.click(screen.getByRole('menuitem', { name: format }))
}
