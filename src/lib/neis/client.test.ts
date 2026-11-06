// @vitest-environment node
import { neisRequest, NeisError } from './client'
import { searchSchools } from './school'
import { fakeFetch, neisPage, neisResult, pagedHandler } from './fixtures'

test('URL에 Type=json, pSize=1000, KEY, 인자가 들어간다', async () => {
  const f = fakeFetch(() => neisPage('SchoolSchedule', [{ a: 1 }]))
  await neisRequest('SchoolSchedule', { SD_SCHUL_CODE: '7130165' }, { key: 'K1', fetch: f })
  const u = f.calls[0]
  expect(u.origin + u.pathname).toBe('https://open.neis.go.kr/hub/SchoolSchedule')
  expect(Object.fromEntries(u.searchParams)).toEqual({ Type: 'json', pIndex: '1', pSize: '1000', KEY: 'K1', SD_SCHUL_CODE: '7130165' })
})

test('list_total_count 2300이면 pIndex 1·2·3을 받아 2300건을 합친다', async () => {
  const rows = Array.from({ length: 2300 }, (_, i) => ({ i }))
  const f = fakeFetch(pagedHandler('misTimetable', rows))
  const out = await neisRequest<{ i: number }>('misTimetable', {}, { key: 'K', fetch: f })
  expect(out).toHaveLength(2300)
  expect(out[2299].i).toBe(2299)
  expect(f.calls.map((u) => u.searchParams.get('pIndex'))).toEqual(['1', '2', '3'])
})

test('INFO-200이면 빈 배열', async () => {
  const f = fakeFetch(() => neisResult('INFO-200', '해당하는 데이터가 없습니다.'))
  expect(await neisRequest('mealServiceDietInfo', {}, { key: 'K', fetch: f })).toEqual([])
})

test('ERROR-290이면 "NEIS 인증키가 올바르지 않습니다."', async () => {
  const f = fakeFetch(() => neisResult('ERROR-290', '인증키가 유효하지 않습니다.'))
  await expect(neisRequest('schoolInfo', {}, { key: 'bad', fetch: f })).rejects.toThrow('NEIS 인증키가 올바르지 않습니다.')
})

test('그 밖의 ERROR는 메시지를 붙인다', async () => {
  const f = fakeFetch(() => neisResult('ERROR-300', '필수 값이 누락되어 있습니다.'))
  const e = await neisRequest('schoolInfo', {}, { key: 'K', fetch: f }).catch((x) => x)
  expect(e).toBeInstanceOf(NeisError)
  expect(e.message).toBe('NEIS 요청 오류: 필수 값이 누락되어 있습니다.')
  expect(e.code).toBe('ERROR-300')
})

test('fetch가 throw하면 연결 오류 문구, 메시지에 키가 없다', async () => {
  const f = async () => { throw new TypeError('Failed to fetch https://open.neis.go.kr/hub/x?KEY=secret-key') }
  const e = await neisRequest('schoolInfo', {}, { key: 'secret-key', fetch: f }).catch((x) => x)
  expect(e.message).toBe('NEIS에 연결하지 못했습니다. 인터넷 연결을 확인하세요.')
  expect(e.message).not.toContain('secret-key')
})

test('키가 비면 요청하지 않고 "NEIS 인증키를 먼저 입력하세요."', async () => {
  const f = fakeFetch(() => neisPage('x', []))
  await expect(neisRequest('schoolInfo', {}, { key: '  ', fetch: f })).rejects.toThrow('NEIS 인증키를 먼저 입력하세요.')
  expect(f.calls).toHaveLength(0)
})

test('searchSchools는 학교 코드가 빈 행을 뺀다', async () => {
  const f = fakeFetch(() =>
    neisPage('schoolInfo', [
      { ATPT_OFCDC_SC_CODE: 'B10', ATPT_OFCDC_SC_NM: '서울특별시교육청', SD_SCHUL_CODE: '       ', SCHUL_NM: '(가칭)서울산빛초등학교', SCHUL_KND_SC_NM: '초등학교', ORG_RDNMA: '서울' },
      { ATPT_OFCDC_SC_CODE: 'B10', ATPT_OFCDC_SC_NM: '서울특별시교육청', SD_SCHUL_CODE: '7130165', SCHUL_NM: '가락중학교', SCHUL_KND_SC_NM: '중학교', ORG_RDNMA: '서울특별시 송파구' },
    ]),
  )
  const hits = await searchSchools('가락', { key: 'K', fetch: f })
  expect(hits).toEqual([{ officeCode: 'B10', officeName: '서울특별시교육청', schoolCode: '7130165', name: '가락중학교', kind: '중학교', address: '서울특별시 송파구' }])
  expect(f.calls[0].searchParams.get('SCHUL_NM')).toBe('가락')
})
