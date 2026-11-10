# 설계서 5 — 남은 추가 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 출결 오른쪽 달력, 통계 칸 고르기·신고서 연결, 명단 양식 고치기, 다른 학교 결석신고서 양식 자동 인식, 음성 받아쓰기(선택 내려받기)를 더한다.

**Architecture:** 화면 로직은 `src/lib/*`의 순수 함수(단위 시험)와 얇은 화면으로 나눈다. 다른 학교 양식은 표 칸을 읽어 기존 `{{표시}}`를 빈 칸에 써 넣은 hwpx를 만들고, 기존 `installTemplate`로 저장한다(새 표 없음). 음성 받아쓰기는 Electron 주 프로세스가 고정 주소·SHA-256으로 whisper.cpp와 모델을 받아 앱 자료 폴더에 두고 `whisper-cli`를 실행한다.

**Tech Stack:** React 18 + TS + Vite, Dexie, Vitest/jsdom, Electron 44(SHELL 5), JSZip.

**Spec:** `docs/superpowers/specs/2026-11-10-watson-more-features-design.md`

## Global Constraints

- 학생 자료는 노트북 안에만. 음성 파일·받아쓴 글은 밖으로 보내지 않는다. AI로 보내는 것은 양식의 칸 글뿐(학생 자료 없음).
- 녹음 받아쓰기는 설치형(Windows 앱) SHELL 5 이상에서만. 아니면 칸을 보이지 않는다(설정 카드는 '새 설치형이 필요합니다').
- 내려받기는 아래 고정 값만 쓴다. SHA-256이 다르면 지우고 실패로 끝낸다.
  - 실행 파일: `https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip` · sha256 `b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732` · 3,832,432 bytes
  - 모델 빠름: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin` · sha256 `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb` · 약 190MB
  - 모델 정확: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin` · sha256 `19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f` · 약 539MB
- 화면 말: '설치형(Windows 앱)', '한글로 받기'. 단추는 화면에 주 단추 하나.
- 새 설정 값은 `app_settings`(백업 포함). 화면 보기 선택(통계 칸)은 이 기기 localStorage(try/catch).
- 모든 새 화면은 기본·어둡게 캡처로 확인.

## Review Focus

1. 명단 양식에서 칸을 숨기거나 순서를 바꿔도 예전 학생 값이 지워지지 않아야 한다(숨김 ≠ 삭제). — Task 3 시험.
2. 엑셀 올리기에서 추가 칸 머리글이 기본 칸 별칭과 같은 이름이면 기본 칸이 이긴다. — Task 3 시험.
3. 다른 학교 양식에서 이미 글이 있는 칸(예: '위 학생은…' 문구)에 표시를 덮어쓰지 않는다. — Task 4 시험.
4. 받기 도중 끊기거나 해시가 다르면 반쯤 받은 파일이 남지 않고, 다시 받을 수 있다. — Task 5 시험.
5. 받아쓰기 결과는 쓰던 내용 뒤에 붙고(덮어쓰지 않음), 취소하면 아무것도 바뀌지 않는다. — Task 5 시험.

---

### Task 1: 출결 화면 오른쪽 달력

**Files:**
- Create: `src/lib/calendar/monthData.ts`, `src/lib/calendar/monthData.test.ts`, `src/pages/attendance/MiniCalendar.tsx`
- Modify: `src/pages/calendar/CalendarPage.tsx` (load 를 `loadMonthData`로), `src/pages/attendance/AttendancePage.tsx` (학생 없을 때 오른쪽), `src/pages/attendance/AttendancePage.test.tsx`, `src/styles.css`

**Interfaces:**
- Produces: `export interface DayData { events: SchoolCalendarRec[]; google: GoogleEventRec[]; local: LocalEventRec[]; atts: { a: AttendanceRec; s: StudentRec }[]; logs: { l: CounselingLogRec; s: StudentRec }[] }`
- Produces: `loadMonthData(db: AppDB, classId: string | undefined, from: string, to: string): Promise<Record<string, DayData>>` — CalendarPage의 load 본문을 그대로 옮김.
- Produces: `monthCells(month: string, weekends: boolean): string[]` — 월요일 시작, 그달이 끝나는 주까지.
- Produces: `<MiniCalendar date={date} classId={classId} onPick={(d) => void} />`

