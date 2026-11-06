# 2단계: 학급·학생 명단 · 엑셀 붙여넣기 · hwpx 표 생성 기반 · 명렬표 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학급을 만들고 학생 명단을 엑셀 붙여넣기로 등록·수정하며, 명렬표를 한글에서 바로 편집 가능한 hwpx(기본), A4 인쇄, 엑셀로 내보낸다.

**Architecture:** 명단 로직은 `src/lib/roster`(DB 접근은 1단계 `lib/db` 도우미 경유), 붙여넣기 해석은 순수 함수. hwpx는 한글이 만든 사용자 예시 파일에서 서식 정의(header.xml 등)만 추출해 저장소에 넣은 "기본 양식" 위에 본문(section0.xml)을 코드로 생성해 JSZip으로 묶는다. 명렬표는 그 위의 문서 모듈 하나.

**Tech Stack:** 1단계 스택 + `jszip@3.10.1`, 개발용 `@xmldom/xmldom@0.8.10`(테스트에서 XML 유효성 검사).

**Spec:** `docs/superpowers/specs/2026-11-04-class-manager-design.md` (개정 9). 이 계획은 14절 2번(학급·학생 + `lib/hwpx/build` 기반 + 명렬표 hwpx 출력), 5절 `classes`·`students`, 6.8절 명렬표, 6.10절 hwpx 공통, 7절 3번(학급 화면의 명단·명렬표 탭)을 구현한다. 자리배치·청소배치 탭은 8단계(이번에는 "준비 중").

## Global Constraints

- 1단계 Global Constraints 전부 유지(서버 없음, 한국어 문구, `lib/db` 경유, 레코드 공통 필드, HashRouter, 로컬 커밋만).
- hwpx 표는 실제 한글 표(`hp:tbl`)로 만든다. 그림으로 만들지 않는다.
- hwpx 압축 파일의 첫 항목은 `mimetype`(내용 `application/hwp+zip`), 무압축(STORE). 나머지는 DEFLATE.
- 기본 양식에는 사용자 예시의 본문·미리보기(Preview/)·작성자 정보를 넣지 않는다(학생 이름 포함 금지).
- 단위: HWPUNIT(1/7200인치). A4 = width `59528`, height `84188`. 기본 여백 좌우 `4251`, 위아래 `2834`, 머리말 `2834`, 꼬리말 `1417`(예시와 동일).
- 기본 양식 ID(예시 header.xml 기준): 테두리 없음 borderFill `1`, 가는 실선 사방 borderFill `3`; 가운데 정렬 paraPr `14`, 양쪽 정렬 paraPr `13`; 복제 기준 charPr `6`(맑은 고딕, fontRef hangul=2); charProperties 기존 개수 `12`.
- 용지 방향: 세로 `landscape="WIDELY"`, 가로 `landscape="NARROWLY"`(예시가 가로이며 NARROWLY). width/height 값은 방향과 무관하게 59528/84188 그대로.
- 학년도: 3월~12월은 그해, 1~2월은 전년도.

## Review Focus

1. 엑셀에서 복사한 내용에 머리글 줄, 빈 줄, 따옴표로 감싼 셀(셀 안 줄바꿈), 번호 앞뒤 공백, 마지막 줄바꿈 → 행이 어긋나지 않고 해석됨. (Task 2 테스트)
2. 이름·제목에 `&`, `<`, `>`, `"` → hwpx XML이 깨지지 않음. (Task 4 테스트)
3. 학생 40명 이상 → 명렬표가 다음 쪽으로 이어지고 머리글 줄이 반복됨(`repeatHeader="1"`, `pageBreak="CELL"`). (Task 5 테스트)
4. 같은 명단을 두 번 붙여넣기 → 학생이 중복 생성되지 않고 번호 기준으로 갱신됨. (Task 1 테스트)
5. 전출(재적 아님) 학생 → 명렬표에서 기본 제외, 명단에는 "전출"로 흐리게 표시. (Task 1, Task 7 테스트)

---

## File Structure

