# 3단계: NEIS 연동 · 수업일 계산 · 내 시간표 추정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NEIS 인증키와 학교를 설정하면 학사일정·급식·전체 학급 시간표를 가져와 기기에 저장하고, 수업일 계산 함수와 반자동 "내 시간표"를 제공한다.

**Architecture:** `src/lib/neis`는 NEIS Open API 호출(쪽 나눔·오류 해석)과 응답 → 레코드 변환만 맡고, 네트워크는 주입 가능한 `fetch`로 받아 테스트에서 고정 응답을 쓴다. 저장은 `lib/db` 경유. 수업일 판정(`lib/schoolDays`)과 시간표 추정(`lib/timetable`)은 DB 없이 테스트 가능한 순수 함수.

**Tech Stack:** 1·2단계 스택 그대로(새 의존성 없음).

**Spec:** `docs/superpowers/specs/2026-11-04-class-manager-design.md` (개정 9). 14절 3번, 6.1절(수업일), 8절(NEIS), 5절 `school_calendar`·`neis_cache`·`teacher_timetable`·`app_settings`, 7절 7번(설정 화면의 학교·NEIS, 내 시간표). 홈 화면 표시는 9단계.

## 실측으로 확인한 NEIS 사실(2026-11-05, 사용자 노트북 내장 브라우저)

- 기본 주소 `https://open.neis.go.kr/hub/{서비스}?Type=json&pIndex=&pSize=&KEY=`. 응답 헤더 `Access-Control-Allow-Origin: *` → 브라우저에서 직접 호출 가능.
- 응답 형태: `{ [서비스]: [ { head: [ { list_total_count }, { RESULT: { CODE, MESSAGE } } ] }, { row: [...] } ] }`. 데이터 없음·오류는 `{ RESULT: { CODE, MESSAGE } }` 단독. 필수 인자 누락 `ERROR-300`.
- 인증키 없이 호출하면 행이 최대 5건 → 실제 사용은 키 필수. `pSize` 최대 1000.
- `schoolInfo`: `ATPT_OFCDC_SC_CODE`, `ATPT_OFCDC_SC_NM`, `SD_SCHUL_CODE`, `SCHUL_NM`, `SCHUL_KND_SC_NM`(초등학교/중학교/고등학교…), `ORG_RDNMA`. 학교 이름 검색 인자 `SCHUL_NM`.
- `SchoolSchedule`(인자 `AA_FROM_YMD`, `AA_TO_YMD`): `AA_YMD`(YYYYMMDD), `EVENT_NM`, `SBTR_DD_SC_NM`(값 `공휴일` / `휴업일` / `해당없음`), `ONE_GRADE_EVENT_YN`…`SIX_GRADE_EVENT_YN`(`Y`/`N`/`*`). 토요일에 `토요휴업일`이 들어 있다.
- 시간표 `elsTimetable`(초)/`misTimetable`(중)/`hisTimetable`(고)(인자 `TI_FROM_YMD`, `TI_TO_YMD`): `ALL_TI_YMD`, `GRADE`, `CLASS_NM`, `PERIO`, `ITRT_CNTNT`(과목명). **교사 이름 필드 없음.** 중학교 한 주 전체 학급 479건.
- `mealServiceDietInfo`(인자 `MLSV_FROM_YMD`, `MLSV_TO_YMD`): `MLSV_YMD`, `MMEAL_SC_NM`(조식/중식/석식), `DDISH_NM`(`<br/>`로 구분, 메뉴 뒤 괄호 안 알레르기 번호 예 `미니어묵우동- (1.5.6.7.9.18)`), `CAL_INFO`.

## Global Constraints

- 1·2단계 Global Constraints 유지.
- NEIS 인증키는 `device_local` `'neisApiKey'`에만 저장(백업 제외). URL에 키가 들어가므로 키를 화면·로그·오류 문구에 출력하지 않는다.
- 학생 개인정보는 NEIS 요청에 절대 넣지 않는다(학교 코드·날짜만).
- `school_calendar`의 `source='manual'` 레코드와 `teacher_timetable`의 `source='manual'` 칸은 가져오기·재추정 때 바꾸지 않는다.
- 날짜 저장 형식은 `YYYY-MM-DD`. NEIS의 `YYYYMMDD`는 변환해서 저장.
- 공휴일 내장 목록은 양력 고정일만: 01-01, 03-01, 05-05, 06-06, 08-15, 10-03, 10-09, 12-25. 설·추석·부처님오신날·대체공휴일·선거일은 NEIS 학사일정으로만 알 수 있다(학사일정이 없으면 평일로 간주하고 경고 — 4단계).