- [ ] **Step 1: 시험** `monthData.test.ts`
  - `monthCells('2026-11', false)` 첫 값 `'2026-10-26'`, 길이 25(5주×평일), 모두 평일.
  - `loadMonthData`: 학사 '체육대회'(11/12), 내 일정(11/13 태그 업무), 출결 1건(11/10) → `r['2026-11-12'].events[0].title === '체육대회'`, `r['2026-11-10'].atts.length === 1`, `r['2026-11-13'].local.length === 1`.
- [ ] **Step 2: 실패 확인** `npx vitest run src/lib/calendar` → FAIL(모듈 없음)
- [ ] **Step 3: 구현** 위 두 함수. CalendarPage는 `loadMonthData`·`monthCells`를 쓰게 바꾸고 동작 그대로.
- [ ] **Step 4: 화면 시험** `AttendancePage.test.tsx`에 추가: 학생을 고르지 않으면 `region '이달 달력'`이 보이고 날짜 칸 '12'를 누르면 날짜 입력 값이 `2026-11-12`; 그 날 일정 목록에 '체육대회'; 학생을 누르면 달력 대신 입력 칸, 닫으면 달력.
- [ ] **Step 5: 구현** MiniCalendar: `[‹ 2026년 11월 ›]`(MonthPicker 재사용, 보이는 달은 date의 달에서 시작), 7열 아닌 평일 5열 표, 칸에 날짜·점(학사=회색, 구글=파랑, 내 일정=태그 색, 최대 3개)·출결 수 `출결 n`. 오늘 칸 굵게, 고른 날 테두리. 아래 '그날 일정' 목록(시각 · 제목). 출결 화면 `.att-side`의 빈 안내 카드 자리에 넣는다. 자료는 `useLive(() => loadMonthData(...))`.
- [ ] **Step 6: 확인** `npx vitest run src/lib/calendar src/pages/attendance src/pages/calendar` → PASS
- [ ] **Step 7: 커밋** `출결: 오른쪽 이달 달력(일정 점·출결 수, 누르면 그날로)`

### Task 2: 통계 칸 고르기 · 신고서 칸 · 링크

**Files:**
- Modify: `src/lib/stats.ts`, `src/lib/stats.test.ts`, `src/pages/stats/StatsPage.tsx`, `src/pages/stats/StatsPage.test.tsx`, `src/pages/reports/ReportsPage.tsx`(+test), `src/pages/attendance/AttendancePage.tsx`(+test)

**Interfaces:**
- Produces: `export const STAT_COLS: string[]` = `KINDS × CATEGORIES`의 `'결석:질병'` 꼴 12개.
- Produces: `statsTable(students, stats, opts?: { cols?: string[]; reports?: Map<string, { open: number; total: number }> }): string[][]` — cols 없으면 지금과 같음. reports 를 주면 끝에 '신고서' 칸(`미제출 n / m`, 둘 다 0이면 '').
- Produces: `firstAbsenceDate(atts: AttendanceRec[], studentId: string, kind: AttendanceKind, range): string | undefined`
- Consumes: ReportsPage는 `?sid=` 로 한 학생만, AttendancePage는 `?sid=` 로 그 학생을 고른 채 연다(`?date=`는 이미 있음).

- [ ] **Step 1: 시험** `stats.test.ts`: `statsTable(..., { cols: ['결석:질병', '지각:미인정'] })[0]` = `['번호','이름','결석 질병','지각 미인정']`; reports 맵(open 1,total 2) → 마지막 칸 `'미제출 1 / 2'`, 합계 줄 `'미제출 1 / 2'`.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** stats.ts.
- [ ] **Step 4: 화면 시험** StatsPage: '칸 ▾' 메뉴에서 '조퇴 질병' 끄면 머리글에서 사라지고 엑셀 내보내기 머리글에도 없음(memory fs downloads를 readFirstSheet로 읽어 확인). 신고서 칸 숫자 링크 href `#/attendance/reports?sid=<id>`. 결석 칸 숫자 링크 href `#/attendance?date=<첫날>&sid=<id>`. ReportsPage `?sid=` → 그 학생 행만 + '모두 보기' 단추. AttendancePage `?sid=` → 그 학생 입력 칸이 열림.
- [ ] **Step 5: 구현** 칸 선택은 localStorage `watson.stats.cols`(배열, 기본 전부). 머리 2줄은 보이는 칸으로 colSpan 계산. 링크는 `<Link>`.
- [ ] **Step 6: 확인** `npx vitest run src/lib/stats.test.ts src/pages/stats src/pages/reports src/pages/attendance` → PASS
- [ ] **Step 7: 커밋** `통계: 보일 칸 고르기, 신고서 칸(미제출/전체), 결석·신고서 숫자에서 바로 이동`

