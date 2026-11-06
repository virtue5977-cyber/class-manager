import { neisRequest, type FetchLike } from './client'

export interface SchoolHit {
  officeCode: string
  officeName: string
  schoolCode: string
  name: string
  kind: string
  address: string
}

interface SchoolRow {
  ATPT_OFCDC_SC_CODE: string
  ATPT_OFCDC_SC_NM: string
  SD_SCHUL_CODE: string
  SCHUL_NM: string
  SCHUL_KND_SC_NM: string
  ORG_RDNMA: string | null
}

export async function searchSchools(name: string, opts: { key: string; fetch?: FetchLike }): Promise<SchoolHit[]> {
  const rows = await neisRequest<SchoolRow>('schoolInfo', { SCHUL_NM: name.trim() }, opts)
  return rows
    .filter((r) => r.SD_SCHUL_CODE?.trim())
    .map((r) => ({
      officeCode: r.ATPT_OFCDC_SC_CODE,
      officeName: r.ATPT_OFCDC_SC_NM,
      schoolCode: r.SD_SCHUL_CODE.trim(),
      name: r.SCHUL_NM,
      kind: r.SCHUL_KND_SC_NM,
      address: r.ORG_RDNMA ?? '',
    }))
}
