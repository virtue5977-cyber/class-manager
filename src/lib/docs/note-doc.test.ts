import type { NoteBlock } from '../db/types'
import { unzipText, xmlErrors } from '../hwpx/testUtil'
import { buildNoteHwpx } from './note-doc'

const blocks: NoteBlock[] = [
  { id: '1', type: 'h1', text: '안내' },
  { id: '2', type: 'p', text: '굵게 기울 밑줄 빨강 바탕', marks: [{ b: true, from: 0, to: 2 }, { i: true, from: 3, to: 5 }, { u: true, from: 6, to: 8 }, { color: '#c0392b', bg: '#fff59d', from: 9, to: 11 }, { font: '궁서', from: 12, to: 14 }] },
  { id: '3', type: 'number', text: '하나' },
  { id: '4', type: 'number', text: '둘', indent: 1 },
  { id: '5', type: 'check', text: '완료', checked: true },
  { id: '6', type: 'roster', text: '제출', rows: [{ sid: 'a', label: '1번 가상일', checked: true }] },
]

test('노트 hwpx: XML이 바르고, 서식이 글자 모양으로, 새 글꼴·들여쓰기 문단 모양이 header에', async () => {
  const f = await unzipText(await buildNoteHwpx({ title: '회의', blocks }))
  const h = f['Contents/header.xml']
  const sec = f['Contents/section0.xml']
  expect(xmlErrors(h)).toEqual([])
  expect(xmlErrors(sec)).toEqual([])
  expect(h).toMatch(/<hh:fontface lang="HANGUL" fontCnt="6">[\s\S]*face="궁서"/)
  expect(h).toContain('textColor="#c0392b" shadeColor="#fff59d"')
  expect(h).toContain('<hh:underline type="BOTTOM" shape="SOLID" color="#000000"/>')
  expect(h).toContain('<hh:italic/>')
  expect(h).toContain('<hh:strikeout shape="SOLID" color="#000000"/>')
  expect(h).toMatch(/<hh:paraProperties itemCnt="18"/)
  expect(h).toContain('<hc:left value="2000" unit="HWPUNIT"/>')
  for (const t of ['회의', '안내', '굵게', '1. ', '가. ', '☑ ', '1번 가상일', '✔']) expect(sec).toContain(t)
  expect(sec).toContain('<hp:tbl')
  // charPr 개수 = itemCnt
  const cnt = Number(/<hh:charProperties itemCnt="(\d+)"/.exec(h)![1])
  expect(h.match(/<hh:charPr id=/g)).toHaveLength(cnt)
})