### Task 3: 명단 양식 고치기

**Files:**
- Create: `src/lib/roster/fields.ts`, `src/lib/roster/fields.test.ts`, `src/pages/class/RosterFieldsEditor.tsx`
- Modify: `src/lib/db/types.ts` (`StudentRec.extra?: Record<string, string>`, `AppSettingsRec.roster_fields?: RosterField[]`), `src/lib/settings.ts`, `src/lib/roster/columns.ts`, `src/lib/roster/paste.ts`(+test), `src/lib/roster/roster.ts`, `src/pages/class/StudentDetail.tsx`, `src/pages/class/RosterTab.tsx`, `src/lib/docs/roster-doc.ts`(+test), `src/pages/class/RosterDocTab.tsx`, 관련 화면 시험

**Interfaces:**
- Produces: `export interface RosterField { key: string; label: string; builtin: boolean; visible: boolean }` — builtin key는 StudentRec 글 칸 이름(`gender`, `birth_date`, … `memo`), 추가 칸 key는 `x_<8자>`.
- Produces: `DEFAULT_FIELDS: RosterField[]` (StudentDetail TEXT_FIELDS의 이름 뺀 13칸, 순서 그대로, 모두 visible)
- Produces: `readFields(s: Pick<AppSettingsRec,'roster_fields'>): RosterField[]` — 저장값과 DEFAULT를 합침(새 기본 칸이 생기면 끝에 붙임, 모르는 builtin 버림).
- Produces: `fieldValue(st: StudentRec, f: RosterField): string`, `setFieldValue(fields: StudentFields, f: RosterField, v: string): StudentFields`
- Produces: `addField(list, label): RosterField[]`, `renameField`, `moveField(list, key, dir: -1|1)`, `removeField(list, key)` (builtin은 지울 수 없고 숨기기만)
- Produces: `templateColumns(fields): { key: string; label: string; aliases: string[] }[]` — 번호·이름 + 보이는 칸(엑셀 머리글·열 찾기 공용). 추가 칸 aliases = [label].
- Modifies: `mapHeader(row, cols = ROSTER_COLUMNS)`, `toRosterRows(cells, cols?)` → `RosterRow.fields`에 추가 칸은 `extra: {key: v}`; `rosterTemplate(students, cols?)`.
- Modifies: `RosterDocOptions.fields: string[]` (기본 `[]`) — 이름 뒤, 빈 칸 앞에 그 칸 값.

- [ ] **Step 1: 시험** `fields.test.ts`
  - `readFields({})` 길이 13, 첫 key `'gender'`.
  - `addField(DEFAULT_FIELDS,'방과후')` 끝에 `{label:'방과후', builtin:false, visible:true}` key `/^x_/`.
  - `moveField(list,'phone',-1)`: phone이 birth_date 앞으로.
  - `removeField(list,'gender')` → 그대로(builtin), 추가 칸은 빠짐.
  - 숨김: `templateColumns` 에 visible false 칸 없음, 번호·이름 맨 앞.
  - `readFields({ roster_fields: [{key:'memo',label:'메모',builtin:true,visible:false}] })` → memo 맨 앞·숨김·이름 '메모', 나머지 기본 칸 뒤에 붙음.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** fields.ts, types, settings DEFAULT(`roster_fields` 없음 = 기본).
- [ ] **Step 4: 시험** paste.test.ts
  - 머리글 `번호, 이름, 방과후, 성별` + 추가 칸 '방과후' → rows[0].fields `{ name, gender:'남', extra: { x_..: '로봇반' } }`.
  - 추가 칸 이름이 '연락처'(기본 phone 별칭)면 phone으로 간다(기본 칸 우선).
  - `upsertRosterRows`: extra는 합쳐 저장(있던 다른 추가 칸 값 유지). roster.test.ts에.
