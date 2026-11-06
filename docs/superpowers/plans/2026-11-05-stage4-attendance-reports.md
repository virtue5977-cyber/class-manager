# 4단계: 출결 입력 · 결석신고서 자동 생성 · 자리표시자 hwpx 양식 Implementation Plan (개정 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 출결을 입력하면 설정한 규칙대로 결석신고서가 자동 생성·갱신되고, 어떤 학교 양식이든 자리표시자(`{{이름}}` 등)를 넣어 올리면 그 양식으로 hwpx를 만든다. 기본 양식은 사용자의 학교 양식에 자리표시자를 미리 넣어 내장한다.

**Architecture:** 출결 저장(`lib/attendance`) → 학생 단위 재계산(`lib/absenceReports`: 규칙·`SchoolDays`·출결 → 신고서 묶음(순수), 기존 신고서와 맞추기(DB)). hwpx는 일반 자리표시자 엔진(`lib/hwpx/placeholder`: 조각난 표시 이어 붙이기·찾기·채우기·쪽 복제)과 신고서 값 만들기(`lib/hwpx/absence`)로 나눈다.

**Tech Stack:** 기존 스택 그대로.

**Spec:** `docs/superpowers/specs/2026-11-04-class-manager-design.md`(6.2 설정 가능한 규칙, 6.4 자리표시자 양식, 5절 설정 칸 `report_rules`·`diagnosis_days`·`student_code_format`). 월별 목록·일괄 제출은 5단계.

## 사용자 학교 양식에서 확인한 사실(기본 양식 만들 때 바꿀 문장)

| 원본 문장(`<hp:t>` 내용) | 기본 양식에서 바꿀 내용 |
|---|---|
| `  학 번 :      성 명 :  ` | `  학 번 : {{학번}}    성 명 : {{이름띄움}}  ` |
| `   1. 기간 : 2026년    월    일  ~      월     일 (   교시),   [  일간]` | `   1. 기간 : {{기간}} {{교시표시}}   [ {{일수}}일간]` |
| `출석인정 □    질병 □` | `출석인정 {{결석_출석인정}}    질병 {{결석_질병}}` |
| `출석인정 □` (0번째) / (1번째) | `출석인정 {{지각_출석인정}}` / `출석인정 {{결과_출석인정}}` |
| `  출석인정 □` | `  출석인정 {{조퇴_출석인정}}` |
| `   3. 상세 사유 :` | `   3. 상세 사유 : {{사유}}` |
| 증빙 표(6행 3열) 1~5행의 `<hp:run charPrIDRef="24"/>` | `<hp:run charPrIDRef="24"><hp:t>{{증빙_2일이내}}</hp:t></hp:run>` … `{{증빙_3일이상}}`, `{{증빙_법정전염병}}`, `{{증빙_경조사}}`, `{{증빙_기타}}` |
| `2026년   월    일  ` | `{{작성연도}}년 {{작성월}}월 {{작성일}}일  ` |
| `학  생  성명 :            ` | `학  생  성명 : {{학생성명}}      ` |
| `□ 진료확인서 또는 처방전` 등 5개 | `{{확인_진료확인서}} 진료확인서 또는 처방전`, `{{확인_약봉투}} …`, `{{확인_진단서}} …`, `{{확인_보호자통화}} …`, `{{확인_기타}} 기타 (` |
| ` 2026년    월     일  ` | ` {{확인연도}}년 {{확인월}}월 {{확인일}}일  ` |
| `담임교사:             ` | `담임교사: {{담임교사}}      ` |
| ` (원본 양식의 학교명)장  귀하 ` | ` {{학교명}}장  귀하 ` |

문서 속성 `creator`·`lastsaveby`의 사람 이름은 지운다. 용지 `landscape="WIDELY"`(세로).

## 자리표시자 목록(이름 → 값)

