// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 누르는 곳·표시에는 선 아이콘(Icon)을 쓴다. 메뉴 ▾와 문장 속 →, 내보낸 글의 ☐☑만 글자로 둔다. */
const BANNED = /[📄📎📁🎙⚠⋯◀▶▲▼✕⇤⇥▸✓←↑↓]/u

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') && !p.includes('.test.') ? [p] : []
  })
}

test('화면 코드에 이모지·글자 기호 아이콘이 없다', () => {
  const hits: string[] = []
  for (const f of walk('src')) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const t = l.trim()
      if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('{/*')) return
      // 단축키 안내 글(↑↓로 고르고 Enter)은 키 이름이라 그대로
      const scrub = l.replace(/↑↓(로 고르고| 고르기)/g, '')
      if (BANNED.test(scrub)) hits.push(`${f}:${i + 1}: ${t.slice(0, 80)}`)
    })
  }
  expect(hits).toEqual([])
})