- [ ] **Step 5: 구현** columns/paste/roster. extra 병합: `{ ...prev.extra, ...given.extra }`.
- [ ] **Step 6: 화면 시험** RosterTab: '가져오기·양식 ▾' → '양식 고치기' → '칸 추가'로 '알레르기' → 저장 → 학생 상세에 '알레르기' 칸, 값 넣고 저장하면 `student.extra`에 저장; '성별' 숨기면 상세에서 사라지지만 db의 gender 값은 그대로; ↑ 단추로 순서 바뀜. RosterDocTab: '칸 더하기'에서 '전화번호' 고르면 표 머리글 `['번호','이름','전화번호', …빈칸]`.
- [ ] **Step 7: 구현** RosterFieldsEditor(카드: 칸 목록 행 = 보이기 체크 · 이름 입력(추가 칸만) · ↑↓ · 지우기(추가 칸만), 아래 '칸 추가', '저장'(주 단추)·'기본으로'·'닫기'), StudentDetail은 readFields 순서로 보이는 칸만, 성별은 남/여/빈 seg. RosterDoc 칸 고르기는 체크 목록.
- [ ] **Step 8: 확인** `npx vitest run src/lib/roster src/lib/docs src/pages/class` → PASS
- [ ] **Step 9: 커밋** `명단: 양식 고치기(칸 보이기·순서·추가 칸), 엑셀 양식·올리기·명렬표가 따라감`

### Task 4: 다른 학교 결석신고서 양식 인식

**Files:**
- Create: `src/lib/hwpx/absence/scan.ts`, `src/lib/hwpx/absence/scan.test.ts`, `src/pages/settings/FormScan.tsx`
- Modify: `src/lib/hwpx/absence/build.ts` (값 3개 추가, `buildAbsenceHwpx` opt `templateBytes?`), `src/pages/settings/ReportSettings.tsx`(+test), `src/lib/ai/prompts.ts`(kind 'formscan' 아님 — 앱 고정 지시문, 화면에서 고치지 않음)

**Interfaces:**
- Produces: `export interface FormCell { id: number; row: number; col: number; rowSpan: number; colSpan: number; text: string }` (표 순서대로 id)
- Produces: `scanCells(sectionXml: string): FormCell[]` — 모든 `<hp:tc>`의 cellAddr·cellSpan과 안의 `<hp:t>` 글(공백 정리).
- Produces: `export const SLOT_FIELDS: { field: string; label: string; re: RegExp }[]` — field는 ABSENCE_PLACEHOLDERS 이름. 규칙:
  - 이름 `/^(학생\s*)?(성\s*명|이\s*름)$/`, 학번 `/^학\s*번$/`, 학년반번호 `/학\s*년.*반|반.*번\s*호/`, 기간 `/^(결석\s*)?(기\s*간|일\s*시)$/`, 일수 `/일\s*수/`, 사유 `/^(결석\s*)?사\s*유$|^내\s*용$/`, 결석종류 `/^(구\s*분|종\s*류)$/`, 작성날짜 `/(작성|신고|제출)\s*일/`
- Produces: `matchByRules(cells): Slot[]` where `Slot = { field: string; label: number; target: number }` — 이름표 칸 오른쪽(같은 row, col = col+colSpan) 칸, 없거나 글이 있으면 아래(row+rowSpan, 같은 col) 칸. 대상 칸에 글이 있으면 건너뜀.
- Produces: `matchByAi(cells, have: Slot[], ai: AiCaller): Promise<Slot[]>` — 못 찾은 field만, 보내는 것 = `{id,row,col,text}` 목록(글 있는 칸만)과 field 이름표. 응답 `{"pairs":[{"field","label"}]}` → 같은 규칙으로 target 계산, 잘못된 field·id는 버림.
- Produces: `markTemplate(bytes: Uint8Array, slots: Slot[]): Promise<Uint8Array>` — target 칸 첫 문단을 `<hp:run charPrIDRef="(그 칸 첫 run의 값, 없으면 0)"><hp:t>{{field}}</hp:t></hp:run>` 하나로.
- Modifies: `absenceValues`에 `학년반번호`(`1학년 5반 3번`), `결석종류`(`질병 결석`), `작성날짜`(`2026년 11월 10일`) 추가, ABSENCE_PLACEHOLDERS에도.

- [ ] **Step 1: 시험** `scan.test.ts` — 시험용 hwpx는 `buildTableHwpx`로 만든 2×4 표(`['성 명','','기 간','']`, `['사 유','위 학생은 결석하였기에','작성일','']`).
  - `scanCells` 8칸, `cells[0].text === '성 명'`, row/col 맞음.
  - `matchByRules` → 이름→cell1, 기간→cell3, 작성날짜→cell7; 사유는 오른쪽에 글이 있고 아래 칸이 없어 빠짐.
  - `matchByAi` 가짜 AI가 `{pairs:[{field:'사유',label:4},{field:'없는칸',label:0}]}` → 사유 target 계산 시 글 있는 칸이라 버림 → 결과에 없음; AI에 보낸 글에 학생 이름 없음(셀 글만).
  - `markTemplate` 후 `inspectTemplate(bytes).ok === true`, found에 이름·기간·작성날짜; cell5의 '위 학생은…' 그대로.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** scan.ts, build.ts 값 추가(build.test에 세 값 시험 한 줄씩).