```
scripts/extract-hwpx-base.mjs           # 사용자 예시 hwpx → 기본 양식 파일 추출(1회 실행, 결과만 커밋)
src/lib/roster/
  schoolYear.ts                         # currentSchoolYear
  roster.ts                             # 학급·학생 저장소 함수
  paste.ts                              # TSV 해석과 명단 행 검증
src/lib/hwpx/
  base/                                 # 추출된 기본 양식(header.xml, version.xml, settings.xml,
                                        #   content.hpf, container.xml, container.rdf, manifest.xml,
                                        #   section-open.xml, secPr.xml)
  xml.ts                                # escapeXml, 문단·표 XML 생성
  charPr.ts                             # 글자 크기·굵기별 charPr 등록
  package.ts                            # hwpx 묶기
src/lib/xlsx/simple.ts                  # 단순 xlsx 쓰기(JSZip)
src/lib/docs/roster-doc.ts              # 명렬표 모델 → hwpx·xlsx
src/pages/class/ClassPage.tsx           # 학급 선택·생성, 탭
src/pages/class/RosterTab.tsx           # 명단 표, 붙여넣기 등록
src/pages/class/StudentDetail.tsx       # 인적사항 편집
src/pages/class/RosterDocTab.tsx        # 명렬표 옵션·내보내기·인쇄
```

---

### Task 1: 학급·학생 저장소 함수

**Files:**
- Create: `src/lib/roster/schoolYear.ts`, `src/lib/roster/roster.ts`
- Test: `src/lib/roster/roster.test.ts`

**Interfaces:**
- Consumes: `AppDB`, `newRecord`, `save`, `softDelete`, `listActive`, `ClassRec`, `StudentRec`
- Produces:
  - `currentSchoolYear(now?: Date): number`
  - `type StudentFields = Omit<StudentRec, keyof BaseRecord | 'class_id'>`
  - `emptyStudent(number: number, name: string): StudentFields` — 나머지 문자열 `''`, `active: true`
  - `createClass(db, input: { school_year: number; grade: number; class_no: number }): Promise<ClassRec>` — 같은 학년도·학년·반(삭제 안 된 것)이 있으면 `Error('이미 있는 학급입니다.')`
  - `listClasses(db): Promise<ClassRec[]>` — 삭제 제외, 학년도 내림차순 → 학년 → 반 오름차순
  - `classLabel(c: ClassRec): string` → `'1학년 5반'`
  - `listStudents(db, classId: string, opts?: { includeInactive?: boolean }): Promise<StudentRec[]>` — 삭제 제외, 기본 `includeInactive: true`, 번호 오름차순
  - `saveStudent(db, classId: string, fields: StudentFields, id?: string): Promise<StudentRec>` — 같은 학급에 같은 번호(다른 id, 삭제 안 됨)가 있으면 `Error('같은 번호의 학생이 이미 있습니다.')`
  - `deleteStudent(db, id: string): Promise<void>` — softDelete
  - `upsertRosterRows(db, classId: string, rows: RosterRow[]): Promise<{ added: number; updated: number }>` — 번호가 같은 기존 학생은 이름·보호자 성함·보호자 번호만 갱신(빈 칸은 기존 값 유지), 없으면 추가. 한 트랜잭션.
  - `interface RosterRow { number: number; name: string; guardian_name: string; guardian_phone: string }`
  - `getCurrentClassId(db): Promise<string | undefined>`, `setCurrentClassId(db, id: string): Promise<void>` — `device_local` `'currentClassId'`

- [ ] **Step 1: 실패하는 테스트**

