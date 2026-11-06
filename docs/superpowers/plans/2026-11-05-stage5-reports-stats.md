# 5단계(+7단계 통합): 결석신고서 목록·제출 체크 + 출결 통계

사용자 요청: 마지막 단계까지 완성본을 빠르게 낸 뒤 디자인 검토. 5단계와 7단계는 둘 다 "목록·집계 화면"이라 한 브랜치로 묶는다.

## Task 1 — 범용 표 hwpx (`src/lib/docs/table-doc.ts`)
- `buildTableHwpx({ title, header, rows, colWidths?(비율), landscape?, fontSizePt? })` → Uint8Array.
- 폭은 A4 본문 폭(세로 51026, 가로 72000 기준)에 비율로 나눔. 머리글 굵게·반복.
- 테스트: XML 오류 0, 행·열 수, mimetype 첫 항목.

## Task 2 — 신고서 월 목록 (`src/lib/absenceReports/list.ts`)
- `listReportsForMonth(db, classId, ym)`: 해당 월과 기간이 겹치는 신고서 + 학생, 번호→시작일 순.
- `setSubmittedMany(db, ids, on)`: 트랜잭션, submitted_at 갱신.
- 테스트: 월 경계(10/30~11/2는 10월·11월 둘 다), 다른 학급 제외, 일괄 제출.

## Task 3 — 결석신고서 화면 (`src/pages/reports/ReportsPage.tsx`, 경로 `/reports`)
- 학급·월 선택(기본 이번 달), "미제출만" 필터.
- 표: 선택 체크, 번호 이름, 기간(periodText), 수업일, 증빙, 진단서(필요/수령), 제출, 다시 봄 표시.
- 진단서 수령·제출 칸 바로 체크(updateReport), 선택 건 "제출로 표시"/"미제출로 표시", "hwpx 한 파일"/"학생별 zip", 학생 성명 인쇄 체크.
- 요약: 전체 N건 · 미제출 N건 · 진단서 미수령 N건.

## Task 4 — 통계 (`src/lib/stats.ts`)
- `computeAttendanceStats(atts, days, {from, to})`: 학생별 kind×category 건수. 결석은 수업일 일수와 연속 묶음 건수(같은 category, 수업일 기준 연속) 둘 다.
- `statsTable(students, stats)` → string[][] (번호, 이름, 결석 질병/미인정/출석인정(일), 지각·조퇴·결과 각 3종, 합계).
- 테스트: 주말 건너 연속 → 1건 2일, 범위 필터, 수업일 아닌 날 결석은 일수에서 제외.

## Task 5 — 통계 화면 (`src/pages/stats/StatsPage.tsx`, 경로 `/stats`)
- 학급, 기간(학년도 전체 기본 / 월 선택), 표, 엑셀·hwpx 내보내기(가로 A4).

## Task 6 — 검증
- 전체 테스트 ×3, tsc, build, 브라우저 흐름(출결 입력 → 목록 → 제출 → 통계), 샘플 hwpx를 문서 폴더에.