- 학생: `학번`(설정 형식), `이름`, `이름띄움`(글자 사이 공백), `학년`, `반`, `번호`, `학생성명`(옵션 켜면 이름, 끄면 빈칸)
- 기간: `연도`, `시작월`, `시작일`, `종료월`, `종료일`, `기간`(`2026년 11월 6일` 또는 `2026년 11월 6일 ~ 11월 9일`), `교시`(`3~4`), `교시표시`(`(3~4교시),` 또는 빈칸), `일수`(결석만, 아니면 빈칸)
- 체크 ■/□: `{구분}_{종류}` 12개(`결석_미인정` … `결과_출석인정`)
- 증빙 ○/빈칸: `증빙_2일이내`, `증빙_3일이상`, `증빙_법정전염병`, `증빙_경조사`, `증빙_기타`
- 담임 확인 방법 ■/□: `확인_진료확인서`, `확인_약봉투`, `확인_진단서`, `확인_보호자통화`, `확인_기타`
- 날짜: `작성연도`·`작성월`·`작성일`, `확인연도`·`확인월`·`확인일`(값이 없으면 손글씨용 공백 3칸)
- 기타: `사유`, `담임교사`, `학교명`(비면 공백 8칸)

## Global Constraints

- 1~3단계 Global Constraints 유지.
- 교시(`period`)는 글자(`3`, `3~4`), 지각·조퇴·결과일 때만 필수, 결석이면 `null`.
- 신고서 대상은 설정 `report_rules`(`'결석:질병'` 형식 목록). 기본 `['결석:질병','결석:출석인정','지각:출석인정','조퇴:출석인정','결과:출석인정']`.
- 결석은 같은 학생·같은 종류가 수업일 기준으로 이어지면 한 장. 지각·조퇴·결과는 한 건에 한 장.
- 증빙: 질병 결석 수업일 < `diagnosis_days` → `2일 이내 질병`(확인 방법 기본 `[3]`), ≥ → `3일 이상 질병`·`diagnosis_required`·확인 방법 `[2]`. 질병 지각·조퇴·결과 → `2일 이내 질병`, `[3]`. 출석인정 → 출결의 `evidence_type`(기본 `기타`), `[]`. 미인정 → 증빙 `''`, `[]`.
- 작성일·확인일 기본 = 종료일 다음 수업일. 사유는 40자까지(넘으면 자르고 경고).
- 고친 칸은 `overrides`, 구성이 바뀌었고 (제출됨 또는 overrides 있음)이면 `stale=true`.
- 학번 형식 토큰: `{학년}`, `{반}`, `{반2}`, `{번호}`, `{번호2}`. 기본 `{학년}{반}{번호2}`(1학년 5반 3번 → `1503`).
- 자리표시자는 `{{` + 한글·영문·숫자·`_` + `}}`. 알 수 없는 표시는 빈칸으로 바꾸고 경고.

## Review Focus

1. 금(11-06)·월(11-09) 결석, 사이 휴업일 → 한 장, 수업일 수 정확. (Task 2)
2. 2일 → 3일로 늘면 같은 신고서가 `3일 이상 질병`·진단서 필요, 제출 상태 유지·stale. (Task 3)
3. 한글이 `{{이름}}`을 `<hp:t>{{이</hp:t></hp:run><hp:run …><hp:t>름}}</hp:t>`처럼 쪼개도 채워짐. (Task 4)
4. 여러 명 한 파일 → 쪽마다 같은 양식, 개체 id 중복 없음, XML 오류 0. (Task 4)
5. `{{이룸}}` 같은 오타 → 양식 검사에서 "알 수 없는 표시"로 보이고, 채울 때 빈칸+경고. (Task 4, Task 5)

---

### Task 1: 타입·설정 보완과 출결 저장

**Files:**
- Modify: `src/lib/db/types.ts` — `AttendanceRec.period: string | null`; `EvidenceType`에 `''` 추가; `AbsenceReportRec`: `guardian_call_checked` 제거, `period: string | null`, `confirm_methods: number[]`, `written_date: string`, `confirmed_date: string`, `overrides: string[]`, `stale: boolean`; `AppSettingsRec`에 `report_rules: string[]`, `diagnosis_days: number`, `student_code_format: string`
- Modify: `src/lib/settings.ts` — `DEFAULT_SETTINGS`에 위 기본값
- Create: `src/lib/attendance/attendance.ts`
- Test: `src/lib/attendance/attendance.test.ts`