- [ ] **Step 4: 화면 시험** ReportSettings: '다른 학교 양식 올리기' → (memory fs nextFileToRead=위 hwpx) → 확인 표 `table '찾은 자리'`에 행 '학생 이름 · 성 명 칸 오른쪽'; 드롭다운으로 사유 자리를 '(없음)'에서 바꿀 수 있음; '가상 학생으로 미리보기'는 파일 내려받기 1개; '이 양식으로 저장' → `listTemplates(db)[0].active` 이고 이름은 파일 이름.
- [ ] **Step 5: 구현** FormScan: 단계 = 읽는 중 → 확인 표(자리 | 찾은 칸 글 | 바꾸기 select: 글 없는 칸 목록 `r행 c열 (옆: 이름표 글)`) → AI 켜져 있으면 '못 찾은 자리 AI로 찾기'(보조 단추) → '가상 학생으로 미리보기'(가상 학생·가상 신고서 1건으로 `buildAbsenceHwpx(db, [가상], { templateBytes })` — DB에 쓰지 않는 경로: absenceValues에 가상 값 넣고 fillPlaceholders 직접) → '이 양식으로 저장'(주 단추)이 `installTemplate`. 표시는 이미 {{}}가 있는 양식이면 지금처럼 바로 installTemplate.
- [ ] **Step 6: 확인** `npx vitest run src/lib/hwpx src/pages/settings` → PASS
- [ ] **Step 7: 커밋** `결석신고서: 다른 학교 양식 올리면 칸을 읽어 자리 찾기(규칙+AI), 확인·미리보기 후 저장`

### Task 5: 음성 받아쓰기(선택 내려받기)

**Files:**
- Create: `electron/stt.cjs`, `src/lib/stt/sttMain.test.ts`(node 환경, stt.cjs 시험), `src/lib/stt/stt.ts`, `src/lib/stt/stt.test.ts`, `src/pages/settings/SttSettings.tsx`, `src/pages/counseling/AudioDrop.tsx`
- Modify: `electron/main.cjs`(IPC), `electron/preload.cjs`(`stt`), `src/pages/settings/AiSettings.tsx`(카드 넣기) 또는 SettingsPage, `src/pages/counseling/CounselingPage.tsx`(LogFieldsForm 내용 칸 위), 시험

**Interfaces (electron/stt.cjs, CommonJS, 순수 부분만 시험):**
- `STT_FILES = { bin: {url, sha256, size}, models: { fast: {url, sha256, label:'빠름(약 0.2GB)'}, accurate: {url, sha256, label:'정확(약 0.5GB)'} } }` (Global Constraints 값)
- `downloadVerified(fetchFn, url, dest, sha256, { onProgress, maxBytes, timeoutMs }): Promise<void>` — `dest + '.part'`에 흘려 쓰며 해시, 끝나면 비교 후 rename; 실패·취소 때 .part 지움.
- `extractBin(zipBytes, dir): Promise<string[]>` — `Release/whisper-cli.exe`와 `Release/*.dll`만, 경로 밖 이름 거부.
- `whisperArgs({ model, input, outBase, threads }): string[]` = `['-m', model, '-f', input, '-l', 'ko', '-otxt', '-of', outBase, '-np', '-pp', '-t', String(threads)]`
- `parseProgress(line): number | null` — `progress = 37%` → 37
- main IPC: `stt:status` → `{ supported: boolean; bin: boolean; models: ('fast'|'accurate')[] }`; `stt:install(model)` (진행 `stt:progress` {phase:'bin'|'model', received, total}); `stt:remove()`; `stt:run({ path?: string; wav?: Uint8Array; model })` → `{ text }` (진행 `stt:progress` {phase:'run', percent}); `stt:cancel()`. 폴더 `userData/stt`, 임시 입력·출력은 `AI_DIR()` 아래에 쓰고 끝나면 지움. 실행은 `spawn(cli, args, { cwd: sttDir, windowsHide: true })`, 취소·창 닫힘 때 killTree.
- preload: `stt: { status, install, remove, run, cancel, onProgress(cb), pathOf(file) }` — `pathOf`는 `webUtils.getPathForFile`.