## Review Focus

1. 키가 없거나 틀림 → "NEIS 인증키가 올바르지 않습니다." 같은 한국어 오류, 기존 저장 데이터는 그대로. (Task 2, Task 3 테스트)
2. 인터넷 끊김 → 가져오기 실패 문구, 이전에 받은 급식·시간표·학사일정은 계속 보임. (Task 5, Task 7 테스트)
3. 같은 날 행사 여러 개, 휴업일과 행사가 같은 날 → 모두 저장, 그날은 비수업일. (Task 3, Task 4 테스트)
4. 직접 입력한 일정·직접 고친 시간표 칸 → 다시 가져오기·다시 추정해도 유지. (Task 3, Task 6 테스트)
5. 1000건 넘는 응답 → 다음 쪽을 이어 받아 빠짐없이. (Task 2 테스트)

---

## File Structure

```
src/lib/settings.ts                    # 단일 설정 행 읽기·갱신, NEIS 키
src/lib/neis/client.ts                 # neisRequest(쪽 나눔·오류), NeisError
src/lib/neis/school.ts                 # searchSchools
src/lib/neis/schedule.ts               # 학사일정 가져오기 → school_calendar
src/lib/neis/meal.ts                   # 급식 가져오기·해석 → neis_cache
src/lib/neis/timetable.ts              # 전체 학급 시간표 가져오기 → neis_cache
src/lib/neis/fixtures.ts               # 테스트용 실측 형태 응답 생성기
src/lib/schoolDays.ts                  # 수업일 판정
src/lib/timetable/estimate.ts          # 내 시간표 추정·병합·저장
src/pages/settings/SchoolSettings.tsx  # 학교·NEIS 카드
src/pages/settings/MyTimetable.tsx     # 내 시간표 카드
```

---

### Task 1: 설정 행과 NEIS 키

**Files:**
- Create: `src/lib/settings.ts`
- Modify: `src/lib/db/types.ts` (`AppSettingsRec`에 `school_kind: '초등학교' | '중학교' | '고등학교' | ''` 추가, `SchoolCalendarRec`에 `grades: number[] | null` 추가)
- Test: `src/lib/settings.test.ts`

**Interfaces:**
- Consumes: `APP_SETTINGS_ID`(1단계 `'app'`), `newRecord`, `save`
- Produces:
  - `DEFAULT_SETTINGS: Omit<AppSettingsRec, keyof BaseRecord>` — 문자열 `''`, `ai_enabled: false`, `mask_names: true`, `nuga_max_chars: null`, 배열 `[]`, `pin_enabled: false`, `pin_lock_on_resume: true`, `backup_keep_count: 14`, `school_kind: ''`
  - `getSettings(db): Promise<AppSettingsRec>` — 없으면 기본값으로 만들어 저장 후 반환(id `'app'`)
  - `updateSettings(db, patch: Partial<Omit<AppSettingsRec, keyof BaseRecord>>): Promise<AppSettingsRec>`
  - `getNeisKey(db): Promise<string>`(없으면 `''`), `setNeisKey(db, key: string): Promise<void>`(앞뒤 공백 제거)

- [ ] **Step 1: 실패하는 테스트**

