import { createDb } from '../db/schema'
import { listGoodTexts, listPhrases, listReflections, saveReflection, starPhrase, unstarPhrase, DEFAULT_LINES } from './store'
import { mergeWrite } from '../vault/middleware'
import { newerWins } from '../vault/merge'

test('모음은 처음에 기본 16문장, 별표 추가; 반성문 저장', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  expect(DEFAULT_LINES).toHaveLength(16)
  expect((await listPhrases(db)).length).toBe(16)
  await starPhrase(db, '새 문장')
  expect((await listPhrases(db)).length).toBe(17)
  await starPhrase(db, '새 문장')
  expect((await listPhrases(db)).length).toBe(17)
  await saveReflection(db, { student_id: 's', date: '2026-11-10', reason: '지각', lines: DEFAULT_LINES, t1: 'a', t2: 'b', mode: 'B4' })
  expect((await listReflections(db, 's')).length).toBe(1)
})

test('기본 문장 모음은 다른 기기에서 복원해도 겹치지 않는다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await listPhrases(db)
  await db.device_local.delete('reflectionPhrasesSeeded')
  expect((await listPhrases(db)).length).toBe(16)
})

test('좋은 글 모음: 16줄 전체를 이름과 저장·불러오기·이름 고치기·지우기, 처음엔 기본 글 하나, 이름 번호는 이어서', async () => {
  const { listGoodTexts, readGoodTexts, saveGoodText, renameGoodText, deleteGoodText, nextGoodTitle } = await import('./store')
  const db = createDb('test-' + crypto.randomUUID())
  const first = await listGoodTexts(db)
  expect(first.map((g) => g.title)).toEqual(['기본 반성문(1)'])
  expect(first[0].lines).toEqual(DEFAULT_LINES)
  const lines = Array.from({ length: 16 }, (_, i) => `학교폭력 ${i + 1}`)
  expect(nextGoodTitle(first, '학교폭력')).toBe('학교폭력 관련(1)')
  const g = await saveGoodText(db, '학교폭력 관련(1)', lines)
  expect(nextGoodTitle(await readGoodTexts(db), '학교폭력')).toBe('학교폭력 관련(2)')
  await renameGoodText(db, g.id, '학교폭력 관련(가)')
  const all = await readGoodTexts(db)
  expect(all[0]).toMatchObject({ title: '학교폭력 관련(가)', lines })
  await deleteGoodText(db, g.id)
  expect((await readGoodTexts(db)).map((x) => x.title)).toEqual(['기본 반성문(1)'])
  expect((await readGoodTexts(db)).every((x) => x.lines?.length === 16)).toBe(true)
})

test('기본 글은 1970 도장, 사용자가 고친 updated_at은 유지', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const ps = await listPhrases(db)
  expect(ps.length).toBe(16)
  expect(ps.every((p) => p.created_at === '1970-01-01T00:00:00.000Z' && p.updated_at === '1970-01-01T00:00:00.000Z')).toBe(true)
  const edited = { ...(await db.reflection_phrases.get('phrase-default-3'))!, text: '고침', updated_at: '2026-11-01T00:00:00.000Z' }
  await db.reflection_phrases.put(edited)
  await listPhrases(db)
  expect((await db.reflection_phrases.get('phrase-default-3'))!.text).toBe('고침')
})

test('지운 기본 글 vs 다른 DB의 1970 기본 글 → 지운 쪽 이김', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await listPhrases(db)
  await unstarPhrase(db, 'phrase-default-2')
  const mine = (await db.reflection_phrases.get('phrase-default-2'))!
  const other = { ...mine, deleted: false, updated_at: '1970-01-01T00:00:00.000Z' }
  expect(newerWins(other, mine)).toBe(mine)
  expect(newerWins(mine, other).deleted).toBe(true)
})

test('기본 글: 시작 시각 고정(두 DB 같음), 기본 반성문도 1970 도장·고친 도장 유지', async () => {
  const a = createDb('test-' + crypto.randomUUID())
  const b = createDb('test-' + crypto.randomUUID())
  const pa = (await listPhrases(a)).map((p) => [p.id, p.starred_at]).sort()
  const pb = (await listPhrases(b)).map((p) => [p.id, p.starred_at]).sort()
  expect(pa).toEqual(pb)
  const [g] = await listGoodTexts(a)
  expect(g.id).toBe('goodtext-default-0')
  expect(g.created_at).toBe('1970-01-01T00:00:00.000Z')
  expect(g.updated_at).toBe('1970-01-01T00:00:00.000Z')
  await mergeWrite(a, [a.reflection_phrases], () => a.reflection_phrases.put({ ...g, title: '내 글', updated_at: '2026-11-01T00:00:00.000Z' }))
  await listGoodTexts(a)
  const after = (await a.reflection_phrases.get('goodtext-default-0'))!
  expect([after.title, after.updated_at]).toEqual(['내 글', '2026-11-01T00:00:00.000Z'])
})