**Interfaces:**
- Produces: `AttendanceInput`, `validateAttendance(input, sameDay): string | null`, `saveAttendance(db, input, id?)`, `deleteAttendance(db, id)`, `listAttendanceByDate(db, studentIds, date)`, `listAttendanceByStudent(db, studentId)`. 오류 문구(정확히): `'교시를 입력하세요.'`, `'교시는 3 또는 3~4처럼 입력하세요.'`(`^\d{1,2}(~\d{1,2})?$`), `'이 날짜에 같은 구분의 출결이 이미 있습니다.'`, `'결석한 날에는 지각·조퇴·결과를 함께 입력할 수 없습니다.'`. 결석이면 period→null, 출석인정이 아니면 evidence_type→null.

- [ ] **Step 1: 실패하는 테스트**(문구 4종, 결석 period 정리, 자기 자신 수정 허용, 삭제 후 목록 제외, 설정 기본값 3종) → **Step 2** FAIL → **Step 3** 구현 → **Step 4** PASS(+전체) → **Step 5** 커밋 `feat(attendance): validated attendance records and report settings`

### Task 2: 신고서 묶음 계산(순수)

**Files:** Create `src/lib/absenceReports/compute.ts`; Test `compute.test.ts`

**Interfaces:**
- Produces:
  - `interface ReportRules { rules: string[]; diagnosisDays: number }`
  - `needsReport(a, rules): boolean`
  - `ReportDraft`(student_id, kind, category, start_date, end_date, period, school_days, evidence_type, confirm_methods, diagnosis_required, detail, written_date, confirmed_date, attendance_ids, warnings)
  - `computeDrafts(attendances, days: SchoolDays, rules: ReportRules): ReportDraft[]` — 결석은 같은 category끼리 `next === days.nextClassDay(prev)`면 이어 붙임, `school_days` = 묶음 중 수업일 수, 수업일 아닌 날은 경고 `'{M/D}은(는) 수업일이 아닙니다.'`. 그 외 한 건 한 장(`school_days: 0`). 사유 40자 경고 `'상세 사유가 40자를 넘어 잘랐습니다.'`. 시작일순.
  - `studentCode(format: string, grade: number, classNo: number, number: number): string`

- [ ] **Step 1: 실패하는 테스트**

```ts
test('기본 규칙: 미인정·질병 지각은 없음, 질병 결석·출석인정 지각은 있음')
test('규칙에 "지각:질병"을 넣으면 질병 지각도 신고서, 증빙 2일 이내 질병')
test('금·월 질병 결석은 한 장, 수업일 2 → 2일 이내 질병, 확인 [3]')
test('월·화·수 → 3일 이상 질병, 진단서 필요, 확인 [2]; diagnosisDays 4면 3일도 2일 이내')
test('사이 휴업일(11-10)이 있으면 11-09·11-11은 한 장, 수업일 2')
test('질병 결석과 출석인정 결석은 이어져도 따로; 하루 빠지면 두 장')
test('출석인정 지각: 교시 유지, 증빙은 evidence_type(없으면 기타), 확인 []')
test('미인정 결석을 규칙에 넣으면 증빙 빈값')
test('작성일·확인일 = 종료일 다음 수업일')
test('사유 41자 → 40자, 경고')
test('studentCode 기본 1503, {학년}{반2}{번호2} → 10503, 12반 → 11203')
```

- [ ] **Step 2** FAIL → **Step 3** 구현 → **Step 4** PASS → **Step 5** 커밋 `feat(reports): compute report drafts from attendance with configurable rules`

### Task 3: 기존 신고서와 맞추기

**Files:** Create `src/lib/absenceReports/reconcile.ts`; Test `reconcile.test.ts`