```ts
test('설정이 없으면 기본값 행을 만든다(id app, 보관 14, 이름 가리기 켜짐)')
test('updateSettings는 지정한 칸만 바꾸고 updated_at을 갱신한다')
test('NEIS 키는 device_local에 저장되고 백업 스냅샷에 들어가지 않는다')   // exportSnapshot JSON에 키 문자열 없음
test('NEIS 키 앞뒤 공백 제거, 없으면 빈 문자열')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS(+ 기존 스위트).
- [ ] **Step 5:** 커밋 `feat(settings): single settings row and NEIS key storage`

### Task 2: NEIS 요청 기본기

**Files:**
- Create: `src/lib/neis/client.ts`, `src/lib/neis/fixtures.ts`, `src/lib/neis/school.ts`
- Test: `src/lib/neis/client.test.ts`

**Interfaces:**
- Produces:
  - `type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>`
  - `class NeisError extends Error { code: string }`
  - `neisRequest<T>(service: string, params: Record<string, string>, opts: { key: string; fetch?: FetchLike }): Promise<T[]>` — `pSize=1000`, `pIndex` 1부터 `list_total_count`를 채울 때까지 반복. `INFO-200`(데이터 없음) → `[]`. `ERROR-290`(키 오류) → `NeisError('NEIS 인증키가 올바르지 않습니다.')`. 그 밖의 `ERROR-*` → `NeisError('NEIS 요청 오류: {MESSAGE}')`. 네트워크 실패·`ok=false` → `NeisError('NEIS에 연결하지 못했습니다. 인터넷 연결을 확인하세요.')`. 키가 빈 문자열이면 요청하지 않고 `NeisError('NEIS 인증키를 먼저 입력하세요.')`. 오류 문구에 URL·키를 넣지 않는다.
  - `fixtures.ts`: `neisPage(service, rows, total?)`, `neisResult(code, message)`, `fakeFetch(handler: (url: URL) => unknown): FetchLike` — 실측 응답 형태 그대로.
  - `interface SchoolHit { officeCode: string; officeName: string; schoolCode: string; name: string; kind: string; address: string }`
  - `searchSchools(name: string, opts): Promise<SchoolHit[]>` — `schoolInfo` `SCHUL_NM`; 학교 코드가 공백뿐인 행은 제외(실측에 존재).

- [ ] **Step 1: 실패하는 테스트**

```ts
test('URL에 Type=json, pSize=1000, KEY, 인자가 들어간다')
test('list_total_count 2300이면 pIndex 1·2·3을 받아 2300건을 합친다')
test('INFO-200이면 빈 배열')
test('ERROR-290이면 "NEIS 인증키가 올바르지 않습니다."')
test('fetch가 throw하면 연결 오류 문구, 메시지에 키가 없다')
test('키가 비면 요청하지 않고 "NEIS 인증키를 먼저 입력하세요."')
test('searchSchools는 학교 코드가 빈 행을 뺀다')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(neis): paginated request with Korean error messages and school search`

### Task 3: 학사일정 가져오기

**Files:**
- Create: `src/lib/neis/schedule.ts`
- Test: `src/lib/neis/schedule.test.ts`

**Interfaces:**
- Consumes: `neisRequest`, `getSettings`, `getNeisKey`, `newRecord`, `softDelete`
- Produces:
  - `mapScheduleRow(row): Omit<SchoolCalendarRec, keyof BaseRecord>` — `date` = `AA_YMD` 변환, `title` = `EVENT_NM`, `source: 'neis'`, `grades` = Y인 학년 번호들(모두 N/*이면 `null` = 전체), 분류:
    - `SBTR_DD_SC_NM === '해당없음'` → `type: '행사'`, `is_class_day: true`
    - `'휴업일'`이고 이름에 `방학` 포함 → `type: '방학'`, `is_class_day: false`
    - `'휴업일'` 또는 `'공휴일'` → `type: '휴업일'`, `is_class_day: false`
  - `importSchoolSchedule(db, schoolYear: number, opts?: { fetch?: FetchLike }): Promise<{ count: number }>` — 범위 `{schoolYear}0301`~`{schoolYear+1}0228`. 설정에 학교가 없으면 `Error('먼저 학교를 선택하세요.')`. 요청이 성공한 뒤에만, 범위 안 `source='neis'` 레코드를 softDelete하고 새로 추가(한 트랜잭션). manual은 건드리지 않는다. 실패하면 아무것도 바꾸지 않는다.
  - `listCalendar(db, from: string, to: string): Promise<SchoolCalendarRec[]>` — 삭제 제외, 날짜순.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('해당없음은 행사·수업일, 공휴일·휴업일은 비수업일, 방학 이름은 방학')
test('학년 행사 표시: THREE만 Y면 grades [3], 모두 N/*이면 null')
test('같은 날 행사 2개면 2개 저장')
test('다시 가져오면 neis 레코드는 바뀌고 manual 레코드는 남는다')
test('키 오류면 기존 neis 레코드가 그대로다')
test('학교 미선택이면 "먼저 학교를 선택하세요."')
test('요청 범위는 3월 1일부터 다음 해 2월 28일')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(neis): import school schedule into calendar keeping manual entries`