**Interfaces (src/lib/stt/stt.ts):**
- `getSttBridge(): SttBridge | undefined`
- `AUDIO_EXT = /\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i`, `DIRECT_EXT = /\.(mp3|wav|ogg|flac)$/i` (whisper가 바로 읽음)
- `encodeWav16(samples: Float32Array): Uint8Array` — 16kHz mono PCM16 WAV.
- `toWav16k(file: File): Promise<Uint8Array>` — WebAudio decode + OfflineAudioContext(1, n, 16000) (m4a·aac·webm용, 40MB 넘으면 오류 '이 형식은 40MB까지입니다. mp3로 바꿔 올리세요.')
- `appendTranscript(content: string, text: string): string` — 빈 내용이면 text, 아니면 `content + '\n\n[녹음 받아쓰기]\n' + text.trim()`.

- [ ] **Step 1: 시험** `sttMain.test.ts`(@vitest-environment node)
  - `whisperArgs` 정확한 배열; `parseProgress('whisper_print_progress_callback: progress =  37%')` → 37, 다른 줄 null.
  - `downloadVerified`: 가짜 fetch(Response 스트림 'abc')와 맞는 sha256 → dest 내용 'abc', .part 없음; 틀린 sha256 → reject '파일 확인(SHA-256)에 실패했습니다.', dest·.part 모두 없음; onProgress 마지막 received 3.
  - `extractBin`: JSZip로 만든 zip(`Release/whisper-cli.exe`, `Release/ggml.dll`, `Release/bench.exe`, `../evil.dll`) → 두 파일만 써짐.
- [ ] **Step 2: 실패 확인** `npx vitest run src/lib/stt` → FAIL
- [ ] **Step 3: 구현** stt.cjs, main.cjs IPC(지원은 `process.platform === 'win32'`), preload.
- [ ] **Step 4: 시험** `stt.test.ts`: `encodeWav16(new Float32Array([0, 1, -1]))` 길이 44+6, 'RIFF'·'WAVE', 표본 0, 32767, -32768, 표본율 16000. `appendTranscript('', ' 안녕 ')` → '안녕'; `appendTranscript('메모', '안녕')` → '메모\n\n[녹음 받아쓰기]\n안녕'.
- [ ] **Step 5: 구현** stt.ts.
- [ ] **Step 6: 화면 시험**
  - SttSettings(설정 > AI 아래 카드 '음성 받아쓰기'): 가짜 브리지 status `{supported:true, bin:false, models:[]}` → 모델 고르기(빠름 기본) + '받기'(주 단추) → install('fast') 호출, 진행 막대 role=progressbar; 받은 뒤 '설치됨 · 빠름' + '지우기'. 브리지 없으면 '새 설치형(Windows 앱)이 필요합니다'.
  - 상담일지 새 기록: 브리지 없거나 모델 없음 → 'region 녹음 파일' 없음. 있음 → 칸 보임; 파일(`a.mp3`)을 떨어뜨리면 run({path, model}) 호출, 결과 '안녕하세요'가 내용 칸 뒤에 붙음; 취소 누르면 cancel 호출·내용 그대로.
- [ ] **Step 7: 구현** AudioDrop(`region aria-label="녹음 파일"`: '녹음 파일을 끌어다 놓거나 누르세요 (mp3·m4a·wav·ogg) · 이 컴퓨터 안에서만 글로 바꿉니다', 진행 막대·'취소'), LogFieldsForm에 `onTranscript`로 내용에 붙임. 모델이 둘 다 있으면 정확 우선.
- [ ] **Step 8: 확인** `npx vitest run src/lib/stt src/pages/settings src/pages/counseling` → PASS; Electron xvfb에서 `desktop.stt.status()`가 `{supported:false…}`(리눅스) 돌려줌을 확인.
- [ ] **Step 9: 커밋** `상담: 음성 받아쓰기(설정에서 선택 내려받기, 녹음 파일 끌어 놓으면 이 컴퓨터 안에서 글로)`

### Task 6: 마무리 확인

- [ ] tsc, 전체 시험, 빌드.
- [ ] 캡처(기본·어둡게, 1366×768): 출결 달력, 통계 칸 메뉴, 양식 고치기, 다른 학교 양식 확인 표, 설정 음성 받아쓰기 카드, 상담 녹음 칸(가짜 브리지 주입).
- [ ] 설계서 5 §6 차이(hwpx_templates에 slots를 두지 않고 표시를 써 넣은 양식으로 저장, 모델 2개)를 설계서에 적기.
- [ ] 커밋 `설계서 5 마무리: 캡처 확인·설계서 갱신`
