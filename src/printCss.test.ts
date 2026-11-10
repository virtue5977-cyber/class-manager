import { readFileSync } from 'node:fs'

const css = readFileSync('src/styles.css', 'utf8')

test('인쇄에서 화면 전체를 숨기는 규칙은 .print-area가 있는 화면에만 걸린다(없으면 PDF가 빈 장)', () => {
  const hideAll = [...css.matchAll(/([^{}]*)\{\s*visibility:\s*hidden;?\s*\}/g)].map((m) => m[1].trim()).filter((sel) => /\bbody\b/.test(sel))
  expect(hideAll.length).toBeGreaterThan(0)
  for (const sel of hideAll) expect(sel).toMatch(/:has\(\.print-area\)/)
})