### Task 4: 수업일 판정

**Files:**
- Create: `src/lib/schoolDays.ts`
- Test: `src/lib/schoolDays.test.ts`

**Interfaces:**
- Consumes: `SchoolCalendarRec`
- Produces:
  - `FIXED_HOLIDAYS = ['01-01','03-01','05-05','06-06','08-15','10-03','10-09','12-25']`
  - `class SchoolDays { constructor(calendar: SchoolCalendarRec[]); isClassDay(date: string): boolean; countClassDays(start: string, end: string): number; nextClassDay(date: string): string; classDaysBetween(start: string, end: string): string[]; hasCalendarFor(date: string): boolean }`
    - `isClassDay`: 토·일 false; 고정 공휴일 false; 그 날짜에 삭제 안 된 레코드 중 `is_class_day=false`가 하나라도 있으면 false; 아니면 true.
    - `countClassDays(start, end)`: 양 끝 포함, start > end면 0.
    - `nextClassDay(date)`: date 다음 날부터 첫 수업일(최대 400일 탐색 후 Error).
    - `classDaysBetween`: 양 끝 포함 수업일 목록.
    - `hasCalendarFor(date)`: 그 학년도(3월 기준)의 neis 레코드가 하나라도 있으면 true(4단계 "학사일정 미등록" 경고용).
  - `toYmd(d: Date): string`, `addDays(date: string, n: number): string`, `weekday(date: string): number`(월=1…일=7) — 현지 시간대 문제를 피하려고 날짜 문자열을 UTC 정오로 계산.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('주말은 비수업일, 평일은 수업일')
