// @vitest-environment node
import { createDb } from '../../db/schema'
import { buildHwpx } from '../package'
import { paragraphXml } from '../xml'
import { ABSENCE_PLACEHOLDERS } from './build'
import {
  inspectTemplate, installTemplate, listTemplates, activateTemplate, useDefaultTemplate, getActiveTemplate,
  defaultTemplateBytes, buildPlaceholderGuideHwpx,
} from './template'
import { unzipText, xmlErrors } from '../testUtil'

const testDb = () => createDb('test-' + crypto.randomUUID())
const formWith = (text: string) => buildHwpx({ landscape: false, bodyXml: paragraphXml(text, { charPr: 0 }), charPrXml: [], previewText: text, title: '양식' })

test('기본 양식은 통과하고 표시를 30개 이상 찾는다', async () => {
  const r = await inspectTemplate(await defaultTemplateBytes())
  expect(r.ok).toBe(true)
  expect(r.found.length).toBeGreaterThanOrEqual(30)
  expect(r.unknown).toEqual([])
})

test('알 수 없는 표시 {{이룸}}은 unknown, 그래도 {{학번}}이 있으면 통과', async () => {
  const r = await inspectTemplate(await formWith('{{학번}} {{이룸}} {{결석_질병}}'))
  expect(r).toMatchObject({ ok: true, unknown: ['이룸'] })
  expect(r.found).toEqual(['학번', '결석_질병'])
})

test('{{이름}}·{{학번}}이 모두 없으면 거부', async () => {
  const r = await inspectTemplate(await formWith('{{결석_질병}}'))
  expect(r).toMatchObject({ ok: false, error: '양식에 {{이름}} 또는 {{학번}} 표시가 없습니다.' })
})

test('zip이 아니면 거부', async () => {
  expect(await inspectTemplate(new Uint8Array([1, 2, 3]))).toMatchObject({ ok: false, error: 'hwpx 파일이 아닙니다.' })
})

test('설치하면 버전이 1→2로 늘고 활성은 하나, 실패하면 저장하지 않는다', async () => {
  const db = testDb()
  expect((await installTemplate(db, '우리학교', await formWith('{{이름}}'))).ok).toBe(true)
  expect((await installTemplate(db, '우리학교', await formWith('{{학번}}'))).ok).toBe(true)
  expect((await installTemplate(db, '깨진', await formWith('없음'))).ok).toBe(false)
  const list = await listTemplates(db)
  expect(list.map((t) => `${t.version}:${t.active}`)).toEqual(['2:true', '1:false'])
  expect((await getActiveTemplate(db)).label).toBe('우리학교 v2')
})

test('이전 버전 활성화와 기본 양식으로 되돌리기', async () => {
  const db = testDb()
  await installTemplate(db, 'A', await formWith('{{이름}}'))
  await installTemplate(db, 'A', await formWith('{{학번}}'))
  const v1 = (await listTemplates(db)).find((t) => t.version === 1)!
  await activateTemplate(db, v1.id)
  expect((await getActiveTemplate(db)).label).toBe('A v1')
  await useDefaultTemplate(db)
  expect((await getActiveTemplate(db)).label).toBe('기본 양식')
})

test('자리표시자 안내 hwpx: 모든 표시가 들어 있고 XML 오류 0', async () => {
  const files = await unzipText(await buildPlaceholderGuideHwpx())
  expect(xmlErrors(files['Contents/section0.xml'])).toEqual([])
  for (const p of ABSENCE_PLACEHOLDERS) expect(files['Contents/section0.xml']).toContain(`{{${p.name}}}`)
})