```ts
test('학년도: 2026-03-02 → 2026, 2027-02-10 → 2026, 2026-12-31 → 2026')
test('같은 학급을 두 번 만들면 오류')
test('listClasses 정렬: 학년도 내림차순, 학년·반 오름차순')
test('classLabel은 "1학년 5반"')
test('listStudents는 번호순이고 삭제된 학생을 뺀다; includeInactive:false면 전출 학생도 뺀다')
test('saveStudent는 같은 학급 같은 번호를 거부한다(수정 중인 자기 자신은 허용)')
test('upsertRosterRows 두 번 실행해도 학생 수가 같고 이름이 갱신된다', async () => {
  // 1회: [{1,'가','',''},{2,'나','',''}] → added 2
  // 2회: [{1,'가가','보호자','010-1'},{2,'나','',''}] → added 0, updated 2, 학생 2명, 1번 이름 '가가'
})
test('upsertRosterRows는 빈 보호자 칸으로 기존 값을 지우지 않는다')
test('현재 학급 id를 저장하고 읽는다')
```

- [ ] **Step 2:** `npx vitest run src/lib/roster` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(roster): classes and students repository`

### Task 2: 엑셀 붙여넣기 해석

**Files:**
- Create: `src/lib/roster/paste.ts`
- Test: `src/lib/roster/paste.test.ts`

**Interfaces:**
- Consumes: `RosterRow`
- Produces:
  - `parseTsv(text: string): string[][]` — 엑셀 클립보드 형식: 탭 구분, `\r\n`/`\n` 줄 구분, 큰따옴표로 감싼 셀은 안의 탭·줄바꿈을 그대로 두고 `""`는 `"`로. 끝의 빈 줄 제거.
  - `interface PasteResult { rows: RosterRow[]; errors: { line: number; message: string }[] }`
  - `toRosterRows(cells: string[][]): PasteResult` — 열 순서 `번호, 이름, 보호자 성함, 보호자 번호`(뒤 두 칸은 없어도 됨). 모든 칸은 앞뒤 공백 제거. 첫 줄의 첫 칸이 숫자가 아니면 머리글로 보고 건너뛴다. 모든 칸이 빈 줄은 건너뛴다. `line`은 1부터 시작하는 원문 줄 번호.

오류 문구(정확히): 번호가 양의 정수가 아님 `'번호는 1 이상의 정수여야 합니다.'`, 이름 없음 `'이름이 비어 있습니다.'`, 같은 붙여넣기 안의 중복 번호 `'번호 {n}이(가) 중복됩니다.'`(두 번째 이후 줄에).

- [ ] **Step 1: 실패하는 테스트**

```ts
test('탭과 CRLF를 나눈다', () => expect(parseTsv('1\t가\r\n2\t나\r\n')).toEqual([['1','가'],['2','나']]))
test('따옴표 셀 안의 줄바꿈과 탭, "" 이스케이프', () =>
  expect(parseTsv('1\t"김\n민"\t"a\tb"\t"말""함"\n')).toEqual([['1','김\n민','a\tb','말"함']]))
test('머리글 줄을 건너뛴다', () => expect(toRosterRows(parseTsv('번호\t이름\n1\t가')).rows).toEqual([{ number: 1, name: '가', guardian_name: '', guardian_phone: '' }]))
test('빈 줄과 앞뒤 공백', () => expect(toRosterRows(parseTsv(' 1 \t 가 \n\n2\t나\t보호\t010')).rows).toHaveLength(2))
test('번호 오류·이름 없음·중복 번호를 줄 번호와 함께 알려준다', () => {
  const r = toRosterRows(parseTsv('1\t가\nx\t나\n3\t\n1\t다'))
  expect(r.errors).toEqual([
    { line: 2, message: '번호는 1 이상의 정수여야 합니다.' },
    { line: 3, message: '이름이 비어 있습니다.' },
    { line: 4, message: '번호 1이(가) 중복됩니다.' },
  ])
})
test('번호 "05"는 5, "1.5"는 오류')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(roster): parse spreadsheet paste into roster rows`

### Task 3: hwpx 기본 양식 추출과 패키징

**Files:**
- Create: `scripts/extract-hwpx-base.mjs`, `src/lib/hwpx/base/*`(스크립트 출력), `src/lib/hwpx/package.ts`, `src/vite-env.d.ts`(`/// <reference types="vite/client" />`, `?raw` 타입)
- Test: `src/lib/hwpx/package.test.ts`