test('고정 공휴일(10-09)은 학사일정이 없어도 비수업일')
test('휴업일 레코드가 있는 날은 비수업일, 같은 날 행사 레코드가 함께 있어도 비수업일')
test('삭제 표시된 휴업일 레코드는 무시')
test('countClassDays: 2026-11-06(금)~2026-11-10(화) = 3')
test('nextClassDay: 금요일 다음은 월요일, 다음 월요일이 휴업일이면 화요일')
test('classDaysBetween은 주말·휴업일을 뺀다')
test('hasCalendarFor: 그 학년도 neis 레코드가 있으면 true, 다음 해 1월도 같은 학년도로 본다')
test('weekday와 addDays는 월말·연말을 넘어 정확하다')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(schooldays): class-day rules from calendar and fixed holidays`

### Task 5: 급식·전체 학급 시간표 가져오기

**Files:**
- Create: `src/lib/neis/meal.ts`, `src/lib/neis/timetable.ts`
- Test: `src/lib/neis/meal.test.ts`, `src/lib/neis/timetable.test.ts`

**Interfaces:**
- Consumes: `neisRequest`, `getSettings`, `getNeisKey`, `addDays`, `weekday`
- Produces:
  - `interface MealDish { name: string; allergies: number[] }`, `interface Meal { date: string; kind: string; dishes: MealDish[]; calories: string }`
  - `parseDishes(ddish: string): MealDish[]` — `<br/>`(대소문자·`<br>` 포함)로 나눔, 끝의 `(숫자.숫자…)`를 알레르기로, 이름 끝의 `-`·공백·`*` 제거, 빈 항목 제외.
  - `weekRange(date: string): { from: string; to: string }` — 그 주 월~금.
  - `fetchMeals(db, date: string, opts?): Promise<Meal[]>` — 그 주 범위 요청 → `neis_cache` `kind='meal'`, `range_key='{from}~{to}'`로 저장(같은 키는 교체) → 반환.
  - `interface ClassPeriod { date: string; grade: number; classNo: string; period: number; subject: string }`
  - `timetableService(kind: string): 'elsTimetable' | 'misTimetable' | 'hisTimetable'` — 초등학교/중학교/고등학교, 그 밖은 `Error('학교 종류를 알 수 없어 시간표를 가져올 수 없습니다.')`
  - `fetchWeekTimetable(db, date: string, opts?): Promise<ClassPeriod[]>` — 그 주 전체 학급, `neis_cache` `kind='class_timetable'`로 저장. 과목명은 앞뒤 공백 제거.
  - `getCachedMeals(db, date): Promise<Meal[] | null>`, `getCachedTimetable(db, date): Promise<ClassPeriod[] | null>` — 오프라인 표시용(요청 없음).

- [ ] **Step 1: 실패하는 테스트**

```ts
test('parseDishes: 실측 문자열 → [{귀리현미밥,[]},{미니어묵우동,[1,5,6,7,9,18]},…{김치,[9]}]')
test('weekRange: 2026-11-05(목) → 2026-11-02 ~ 2026-11-06, 일요일은 그 주 월~금')
test('fetchMeals는 캐시에 저장하고 같은 주를 다시 받으면 교체한다')
test('네트워크 실패 시 fetchMeals는 오류, getCachedMeals는 이전 값을 돌려준다')
test('중학교는 misTimetable, 고등학교는 hisTimetable 요청')
test('시간표 479건(1000 미만)과 1200건(2쪽) 모두 빠짐없이 저장')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(neis): weekly meals with allergies and whole-school timetable cache`

### Task 6: 내 시간표 추정

**Files:**
- Create: `src/lib/timetable/estimate.ts`
- Test: `src/lib/timetable/estimate.test.ts`

**Interfaces:**
- Consumes: `ClassPeriod`, `weekday`, `TeacherTimetableRec`, `newRecord`, `softDelete`
- Produces:
  - `classLabelOf(grade: number, classNo: string): string` → `'1-3'`
  - `subjectsForClasses(periods: ClassPeriod[], classLabels: string[]): string[]` — 고른 학급들에 나오는 과목명 목록(가나다순, 중복 제거)
  - `interface Slot { weekday: number; period: number; subject: string; class_label: string }`
  - `estimateSlots(periods: ClassPeriod[], subjects: string[], classLabels: string[]): { slots: Slot[]; conflicts: { weekday: number; period: number; labels: string[] }[] }` — 과목명 **정확히 일치**만. 같은 요일·교시에 여러 학급이 걸리면 모두 slots에 넣고 conflicts에 기록. 정렬: 요일 → 교시 → 학급.
  - `applyEstimate(db, slots: Slot[]): Promise<void>` — 기존 `estimated` 칸은 softDelete 후 새로 추가. 같은 요일·교시에 `manual` 칸이 있으면 그 칸의 추정은 넣지 않는다.
  - `saveManualSlot(db, slot: Slot & { note?: string }): Promise<void>` — 같은 요일·교시 기존 칸(추정·수동 모두)을 softDelete하고 `manual`로 추가. 과목이 빈 문자열이면 "수업 없음"으로 저장(`subject:''`, manual)해 재추정이 칸을 채우지 않게 한다.
  - `listMyTimetable(db): Promise<TeacherTimetableRec[]>`

- [ ] **Step 1: 실패하는 테스트**

```ts
test('subjectsForClasses는 고른 학급의 과목만 가나다순으로')
test('estimateSlots: 1-1·1-2 수학 → 해당 요일·교시만, 과학은 제외')
test('같은 교시 두 학급이면 conflicts에 기록')
test('과목명은 정확히 일치만(수학 ≠ 공통수학2)')
test('applyEstimate 두 번 해도 추정 칸이 중복되지 않는다')
test('수동으로 고친 칸과 "수업 없음" 칸은 다시 추정해도 유지된다')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(timetable): estimate my timetable from class timetables, keep manual cells`

### Task 7: 설정 화면 — 학교·NEIS 카드

**Files:**
- Create: `src/pages/settings/SchoolSettings.tsx`
- Modify: `src/pages/settings/SettingsPage.tsx`(백업 카드 위에 배치), `src/app/context.tsx`(선택: `NetContext`로 `FetchLike` 주입, 기본 `window.fetch`)
- Test: `src/pages/settings/SchoolSettings.test.tsx`

화면 사양:
- **NEIS 인증키:** 비밀번호 입력칸(라벨 "NEIS 인증키") + "저장". 저장되어 있으면 "인증키가 저장되어 있습니다."(값은 보여주지 않음). 안내 "인증키는 이 노트북에만 저장되고 백업에 들어가지 않습니다."
- **학교:** 검색칸(라벨 "학교 이름") + "검색" → 결과 목록(학교명 · 교육청 · 종류 · 주소) 각 행에 "선택". 선택하면 `updateSettings({ school_name, neis_office_code, neis_school_code, school_kind })`, "선택한 학교: {학교명}" 표시.
- **가져오기:** "학사일정 가져오기({학년도}학년도)" → "학사일정 {n}건을 가져왔습니다." / "이번 주 급식·시간표 가져오기" → "급식 {n}끼, 시간표 {m}칸을 가져왔습니다." 실패 시 오류 문구 그대로. 마지막 가져온 뒤 학사일정 미리보기: 오늘 이후 5건(`M/D 일정명`, 비수업일이면 뒤에 "(휴업)").
- 모든 요청은 주입된 fetch 사용(테스트는 `fakeFetch`).

- [ ] **Step 1: 실패하는 테스트**

```tsx
test('키 저장 후 값은 보이지 않고 "인증키가 저장되어 있습니다."')
test('학교 검색 → 선택하면 "선택한 학교: 가락중학교"이고 설정에 코드·종류가 저장된다')
test('학사일정 가져오기 → 건수 문구와 다가오는 일정 미리보기(휴업 표시)')
test('키 오류면 "NEIS 인증키가 올바르지 않습니다."')
test('오프라인(fetch 실패)이면 연결 오류 문구, 이전 미리보기는 유지')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** `npm test` PASS.
- [ ] **Step 5:** 커밋 `feat(settings): NEIS key, school search, schedule/meal/timetable import`

