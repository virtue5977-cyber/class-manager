
test('누가기록 머리줄: 일자 → 시각 → 장소 → (상담) 대상·방법, 빈 것은 뺀다', async () => {
  const { nugaHead } = await import('./counseling')
  expect(nugaHead({ date: '2026-11-05', time: '12:40', place: '교실', target: '보호자', method: '전화' })).toBe('2026.11.05.(목) 12:40 | 교실 | 보호자·전화')
  expect(nugaHead({ date: '2026-11-05', place: '', kind: '관찰', target: '학생', method: '대면' })).toBe('2026.11.05.(목)')
  expect(nugaHead({ date: '2026-11-05', time: '', place: '복도', kind: '관찰' })).toBe('2026.11.05.(목) | 복도')
})

test('관찰 기록은 대상·방법을 비우고 종류를 남긴다, 학급 전체 목록은 최근 먼저', async () => {
  const { createDb } = await import('../db/schema')
  const { saveLog, listAllLogs } = await import('./counseling')
  const db = createDb('t-' + crypto.randomUUID())
  await saveLog(db, { student_id: 'a', date: '2026-11-01', place: '', content: '상담' })
  const o = await saveLog(db, { student_id: 'b', date: '2026-11-03', place: '복도', content: '친구를 도움', kind: '관찰' })
  expect(o).toMatchObject({ kind: '관찰', target: '', method: '' })
  expect((await listAllLogs(db, ['a', 'b'])).map((l) => l.content)).toEqual(['친구를 도움', '상담'])
})
