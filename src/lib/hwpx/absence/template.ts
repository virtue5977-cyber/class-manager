import type { AppDB } from '../../db/schema'
import b64 from './default-template.b64'

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function defaultTemplateBytes(): Promise<Uint8Array> {
  return fromB64(b64)
}

/** 활성 양식(설정에서 올린 것), 없으면 기본 양식 */
export async function getActiveTemplate(db: AppDB): Promise<{ bytes: Uint8Array; label: string }> {
  const active = (await db.hwpx_templates.toArray()).filter((t) => !t.deleted && t.active).sort((a, b) => b.version - a.version)[0]
  return active ? { bytes: active.data, label: `${active.name} v${active.version}` } : { bytes: await defaultTemplateBytes(), label: '기본 양식' }
}

import JSZip from 'jszip'
import { newRecord } from '../../db/records'
import { findPlaceholders, joinSplitPlaceholders } from '../placeholder'
import { ABSENCE_PLACEHOLDERS } from './build'
import { buildHwpx } from '../package'
import { CharPrRegistry } from '../charPr'
import { paragraphXml, tableXml, PARA_CENTER, PARA_JUSTIFY } from '../xml'
import type { HwpxTemplateRec } from '../../db/types'

export interface TemplateInspection {
  ok: boolean
  found: string[]
  unknown: string[]
  error?: string
}

/** 올린 양식의 자리표시자를 검사한다. {{이름}}·{{학번}} 중 하나는 있어야 한다. */
export async function inspectTemplate(bytes: Uint8Array): Promise<TemplateInspection> {
  let section: string
  try {
    const zip = await JSZip.loadAsync(bytes)
    const f = zip.file('Contents/section0.xml')
    if (!f) throw new Error()
    section = await f.async('string')
  } catch {
    return { ok: false, found: [], unknown: [], error: 'hwpx 파일이 아닙니다.' }
  }
  const known = new Set(ABSENCE_PLACEHOLDERS.map((p) => p.name))
  const all = findPlaceholders(joinSplitPlaceholders(section))
  const found = all.filter((n) => known.has(n))
  const unknown = all.filter((n) => !known.has(n))
  if (!found.includes('이름') && !found.includes('학번')) {
    return { ok: false, found, unknown, error: '양식에 {{이름}} 또는 {{학번}} 표시가 없습니다.' }
  }
  return { ok: true, found, unknown }
}

export async function listTemplates(db: AppDB): Promise<HwpxTemplateRec[]> {
  return (await db.hwpx_templates.toArray()).filter((t) => !t.deleted).sort((a, b) => b.version - a.version)
}

/** 통과하면 새 버전으로 저장하고 활성화한다. 실패하면 아무것도 저장하지 않는다. */
export async function installTemplate(db: AppDB, name: string, bytes: Uint8Array): Promise<TemplateInspection> {
  const r = await inspectTemplate(bytes)
  if (!r.ok) return r
  await db.transaction('rw', db.hwpx_templates, async () => {
    const all = await listTemplates(db)
    const version = (all[0]?.version ?? 0) + 1
    for (const t of all) if (t.active) await db.hwpx_templates.put({ ...t, active: false, updated_at: new Date().toISOString() })
    await db.hwpx_templates.add(newRecord({ name: name.trim() || '올린 양식', version, data: bytes, active: true }))
  })
  return r
}

export async function activateTemplate(db: AppDB, id: string): Promise<void> {
  await db.transaction('rw', db.hwpx_templates, async () => {
    const ts = new Date().toISOString()
    for (const t of await listTemplates(db)) if (t.active !== (t.id === id)) await db.hwpx_templates.put({ ...t, active: t.id === id, updated_at: ts })
  })
}

/** 올린 양식을 모두 비활성화해 기본 양식을 쓴다. */
export async function useDefaultTemplate(db: AppDB): Promise<void> {
  await activateTemplate(db, '')
}

/** "표시 | 들어가는 내용" 안내 문서 */
export async function buildPlaceholderGuideHwpx(): Promise<Uint8Array> {
  const cp = new CharPrRegistry()
  const title = cp.id(16, true)
  const head = cp.id(10, true)
  const body = cp.id(10)
  const rows = [
    [{ text: '표시', charPr: head }, { text: '들어가는 내용', charPr: head }],
    ...ABSENCE_PLACEHOLDERS.map((p) => [
      { text: `{{${p.name}}}`, charPr: body },
      { text: p.description, charPr: body, paraPr: PARA_JUSTIFY },
    ]),
  ]
  const xml =
    paragraphXml('결석신고서 자리표시자 안내', { charPr: title, paraPr: PARA_CENTER }) +
    paragraphXml('한글에서 학교 양식의 해당 자리에 아래 표시를 그대로 입력해 저장한 뒤 앱 설정에서 올리세요. 표시 하나는 글꼴을 바꾸지 말고 한 번에 입력하세요.', { charPr: body }) +
    tableXml({ rows, colWidths: [16000, 35026], rowHeights: rows.map(() => 1600), repeatHeader: true })
  return buildHwpx({ landscape: false, bodyXml: xml, charPrXml: cp.xml(), previewText: '결석신고서 자리표시자 안내', title: '결석신고서 자리표시자 안내' })
}