### Task 8: 설정 화면 — 내 시간표 카드

**Files:**
- Create: `src/pages/settings/MyTimetable.tsx`
- Modify: `src/pages/settings/SettingsPage.tsx`
- Test: `src/pages/settings/MyTimetable.test.tsx`

화면 사양:
- 캐시된 이번 주 시간표가 없으면 "먼저 '이번 주 급식·시간표 가져오기'를 하세요."
- **수업 학급:** 시간표에 나오는 학급(`1-1` 형식)을 체크박스로. **담당 과목:** 고른 학급에 나오는 과목을 체크박스로. 고른 값은 `updateSettings({ my_class_labels, my_subjects })`로 저장·복원.
- "시간표 추정" → `estimateSlots` + `applyEstimate`, 충돌이 있으면 "같은 시간에 여러 학급: {요일} {교시}교시 (1-1, 1-2)" 목록.
- 표: 열 월~금, 행 1~(최대 교시, 최소 7)교시. 칸 내용 `{학급} {과목}`, 수동 칸은 굵게. 칸 클릭 → 작은 편집 폼(학급, 과목, "수업 없음" 버튼, 저장) → `saveManualSlot`.

- [ ] **Step 1: 실패하는 테스트**

```tsx
test('캐시가 없으면 안내 문구')
test('학급을 고르면 그 학급의 과목만 체크박스로 보인다')
test('추정하면 표에 "1-1 수학"이 해당 칸에 나온다')
test('칸을 고쳐 저장하면 다시 추정해도 고친 값이 남는다')
test('충돌이 있으면 안내 목록이 보인다')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** `npm test` PASS.
- [ ] **Step 5:** 커밋 `feat(settings): my timetable estimate and manual edits`

### Task 9: 검증

- [ ] **Step 1:** `npm test` PASS, `npx tsc --noEmit` 0, `npm run build` 성공.
- [ ] **Step 2:** Playwright로 설정 화면(가짜 fetch를 주입할 수 없으므로 화면 구성·오류 문구만): 키 없이 가져오기 → "NEIS 인증키를 먼저 입력하세요." 확인, 콘솔 오류 0.
- [ ] **Step 3:** 실제 응답 호환성: 사용자 노트북 내장 브라우저에서 `neisRequest`가 만드는 URL과 같은 형식(키 없이, 공개 학교 1곳)으로 학사일정·급식·시간표를 받아, 그 JSON으로 `mapScheduleRow`·`parseDishes`·시간표 변환이 오류 없이 동작하는지 확인(결과 JSON을 임시 파일로 받아 vitest 한 번 실행, 파일은 저장소에 넣지 않음).
- [ ] **Step 4:** 커밋(필요 시) `chore: stage 3 verification fixes`
