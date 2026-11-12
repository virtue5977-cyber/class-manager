import 'fake-indexeddb/auto'
import { createDb } from '../db/schema'
import { createClass, emptyStudent, saveStudent } from '../roster/roster'
import { saveAttendance } from '../attendance/attendance'
import { appContext } from './skillRun'

test('앱 자료: 이번 달·학기·올해 출결을 종류마다 학생과 건수로', async () => {
  const db = createDb('t-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const a = await saveStudent(db, c.id, emptyStudent(3, '박도윤'))
  const b = await saveStudent(db, c.id, emptyStudent(7, '이서연'))
  const put = (sid: string, date: string, category: '질병' | '미인정') => saveAttendance(db, { student_id: sid, date, kind: '결석', category, reason: '' } as never)
  await put(a.id, '2026-11-03', '질병')
  await put(a.id, '2026-11-04', '질병')
  await put(b.id, '2026-11-05', '미인정')
  await put(b.id, '2026-09-10', '질병')
  await put(a.id, '2026-04-10', '질병')
  const t = await appContext({ db, today: '2026-11-12', classId: c.id, navigate: () => {}, download: () => {} } as never)
  expect(t).toContain('## 이번 달 출결(11월)\n- 결석(질병): 3번 박도윤 2건\n- 결석(미인정): 7번 이서연 1건')
  expect(t).toContain('## 2학기 출결\n- 결석(질병): 3번 박도윤 2건, 7번 이서연 1건\n- 결석(미인정): 7번 이서연 1건')
  expect(t).toContain('## 올해(2026학년도) 출결\n- 결석(질병): 3번 박도윤 3건, 7번 이서연 1건')
})