**Interfaces:**
- Produces:
  - `interface HwpxDoc { landscape: boolean; bodyXml: string; charPrXml: string[]; previewText: string; title: string }` — `bodyXml`은 secPr 문단 **뒤에** 이어질 `hp:p` 문단들, `charPrXml`은 header에 덧붙일 `hh:charPr` 요소들(id는 12부터 연속).
  - `buildHwpx(doc: HwpxDoc, now?: Date): Promise<Uint8Array>`
  - `BASE_CHARPR_COUNT = 12`

추출 스크립트 동작(`node scripts/extract-hwpx-base.mjs <예시.hwpx> src/lib/hwpx/base`):
- 그대로 복사: `version.xml`, `Contents/header.xml` → `header.xml`, `META-INF/container.rdf`, `META-INF/manifest.xml`.
- `META-INF/container.xml` → `container.xml`: `Preview/PrvText.txt` rootfile은 유지(우리가 PrvText를 넣는다).
- `settings.xml`: `CaretPosition`을 `listIDRef="0" paraIDRef="0" pos="0"`으로.
- `Contents/content.hpf` → `content.hpf`: `creator`·`lastsaveby` 값 비움, `CreatedDate`·`ModifiedDate` 값을 `{{DATE}}`, `date` 값을 빈 문자열로, `opf:title` 내용을 `{{TITLE}}`로.
- `Contents/section0.xml`에서: 여는 `<hs:sec …>` 태그를 `section-open.xml`로, 첫 `<hp:secPr`부터 그 뒤 `</hp:ctrl>`까지를 `secPr.xml`로. 본문은 저장하지 않는다.
- 추출 후 base 폴더의 어떤 파일에도 `<hp:t>`가 없음을 스크립트가 확인하고, 있으면 실패.

`buildHwpx` 조립:
- section0.xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>` + section-open + `<hp:p id="0" paraPrIDRef="13" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">` + secPr(landscape 값 교체) + `</hp:run></hp:p>` + bodyXml + `</hs:sec>`
- header.xml: `charPrXml`를 `</hh:charProperties>` 앞에 삽입하고 `charProperties itemCnt`를 `12 + charPrXml.length`로.
- content.hpf: `{{DATE}}` → ISO(초 단위, `Z`), `{{TITLE}}` → 제목(escape).
- `Preview/PrvText.txt` = previewText.
- 압축 순서: `mimetype`(STORE), `version.xml`, `Contents/header.xml`, `Contents/section0.xml`, `Preview/PrvText.txt`, `settings.xml`, `META-INF/container.rdf`, `Contents/content.hpf`, `META-INF/container.xml`, `META-INF/manifest.xml`.

- [ ] **Step 1:** devDependency `@xmldom/xmldom@0.8.10`, dependency `jszip@3.10.1` 설치. 추출 스크립트를 사용자 예시(`/mnt/user-data/attachments/…/1426ba80-_____10_.hwpx`)로 1회 실행해 base 파일 생성. 예시 파일 자체는 저장소에 넣지 않는다.
- [ ] **Step 2: 실패하는 테스트**

```ts
test('첫 항목은 무압축 mimetype', async () => { /* JSZip.loadAsync → Object.keys(files)[0]==='mimetype', 내용 'application/hwp+zip', 원시 바이트 30~37 오프셋에 압축방식 0 */ })
test('모든 XML이 올바른 XML이다')            // xmldom DOMParser, onError 수집 0건
test('charPr를 넣으면 itemCnt와 개수가 맞는다') // 2개 추가 → itemCnt="14", <hh:charPr 14개
test('세로는 WIDELY, 가로는 NARROWLY')
test('content.hpf에 날짜와 제목이 들어가고 {{ 자리표시자가 남지 않는다')
test('기본 양식 파일에 본문 글자(<hp:t>)가 없다')   // base/*.xml raw import 검사
test('본문 문단이 secPr 문단 뒤에 들어간다')
```