**Interfaces:**
- Produces: `OVERRIDABLE = ['detail','evidence_type','confirm_methods','written_date','confirmed_date'] as const`, `loadReportContext(db): Promise<{ days: SchoolDays; rules: ReportRules }>`, `reconcileStudent(db, studentId)`, `impactOfChange(db, studentId, change)`, `updateReport(db, id, patch)`, `resetOverride(db, id, field)`, `listReportsByStudent(db, studentId)`, `getReportAttendanceIds(db, reportId)`, `reconcileAll(db, classId)`(규칙 바꿀 때). 짝짓기·삭제·stale 규칙은 개정 1과 같다: 출결 id가 가장 많이 겹치는 기존 신고서가 같은 신고서, overrides 칸 유지, 미제출이면 지우고 제출됐으면 남기고 stale.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('질병 결석 2일 → 1장, 출결 2건 연결')
test('하루 추가 → 같은 id가 3일·3일 이상 질병, 제출 유지, 제출됐으면 stale')
test('고친 사유는 재계산해도 유지, overrides에 detail')
test('출결 모두 삭제 → 미제출은 삭제, 제출은 남고 stale')
test('가운데 날 삭제 → 두 장, 원래 id는 겹침 큰 쪽')
test('impactOfChange는 제출된 신고서만 돌려주고 DB를 바꾸지 않는다')
test('미인정으로 바꾸면 미제출 신고서가 사라진다')
test('resetOverride는 자동 값으로 되돌린다')
test('규칙에서 출석인정 지각을 끄고 reconcileAll → 미제출 지각 신고서 삭제')
```

- [ ] **Step 2** FAIL → **Step 3** 구현 → **Step 4** PASS → **Step 5** 커밋 `feat(reports): reconcile drafts with saved reports`

### Task 4: 자리표시자 엔진과 기본 양식

**Files:**
- Create: `src/lib/hwpx/placeholder.ts`, `scripts/extract-absence-template.mjs`, `src/lib/hwpx/absence/default-template.hwpx`, `src/lib/hwpx/absence/values.ts`, `src/lib/hwpx/absence/build.ts`
- Test: `src/lib/hwpx/placeholder.test.ts`, `src/lib/hwpx/absence/build.test.ts`

**Interfaces:**
- Produces:
  - `PLACEHOLDER_RE = /\{\{([0-9A-Za-z_가-힣]+)\}\}/g`
  - `joinSplitPlaceholders(sectionXml: string): string` — 문단(`<hp:p …>…</hp:p>`, 중첩 표 안 문단 포함) 안에서 `{{`로 시작해 `}}`가 같은 `<hp:t>`에 없으면 뒤 `<hp:t>`들의 글자를 끌어와 합치고 끌어온 `<hp:t>`는 지운다(빈 run은 남겨도 됨).
  - `findPlaceholders(xml: string): string[]`(합친 뒤, 중복 제거·등장 순)
  - `fillPlaceholders(xml: string, values: Record<string, string>): { xml: string; unknown: string[] }` — 값은 escape해서 넣고 없는 이름은 빈칸.
  - `repeatPages(sectionXml: string, count: number, fill: (pageXml: string, i: number) => string): string` — `<hs:sec>` 안 본문 문단 전체를 한 쪽으로 보고 학생마다 복제. 2쪽부터: `<hp:secPr>…</hp:secPr>`와 `<hp:ctrl><hp:colPr …/></hp:ctrl>`, 머리말·꼬리말 ctrl 제거, 첫 문단 `pageBreak="1"`, `hp:tbl|hp:pic|hp:rect|hp:ellipse|hp:line|hp:container`의 `id`를 중복 없게 바꿈.
  - 추출 스크립트: 생성기 HTML → 양식 hwpx → 위 표대로 자리표시자를 넣고 메타데이터 사람 이름 제거 → `default-template.hwpx`. 넣은 뒤 `findPlaceholders` 결과가 위 목록 중 기본 양식에 들어갈 30개와 같은지 스크립트가 확인. HTML은 저장소에 넣지 않는다.
  - `ABSENCE_PLACEHOLDERS: { name: string; description: string }[]`(안내용, 위 목록 전부)
  - `absenceValues(r: AbsenceReportRec, student: StudentRec, classRec: ClassRec, opt: { teacher: string; school: string; stuName: boolean; codeFormat: string }): Record<string, string>`
  - `buildAbsenceHwpx(db, reports: AbsenceReportRec[], opt: { stuName: boolean; mode: 'one' | 'zip' }): Promise<{ bytes: Uint8Array; fileName: string; warnings: string[] }>` — 활성 양식(없으면 기본)을 읽고 mimetype 첫 항목 STORE. 한 파일은 `repeatPages`, ZIP은 학생별 hwpx.

- [ ] **Step 1:** 추출 스크립트 실행 → 기본 양식 생성.
- [ ] **Step 2: 실패하는 테스트**

```ts
test('같은 <hp:t> 안 표시는 그대로 찾는다')
test('두 run으로 쪼개진 {{이름}}을 합쳐 채운다')
test('세 조각 {{증빙_3일이상}}도 합친다')
test('값의 & < >는 escape, 알 수 없는 표시는 빈칸과 unknown 목록')
test('repeatPages 3쪽: secPr 1개, pageBreak="1" 2개, 개체 id 중복 없음, XML 오류 0')
test('기본 양식의 자리표시자는 30개이고 문서 속성에 사람 이름이 없다')
test('absenceValues: 질병 결석 2일 → 결석_질병 ■, 나머지 □, 증빙_2일이내 ○, 확인_보호자통화 ■, 일수 "2", 기간 "2026년 11월 6일 ~ 11월 9일"')
test('absenceValues: 출석인정 조퇴 3~4교시 → 조퇴_출석인정 ■, 교시표시 "(3~4교시),", 일수 빈칸')
test('buildAbsenceHwpx 한 파일 3명: section0에 학번 3종, mimetype STORE, XML 오류 0')
test('buildAbsenceHwpx zip: 학생별 파일 이름 "결석신고서_1503_홍길동_2026-11-06.hwpx"')
```

- [ ] **Step 3** FAIL → **Step 4** 구현 → **Step 5** PASS → **Step 6** 커밋 `feat(hwpx): placeholder template engine and pre-tagged default absence form`

### Task 5: 양식 검사·설치·안내 파일

**Files:** Create `src/lib/hwpx/absence/template.ts`; Test `template.test.ts`

**Interfaces:**
- Produces:
  - `inspectTemplate(bytes): Promise<{ ok: boolean; found: string[]; unknown: string[]; error?: string }>` — zip·section0 없으면 `error: 'hwpx 파일이 아닙니다.'`; `이름`·`학번` 둘 다 없으면 `ok:false, error: '양식에 {{이름}} 또는 {{학번}} 표시가 없습니다.'`
  - `installTemplate(db, name, bytes)` — 통과 시 새 버전(최대+1)·활성, 실패 시 저장 안 함
  - `listTemplates(db)`, `activateTemplate(db, id)`, `useDefaultTemplate(db)`, `getActiveTemplate(db): Promise<{ bytes: Uint8Array; label: string }>`
  - `defaultTemplateBytes(): Promise<Uint8Array>`
  - `buildPlaceholderGuideHwpx(): Promise<Uint8Array>` — 2단계 `tableXml`로 "표시 | 들어가는 내용" 표

- [ ] **Step 1: 실패하는 테스트** — 기본 양식 통과·found 30, `{{이룸}}`은 unknown, 이름·학번 없으면 거부, zip 아님 거부, 설치 버전 증가·활성 하나, 되돌리기, 안내 파일 XML 오류 0 → **Step 2** FAIL → **Step 3** 구현 → **Step 4** PASS → **Step 5** 커밋 `feat(hwpx): inspect, install and guide for placeholder templates`

### Task 6: 출결 화면

(개정 1과 같음) `src/pages/attendance/AttendancePage.tsx`, `AttendanceForm.tsx`, App 경로 `/attendance`. 학급·날짜(◀ ▶), 비수업일·학사일정 미등록 안내, 학생별 출결 표시와 "신고서"/"제출" 뱃지, 입력 폼(구분 4·종류 3 버튼, 교시는 결석이 아닐 때, 증빙 구분은 출석인정일 때), 제출된 신고서 영향 시 화면 안 확인, 저장 후 `reconcileStudent` 결과 문구, 방향키·Enter.

- [ ] **Step 1: 실패하는 테스트**

```tsx
test('질병 결석 저장 → "결석(질병)"과 "신고서" 뱃지')
test('지각 선택 시 교시 칸, 비우면 "교시를 입력하세요."')
test('출석인정일 때만 증빙 구분')
test('주말이면 "수업일이 아닙니다" 안내')
test('제출된 신고서에 영향을 주는 삭제는 확인(취소하면 그대로)')
test('미인정 지각은 저장되지만 신고서 뱃지 없음')
```

- [ ] **Step 2** FAIL → **Step 3** 구현 → **Step 4** PASS → **Step 5** 커밋 `feat(attendance): daily attendance screen with report sync`

### Task 7: 신고서 패널

(개정 1과 같음, 확인 방법 5개 체크·작성일·확인일·진단서 수령·제출·자동으로 되돌리기·stale 안내) + 내보내기 두 버튼 "hwpx로 내보내기"(한 파일), 학생 성명 인쇄 체크, 경고 목록.

- [ ] **Step 1: 실패하는 테스트** — 3일 질병은 진단서 수령 보임, 사유 고치면 되돌리기, 제출 후 출결 추가 → stale, 내보내기 파일명·PK → **Step 2–4** → **Step 5** 커밋 `feat(reports): report panel with overrides and hwpx export`

### Task 8: 설정 — 신고서 규칙·학번 형식·양식

**Files:** Create `src/pages/settings/ReportSettings.tsx`; Modify `SettingsPage.tsx`, `SchoolSettings.tsx`(담임 성명), `src/lib/fs/adapter.ts`·`web.ts`·`memory.ts`(`pickFileToRead(accept?: string)`)

화면 사양:
- **신고서를 만들 출결:** 4×3 체크표(행 결석·지각·조퇴·결과, 열 미인정·질병·출석인정). 바꾸면 `updateSettings` 후 현재 학급 `reconcileAll`, "신고서를 다시 계산했습니다."
- **진단서가 필요한 결석 일수:** 숫자(1~10, 기본 3) "일 이상".
- **학번 형식:** 입력칸(기본 `{학년}{반}{번호2}`) + 미리보기 "1학년 5반 3번 → 1503".
- **결석신고서 양식:** 현재 양식 이름, "새 양식 올리기"(.hwpx) → 검사 결과(찾은 표시 수, 알 수 없는 표시 목록) → 통과 "새 양식을 적용했습니다.", 실패 시 오류 문구와 기존 유지. 버전 목록 "이 버전 사용", "기본 양식으로 되돌리기", "기본 양식 내려받기", "자리표시자 안내 내려받기", 화면 안 자리표시자 표(접기).
- 학교·NEIS 카드에 "담임 성명".

- [ ] **Step 1: 실패하는 테스트** — 규칙 체크 변경 시 저장·재계산 문구, 학번 미리보기, 오타 표시 양식은 적용되지만 알 수 없는 표시 경고, 이름·학번 없는 양식 거부, 되돌리기, 담임 성명 저장 → **Step 2–4** → **Step 5** 커밋 `feat(settings): report rules, student code format, placeholder templates, teacher name`

### Task 9: 검증과 한글 확인용 파일

- [ ] **Step 1:** `npm test` 3회 연속 PASS, `tsc` 0, `build` 성공.
- [ ] **Step 2:** Playwright: 학급·가상 학생 → 금·월 질병 결석, 출석인정 조퇴 → 뱃지·패널, 콘솔 오류 0, 390px.
- [ ] **Step 3:** 가상 학생 신고서 3종(2일 질병 결석, 3일 질병 결석, 출석인정 조퇴 3~4교시) 한 파일과 `자리표시자_안내.hwpx`, `결석신고서_기본양식.hwpx`를 사용자 문서 폴더에 넣고 한글 확인 요청.
- [ ] **Step 4:** 커밋(필요 시) `chore: stage 4 verification fixes`
