import { DOMParser } from '@xmldom/xmldom'
import JSZip from 'jszip'

/** XML 파싱 오류·경고 메시지 목록(테스트용). */
export function xmlErrors(xml: string): string[] {
  const errs: string[] = []
  new DOMParser({
    onError: (level: string, msg: string) => {
      if (level !== 'warn' && level !== 'warning') errs.push(msg)
    },
  } as never).parseFromString(xml, 'text/xml')
  return errs
}

export async function unzipText(bytes: Uint8Array): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes)
  const out: Record<string, string> = {}
  for (const [name, f] of Object.entries(zip.files)) if (!f.dir) out[name] = await f.async('string')
  return out
}