- [ ] **Step 3:** FAIL. **Step 4:** 구현(`?raw` import). **Step 5:** PASS.
- [ ] **Step 6:** 커밋 `feat(hwpx): base template extracted from a Hangul-made file and package builder`

### Task 4: hwpx 문단·표 XML과 글자 모양 등록

**Files:**
- Create: `src/lib/hwpx/xml.ts`, `src/lib/hwpx/charPr.ts`
- Test: `src/lib/hwpx/xml.test.ts`

**Interfaces:**
- Consumes: `BASE_CHARPR_COUNT`
- Produces:
  - `escapeXml(s: string): string` — `& < > " '`
  - `class CharPrRegistry { id(sizePt: number, bold?: boolean): number; xml(): string[] }` — 같은 (크기, 굵기)는 같은 id. id는 12부터. 각 요소는 기본 양식 charPr 6을 복제해 `id`, `height = sizePt*100`으로 바꾸고 bold면 `<hh:offset …/>` 바로 뒤에 `<hh:bold/>`를 넣는다(charPr 6 원문은 Task 3 base header에서 읽는다).
  - `paragraphXml(text: string, opts: { charPr: number; paraPr?: number }): string` — 기본 paraPr 13. 줄바꿈 `\n`은 `<hp:lineBreak/>`.
  - `interface TableCell { text: string; charPr: number; paraPr?: number; borderFill?: number; colSpan?: number }`
  - `tableXml(t: { rows: TableCell[][]; colWidths: number[]; rowHeights: number[]; repeatHeader?: boolean; borderFill?: number }): string` — 문단 하나(`hp:p` paraPr 14)에 `hp:run` → `hp:tbl`을 넣은 XML. 표 속성: `rowCnt`, `colCnt`, `cellSpacing="0"`, `borderFillIDRef`(기본 3), `repeatHeader`(기본 1), `pageBreak="CELL"`, `<hp:pos treatAsChar="1" …>`, `hp:sz width`=열 너비 합, `height`=행 높이 합. 셀마다 `hp:cellAddr colAddr rowAddr`, `hp:cellSpan`, `hp:cellSz`(colSpan이면 너비 합), `hp:cellMargin left="510" right="510" top="141" bottom="141"`, `subList vertAlign="CENTER"`, 셀 문단 기본 paraPr 14. `hp:tbl id`와 `hp:p id`는 호출마다 증가하는 정수.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('escapeXml', () => expect(escapeXml(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&apos;'))
test('같은 크기·굵기는 같은 charPr id, 다르면 새 id(12부터)')
test('굵은 charPr에는 <hh:bold/>가 offset 뒤에 있다')
test('tableXml: 2행×3열이면 rowCnt=2 colCnt=3, 셀 6개, cellAddr가 격자를 빠짐없이 덮는다')
test('colSpan 셀은 cellSpan colSpan=2, cellSz width가 두 열 합')
test('특수문자 이름이 든 표도 XML 파싱 오류가 없다')   // '김&<이>' → DOMParser 오류 0
test('paragraphXml의 줄바꿈은 lineBreak')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(hwpx): paragraph and table xml builders with char style registry`

### Task 5: 명렬표 문서(hwpx·xlsx)

**Files:**
- Create: `src/lib/xlsx/simple.ts`, `src/lib/docs/roster-doc.ts`
- Test: `src/lib/xlsx/simple.test.ts`, `src/lib/docs/roster-doc.test.ts`

**Interfaces:**
- Consumes: Task 3·4 전부, `ClassRec`, `StudentRec`, `classLabel`
- Produces:
  - `writeSimpleXlsx(sheetName: string, rows: string[][]): Promise<Uint8Array>` — 최소 xlsx(`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheet1.xml`, 문자열은 `inlineStr`), 첫 행 굵게 불필요.
  - `interface RosterDocOptions { title: string; blankColumns: number; fontSizePt: number; includeInactive: boolean }`
  - `defaultRosterDocOptions(c: ClassRec): RosterDocOptions` → `{ title: '{학년}학년 {반}반 명렬표', blankColumns: 3, fontSizePt: 11, includeInactive: false }`
  - `rosterTable(students: StudentRec[], opts: RosterDocOptions): string[][]` — 첫 행 `['번호', '이름', '', '', …]`(빈 열 수만큼), 이후 학생 행. `includeInactive`가 false면 `active=false` 제외.
  - `buildRosterHwpx(students: StudentRec[], opts: RosterDocOptions, now?: Date): Promise<Uint8Array>`
  - `buildRosterXlsx(students: StudentRec[], opts: RosterDocOptions): Promise<Uint8Array>`
  - `rosterFileName(c: ClassRec, ext: 'hwpx' | 'xlsx'): string` → `'1학년5반_명렬표.hwpx'`

hwpx 배치: A4 세로. 제목 문단(paraPr 14, `fontSizePt + 6`pt 굵게) → 빈 문단 → 표. 본문 폭 `59528 - 4251*2 = 51026`. 열 너비: 번호 `4000`, 이름 `9000`, 나머지는 빈 열에 균등(정수 나눗셈, 나머지는 마지막 열에). 빈 열 0이면 이름 열이 나머지 전부. 행 높이 `round(fontSizePt * 180)`(11pt → 1980). 머리글 행 반복(`repeatHeader=1`).

- [ ] **Step 1: 실패하는 테스트**

```ts
test('xlsx는 sheet1에 셀 값이 들어 있고 zip 구조가 올바르다')
test('기본 옵션 제목은 "1학년 5반 명렬표"')
test('rosterTable: 빈 열 3이면 머리글이 번호·이름·빈칸3, 전출 학생은 기본 제외')
test('열 너비 합이 51026이다(빈 열 0, 3, 7)')
test('45명 명렬표 hwpx: 표 rowCnt=46, repeatHeader="1", pageBreak="CELL", XML 오류 0')
test('제목의 특수문자도 hwpx가 깨지지 않는다')
test('파일명 "1학년5반_명렬표.hwpx"')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(docs): roster sheet as hwpx and xlsx`

### Task 6: 학급 화면 — 학급 선택·생성, 명단, 붙여넣기 등록, 학생 상세

**Files:**
- Create: `src/pages/class/ClassPage.tsx`, `src/pages/class/RosterTab.tsx`, `src/pages/class/StudentDetail.tsx`
- Modify: `src/App.tsx`(`/class` 경로를 `ClassPage`로), `src/styles.css`(표·탭 스타일)
- Test: `src/pages/class/ClassPage.test.tsx`

**Interfaces:**
- Consumes: Task 1·2 전부, `useDb`

화면 사양:
- 상단: 학급 선택 드롭다운(`classLabel`, 학년도 표시는 `2026학년도 1학년 5반`) + "학급 추가" → 학년도(기본 `currentSchoolYear()`), 학년, 반 입력 → "추가". 선택은 `setCurrentClassId`로 기억, 다음 방문에 복원. 학급이 없으면 "먼저 학급을 추가하세요."
- 탭 버튼: `명단 / 명렬표 / 자리배치 / 청소배치`. 자리배치·청소배치는 "준비 중입니다."
- 명단 탭: 표 열 `번호 | 이름 | 보호자 성함 | 보호자 번호`, 전출 학생 행은 `className="inactive"`이고 이름 옆에 "(전출)". 행을 누르면 학생 상세.
- "엑셀에서 붙여넣기" → 큰 텍스트 칸(라벨 "엑셀에서 복사한 내용"), 안내 문구 "열 순서: 번호, 이름, 보호자 성함, 보호자 번호". 입력하면 즉시 미리보기 표와 오류 목록(`{줄}번째 줄: {메시지}`). 오류가 있으면 "등록" 비활성. "등록" → `upsertRosterRows` → "새로 {added}명, 갱신 {updated}명을 등록했습니다."
- "학생 추가" → 빈 상세 폼.
- 학생 상세 폼 라벨(이 순서): 번호, 이름, 보호자 성함, 보호자 번호, 주소, 생년월일, 졸업학교, 연락처(HP), 취미, 특기, 통학방법, 교우관계, 참고사항, 재적(체크박스, 해제 = 전출). "저장", "삭제"(확인 문구 "이 학생을 삭제할까요?" — 화면 안 확인 버튼으로, 브라우저 confirm 대화상자 사용 금지), "닫기". 오류는 화면에 표시.

- [ ] **Step 1: 실패하는 테스트**(`App`이 아니라 `AppProviders`로 감싼 `ClassPage`)

```tsx
test('학급이 없으면 안내 문구, 학급 추가 후 선택된다')
test('붙여넣기 미리보기에 2명이 보이고 등록하면 명단에 번호순으로 나온다')
test('오류가 있으면 줄 번호와 함께 보이고 등록 버튼이 비활성')
test('같은 내용을 다시 등록하면 "새로 0명, 갱신 2명"')
test('학생 상세에서 재적을 해제하면 명단에 (전출) 표시')
test('같은 번호로 학생 추가 시 오류 문구')
test('선택한 학급이 다시 열어도 유지된다')     // 같은 db로 다시 render
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** `npm test` PASS.
- [ ] **Step 5:** 커밋 `feat(class): class selector, roster table, spreadsheet paste, student detail`

### Task 7: 명렬표 탭 — 옵션, hwpx·엑셀 내보내기, A4 인쇄

**Files:**
- Create: `src/pages/class/RosterDocTab.tsx`
- Modify: `src/pages/class/ClassPage.tsx`(탭 연결), `src/styles.css`(`@media print`)
- Test: `src/pages/class/RosterDocTab.test.tsx`

**Interfaces:**
- Consumes: Task 5 전부, `useFs().downloadFile`

화면 사양: 옵션 — 제목(기본값 `defaultRosterDocOptions`), 빈 열 개수(0~10), 글자 크기(9/10/11/12/14pt 선택), "전출 학생 포함" 체크. 미리보기 표(화면). 버튼 순서와 문구: **"hwpx로 내보내기"**(기본, 강조) / "A4 인쇄" / "엑셀로 내보내기". hwpx·엑셀은 `downloadFile(rosterFileName(…), bytes)`. 인쇄는 `window.print()`; 인쇄 시에는 미리보기 표(`.print-area`)만 보이고 A4 세로 여백 15mm.

- [ ] **Step 1: 실패하는 테스트**

```tsx
test('기본 제목과 빈 열 3이 채워져 있다')
test('hwpx로 내보내기 → 파일명 "1학년5반_명렬표.hwpx", 첫 바이트 PK')
test('엑셀로 내보내기 → "1학년5반_명렬표.xlsx"')
test('A4 인쇄는 window.print를 부른다')
test('전출 학생은 기본 미리보기에 없고, 포함 체크 시 보인다')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** `npm test` PASS.
- [ ] **Step 5:** 커밋 `feat(class): roster sheet tab with hwpx, xlsx export and print`

### Task 8: 검증과 사용자 확인용 파일

- [ ] **Step 1:** `npm test` 전부 PASS, `npx tsc --noEmit` 0, `npm run build` 성공.
- [ ] **Step 2:** 미리보기 서버 + Playwright로 `#/class`: 학급 추가 → 가상 이름 3명 붙여넣기 등록 → 명렬표 탭 스크린샷 확인, 콘솔 오류 0. 좁은 폭(390px)도 확인.
- [ ] **Step 3:** 가상 이름 30명(예: `학생01`~`학생30`, 한 명은 `김&<이>`)으로 `buildRosterHwpx` 결과를 `명렬표_확인용.hwpx`로 만들어 사용자 노트북 문서 폴더에 저장한다. 사용자에게 "한글에서 열리는지, 세로 방향인지, 표가 한 쪽에 들어가는지"만 확인을 요청한다(이 확인이 6.10절 완료 조건).
- [ ] **Step 4:** 커밋(필요 시) `chore: stage 2 verification fixes`
