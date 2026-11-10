# Watson 명령 홈 · 노트함 · 전달사항 · 반성문 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈을 명령 입력·대화 기록 중심으로 바꾸고(설계서 2), 노트함·전달사항·반성문·할 일 노트 연결(설계서 3)을 만든다. 버전 0.6.0, SHELL 4.

**Architecture:** 규칙 해석(`src/lib/command/*`)은 화면 없는 순수 함수(파서·자동완성·명령 표)로 두고, 실행(`run.ts`)이 DB에 저장·대화 기록·되돌리기를 맡는다. 새 자료는 Dexie v3 표 7개(백업 포함). 화면은 홈(대화+오른쪽 패널), 떠 있는 W 막대, 노트함, 반성문. AI는 기존 `createRoutedAiCaller`·이름 가림을 그대로 쓴다.

**Tech Stack:** React 18 + TS + Vite 5, Dexie 4(liveQuery), Vitest/jsdom + Testing Library, JSZip, Electron 33(SHELL 4: 폴더·PDF 용지).

**Spec:** `docs/superpowers/specs/2026-11-10-watson-command-home-design.md`(설계서 2), `docs/superpowers/specs/2026-11-10-watson-notes-reflection-design.md`(설계서 3, 설계서 2 §6의 notes를 대신함)

## Global Constraints

- 모든 글은 한국어. 색은 테마 토큰(`var(--…)`)만, 어둡게 테마 포함. 반성문 종이만 흰색 고정.
- 규칙 명령은 AI·인터넷 없이 동작. AI에 보내는 글은 `effectiveMask` 이름 가림을 거친다. 반성문 AI에는 사유만(이름·학번 금지).
- 새 표는 모두 `SYNCED_TABLES`에 넣고 `SCHEMA_VERSION`(백업 형식 번호)은 1 그대로. 없는 표는 빈 것으로 복원.
- 실행은 하나도 빠짐없이 `chat_log`에 남는다(성공·실패). 되돌리기는 10초, 그 실행의 undo만.
- 첨부 한 파일 50MB 초과는 거절('50MB까지 붙일 수 있습니다.').
- 새 IPC는 기능 확인 후 사용(옛 exe에서 오류 없이 안내). main.cjs `SHELL = 4`, 게시는 `MIN_SHELL=1`.
- 자동완성 후보는 최대 8개. 한글 조합 중(`isComposing`) Enter는 무시.
- 날짜 표기: 저장은 `YYYY-MM-DD`, 화면은 '11/12(목)', 반성문 양식은 '2026.11.10.'.
- 기준 날짜가 필요한 함수는 `today: string` 인자를 받는다(시험에서 2026-11-10 화요일로 고정).

## Review Focus

- 같은 이름·초성이 겹치는 학생(예: 김민준·김민지, '@ㄱㅁ')에서 /출결이 엉뚱한 학생에게 저장되면 안 된다 → 여럿 맞으면 실행하지 않고 고르게 함 (Task 3 `ambiguous` 시험).
- 기간이 해를 넘는 전달사항(12/30~1/2)과 끝일이 시작일보다 앞선 입력 → 날짜 판단이 맞고, 거꾸로면 저장 거절 (Task 1 시험).
- 노트를 지운 뒤 그 노트를 가리키는 할 일 → 흐린 글자로 보이고 누르면 오류 대신 '지운 노트입니다' (Task 1 `renderParts` 시험).
- 반성문 한 줄에 영문·숫자·공백이 섞인 경우 → 폭 표로 계산해도 넘침 판단이 보수적(넘칠 수 있으면 줄임) (Task 12 시험).
- 되돌리기를 10초 뒤에 누르거나 두 번 누르면 → 아무것도 안 하고 '되돌릴 수 없습니다' (Task 5 시험).

---

### Task 1: 자료 v3와 자료 함수(전달사항·할 일·내 일정·대화 기록·노트·반성문)

**Files:**
- Modify: `src/lib/db/types.ts`, `src/lib/db/schema.ts`
- Create: `src/lib/notices/notices.ts`, `src/lib/todos/todos.ts`, `src/lib/events/localEvents.ts`, `src/lib/command/chatLog.ts`, `src/lib/notes/notes.ts`, `src/lib/reflection/store.ts`
- Test: 같은 폴더 `*.test.ts`, `src/lib/backup/snapshot.test.ts`(새 표 포함 확인)

**Interfaces:**
- Produces (types.ts, 모두 `BaseRecord` 확장):
  - `NoticeItemRec { text; start_date; end_date; done: boolean; pinned: boolean; order: number }`
  - `NoteBlock { id: string; type: 'p'|'h1'|'h2'|'check'|'bullet'|'number'|'divider'|'file'|'folder'; text?: string; checked?: boolean; file_id?: string; path?: string }`
  - `NoteRec { title: string; blocks: NoteBlock[]; pinned: boolean }`
  - `NoteFileRec { note_id; name; mime; size: number; data: string /*base64*/ }`
  - `TodoPart = string | { note: string } | { student: string }`; `TodoRec { parts: TodoPart[]; due: string|null; done: boolean; done_at: string|null; order: number }`
  - `LocalEventRec { date; end_date: string|null; time: string|null; title; tag: '개인'|'업무'; google_id: string|null }`
  - `ChatRec { at: string; school_year: number; input: string; mode: 'rule'|'hybrid'|'ai'; summary: string; links: {label: string; to: string}[]; status: '성공'|'실패'|'확인 필요'; detail?: string }`
  - `ReflectionRec { student_id; date; reason; lines: string[]; t1: string; t2: string; mode: 'B4'|'A4' }`; `ReflectionPhraseRec { text: string; starred_at: string }`
  - schema `version(3)`: `notice_items: 'id, start_date, end_date'`, `notes: 'id, updated_at'`, `note_files: 'id, note_id'`, `todos: 'id, order'`, `local_events: 'id, date'`, `chat_log: 'id, at, school_year'`, `reflections: 'id, student_id, date'`, `reflection_phrases: 'id'` (SYNCED_TABLES에 8개 모두 추가)
  - notices.ts: `addNotice(db, {text, start_date, end_date?}): Promise<NoticeItemRec>` (end<start면 Error '끝 날짜가 시작 날짜보다 앞입니다.'), `noticesOn(db, date): Promise<NoticeItemRec[]>`(고정→order→완료 아래), `updateNotice(db, id, patch)`, `deleteNotice(db, id): Promise<() => Promise<void>>`(undo 반환), `moveNotice(db, date, id, dir: -1|1)`, `migrateBriefings(db): Promise<number>`(device_local 'briefingsMigrated' 표시, 두 번째는 0)
  - todos.ts: `addTodo(db, parts, due?)`, `listTodos(db)`(미완료 마감일 순 → 완료), `setTodoDone(db, id, done)`, `deleteTodo(db, id)`, `todosLinkingNote(db, noteId)`, `renderParts(parts, notes: Map<string, NoteRec>, students: Map<string, StudentRec>): {text: string; to?: string; dead?: boolean}[]` (노트 → `to: '/notes?id=<id>'`, 없는 노트 → `{text:'지운 노트', dead:true}`, 학생 → '3번 박도윤', to `/counseling?sid=`)
  - localEvents.ts: `addLocalEvent(db, input)`, `listLocalEvents(db, from, to)`(기간 겹치는 것)
  - chatLog.ts: `appendChat(db, entry: Omit<ChatRec, keyof BaseRecord|'at'|'school_year'>, now = new Date())`, `listChat(db, schoolYear)`, `deleteChat(db, id)`, `clearChatOn(db, ymd)`, `pruneChat(db, today)`(학년도 = 3월 기준, 지난 학년도 지움)
  - notes.ts: `createNote(db, title='새 노트')`, `saveNote(db, rec)`, `listNotes(db)`(고정 먼저, updated_at 내림), `deleteNote(db, id)`(첨부도 지움), `attachFile(db, noteId, file: {name, mime, bytes: Uint8Array}): Promise<NoteFileRec>`(50MB 넘으면 Error), `readFile(db, fileId): Promise<{name, mime, bytes}>`
  - store.ts(반성문): `saveReflection`, `listReflections(db, studentId?)`, `listPhrases(db)`(없으면 기본 16문장 넣고 돌려줌), `starPhrase(db, text)`, `unstarPhrase(db, id)`

- [ ] Step 1: 시험 작성 — `noticesOn('2026-12-31')`에 12/30~1/2 항목 포함, 1/3엔 없음; 고정이 맨 위, 완료가 맨 아래; 끝<시작 거절; `migrateBriefings` 조례 2·종례 1 → 3개(조례 먼저), 두 번째 호출 0; `renderParts`에 지운 노트 → dead; `pruneChat('2027-03-02')`가 2026학년도 기록 지움; `attachFile` 50MB+1 바이트 거절; 스냅샷에 `notice_items`·`notes`·`note_files` 들어감.
- [ ] Step 2: 실행 → FAIL(모듈 없음).
- [ ] Step 3: 구현(위 Interfaces 그대로; base64는 `btoa` 청크 변환).
- [ ] Step 4: `npx vitest run src/lib/notices src/lib/todos src/lib/events src/lib/command src/lib/notes src/lib/reflection src/lib/backup` → PASS.
- [ ] Step 5: 커밋 "자료 v3: 전달사항·할 일·내 일정·대화 기록·노트·반성문".

### Task 2: 한글 초성·사전·날짜 해석

**Files:** Create `src/lib/hangul.ts`, `src/lib/command/lexicon.ts`, `src/lib/command/dates.ts` (+tests)

**Interfaces:**
- `choseong(s: string): string`('박도윤'→'ㅂㄷㅇ'), `matchName(q: string, name: string): boolean`(포함·초성 접두)
- lexicon: `KINDS = ['결석','지각','조퇴','결과']`, `CATEGORIES = {미인정:'미인정', 질병:'질병', 출석인정:'출석인정', 인정:'출석인정', 기타:'기타'}`, `EVENT_TAGS = ['개인','업무']`, `parsePeriod(w): string|null`('3교시'→'3', '5~7교시'·'5-7교시'→'5~7')
- dates: `parseDateWords(words: string[], i: number, today: string): {date?: string; time?: string; used: number}` — 오늘·내일·모레·어제·그제, '11/12'·'11.12'·'12일'(이번 달, 지났으면 그대로), '월요일'/'월'(이번 주 그 요일, 지났으면 다음 주), '다음주 월'(다음 주), '15:30', '오후 3시', '오후 3시 반'·'3시 30분'.

- [ ] Step 1: 시험(today '2026-11-10' 화): 내일→11-11, 모레→11-12, '11/12'→2026-11-12, '12일'→2026-11-12, '월요일'→2026-11-16, '목'→2026-11-12, '다음주 월'→2026-11-16, '다음주 목'→2026-11-19, '오후 3시 반'→time '15:30' used 3, choseong('박도윤')='ㅂㄷㅇ', matchName('ㅂㄷ','박도윤') true, parsePeriod('5-7교시')='5~7'.
- [ ] Step 2: FAIL. Step 3: 구현. Step 4: PASS. Step 5: 커밋 "명령 사전·날짜·초성".

### Task 3: 입력 해석(parse)

**Files:** Create `src/lib/command/parse.ts` (+test)

**Interfaces:**
- `Token { kind: 'cmd'|'student'|'tag'|'word'; text: string; start: number; end: number }`; `tokenize(input): Token[]`(`/출결_추가`의 `_`는 띄어쓰기와 같음)
- `ParseCtx { students: StudentRec[]; notes: NoteRec[]; today: string }`
- `Parsed { cmd: string|null /*명령 id*/; sub: string|null; students: StudentRec[]; ambiguous: string[] /*여럿 맞은 @토큰*/; missing: string[] /*못 찾은 @토큰*/; tags: string[]; date: string; time: string|null; kind?: string; category?: string; period?: string|null; rest: string; errors: string[] }` (date 기본 today)
- `parseCommand(input, ctx, commandNames: Record<string, string>): Parsed` — commandNames는 이름·별칭 → id(Task 5 registry가 제공; 이 Task 시험은 `{출결:'attendance', 상담기록:'counsel'}`로)
- `@3`=번호 정확히, `@박도윤`=이름 정확히, 그 밖은 `matchName`; 둘 이상 맞으면 ambiguous.
- `describe(p: Parsed, label: (id:string)=>string): string` → '3번 박도윤 · 11/9(월) · 결석(질병) · 사유: 감기'

- [ ] Step 1: 시험 — '/출결 @3 결석 질병 감기' → cmd 'attendance', 학생 3번, kind 결석, category 질병, rest '감기', date today; '/출결 @김민 지각' (김민준·김민지) → ambiguous ['김민'], students []; '@없는이름' → missing; '/출결 @3 어제 조퇴 5~7교시 병원' → date 11-09, period '5~7'; describe 결과 문자열 정확히.
- [ ] Step 2~4: FAIL → 구현 → PASS. Step 5: 커밋 "입력 해석".

### Task 4: 자동완성(suggest)

**Files:** Create `src/lib/command/suggest.ts` (+test)

**Interfaces:**
- `Suggestion { label: string; insert: string; kind: 'cmd'|'sub'|'student'|'note'|'tag'|'word'; detail?: string }`
- `suggest(input: string, caret: number, ctx: ParseCtx & { commands: CommandDef[] }): Suggestion[]` (최대 8) — 커서 앞 토큰이 `/`→명령(세부 명령 있으면 띄어쓴 뒤 sub), `@`→학생(번호·이름·초성) **+ 노트 제목**(kind 'note', 학생 다음), `#`→그 명령 `tags`, 그 밖→그 명령 `expects(parsedSoFar)`가 돌려주는 낱말 중 앞글자 맞는 것.
- `applySuggestion(input, caret, s): { value: string; caret: number }` — 토큰을 바꾸고 뒤에 공백 하나.

- [ ] Step 1: 시험 — '/출' → 첫 후보 '/출결'; '/출결 @ㅂㄷ' → '3번 박도윤'; '/할일 보고 @2026' → note '2026 공문서'(kind note); '/출결 @3 결석 ' → ['미인정','질병','출석인정','기타']; apply 결과 '/출결 @3 ' caret 끝.
- [ ] Step 2~4: FAIL → 구현 → PASS. Step 5: 커밋 "자동완성".

### Task 5: 명령 표와 실행(규칙 명령)

**Files:** Create `src/lib/command/registry.ts`, `src/lib/command/run.ts` (+tests)

**Interfaces:**
- `CommandDef { id; names: string[]; group: string; mode: 'rule'|'hybrid'|'ai'; help: string; subs?: string[]; tags?: string[]; expects?(p: Parsed): string[]; needs(p: Parsed): string|null /*빠진 것 안내, 없으면 null*/; run(p: Parsed, env: RunEnv): Promise<RunResult> }`
- `RunEnv { db: AppDB; today: string; classId: string; ai?: AiCaller; navigate(to: string): void }`
- `RunResult { summary: string; links: {label; to}[]; undo?: () => Promise<void>; card?: { kind: 'student'|'search'|'draft'|'confirm'; data: unknown }; form?: { kind: 'attendance'|'counsel'; studentId: string; date: string } }`
- `COMMANDS: CommandDef[]`, `commandNames(): Record<string,string>`
- 규칙 명령: `attendance`(/출결: 저장 + reconcileStudent, undo=deleteAttendance+reconcile; 종류 없으면 form), `counsel`(/상담기록: saveLog; 내용 없으면 form), `info`(/정보: card student), `event`(/일정, sub '달력'|'할일'; 달력=addLocalEvent tag 기본 '업무'), `todo`(/할일, parts에 @노트·@학생 조각), `search`(/찾기: 출결 사유·상담·일정·노트 제목/본문, card search), `notice`(/전달 학생 = addNotice 오늘), `note`(/노트 제목 = createNote, 링크), `report`(/신고서 @학생: 최근 신고서 hwpx 다운로드), `export`(/내보내기 화면: navigate + dispatchShortcut export), `seat`(/자리: navigate '/class/seating'), `reflection`(/반성문 @학생: navigate '/class/reflection?sid=')
- `executeInput(input, ctx: ParseCtx, env: RunEnv): Promise<{ chat: ChatRec; result?: RunResult; parsed: Parsed }>` — 해석 오류·ambiguous·missing이면 실행하지 않고 status '확인 필요'; 실행 오류는 '실패'로 기록.
- `makeUndo(fn, ms = 10000, now = Date.now): { undo(): Promise<boolean>; expiresAt: number }` — 만료·두 번째 호출은 false.

- [ ] Step 1: 시험 — '/출결 @3 결석 질병 감기' 실행 → attendance 1건 + 신고서 생김 + chat 성공, links에 '#/attendance?date=2026-11-10'; undo → 기록·신고서 없어짐; '/출결 @김민 지각' → 저장 안 됨, status '확인 필요'; '/할일 회신 @2026 공문서' → parts ['회신 ', {note}]; makeUndo 10초 뒤 false, 두 번째 false.
- [ ] Step 2~4: FAIL → 구현 → PASS. Step 5: 커밋 "규칙 명령 실행·대화 기록·되돌리기".

### Task 6: AI 명령

**Files:** Modify `registry.ts`; Create `src/lib/command/ai.ts` (+test); Modify `src/lib/ai/prompts.ts`(kind 추가 'command'|'message'|'reflection')

**Interfaces:**
- `counselDraft`(/상담정리 @학생: 최근 미정리 기록 → 기존 누가기록 정리 함수로 초안 card draft, '저장' 버튼 → updateNuga)
- `messageDraft`(/전달 학부모|교사 내용: AI 문장 초안 card draft + 복사)
- `splitNotices(raw, env)`: 긴 붙여넣기(줄 3개 이상 또는 200자 이상이고 '/' 없음) → 기존 `buildBriefingPrompt`로 항목 → card draft(각 줄 '전달사항에 추가')
- `sentenceToCommand(text, env)`: '/' 없는 짧은 문장 → AI JSON `{"command":"/..."}` → `parseCommand`로 미리보기 → card confirm('이렇게 실행할까요?'); AI는 저장하지 않음.
- AI 꺼짐 → summary 'AI가 꺼져 있습니다', links [{label:'설정 > AI', to:'/settings?tab=ai'}], status '실패'.

- [ ] Step 1: 시험(가짜 AI) — '내일 3번 지각 처리해줘' → confirm card, AI에 간 글에 '박도윤' 없음(가림), DB 변화 없음; 긴 붙여넣기 → draft 3줄; AI 꺼짐 → 링크 있음.
- [ ] Step 2~4: FAIL → 구현 → PASS. Step 5: 커밋 "AI 명령(상담정리·전달 문장·나누기·문장 해석)".

### Task 7: 입력 막대·대화 기록·결과 카드·W 버튼

**Files:** Create `src/components/command/CommandBar.tsx`, `ChatLog.tsx`, `ResultCard.tsx`, `FloatingForm.tsx`, `WButton.tsx`, `useCommandCtx.ts` (+tests); Modify `src/App.tsx`(WButton 홈 아닌 화면), `src/components/Shortcuts.tsx`(Ctrl+K → 홈이면 막대 포커스, 아니면 W 펼침), `src/styles.css`

**Interfaces:**
- `useCommandCtx(): { ctx: ParseCtx; env: RunEnv } | null`(현재 학급 학생·노트 liveQuery)
- `CommandBar({ onRan(chat, result) , autoFocus? })` — 입력 + 자동완성 목록(role listbox, option) + 해석 한 줄(role status) + 오류 한 줄(빨강); ↑↓·Enter·Tab·Esc·빈 칸 ↑(직전 입력).
- `ChatLog({ schoolYear })` — liveQuery, 내 입력 오른쪽 말풍선, 결과 왼쪽 카드, ⋯ 메뉴(다시 실행·노트로 보내기·지우기), '오늘 대화 지우기'.
- `ResultCard({ chat, result? })` — 규칙/AI 배지, 링크(HashRouter Link), 10초 되돌리기 버튼(남은 초), draft/confirm/student/search 카드, form이면 `FloatingForm`(AttendanceForm·NewLog 재사용).
- `WButton()` — 오른쪽 아래 'W', 누르면 왼쪽으로 늘어나 CommandBar(최대 640px), 결과 카드는 막대 위. Esc·바깥 클릭이면 접힘.

- [ ] Step 1: 시험 — 키보드만: '/출' 입력 → Enter(후보 넣기) → '@3 결석 질병 감기' → Enter → 카드 '저장했습니다'·되돌리기 버튼, DB에 출결; 조합 중 Enter 무시(`isComposing` 이벤트); W 버튼 누르면 입력 칸 포커스, Esc로 접힘.
- [ ] Step 2~4: FAIL → 구현 → PASS. Step 5: 커밋 "입력 막대·대화 기록·W".

### Task 8: 새 홈

**Files:** Rewrite `src/pages/home/HomePage.tsx`; Create `src/pages/home/RightPanel.tsx`, `TodoList.tsx`, `Upcoming.tsx`, `NoteBox.tsx`, `TodaySummary.tsx`, `NoticeTab.tsx`; Modify `HomePage.test.tsx`, `styles.css`

**Interfaces:**
- 배치: 제목 줄(날짜·수업일) → TodaySummary(한 줄: 출결 n · 지금 n교시 · 급식, 누르면 펼침: 기존 급식·내 시간표 카드) → [대화 영역(전달사항 탭 있으면 위에 탭 줄 '대화' | '전달사항 n') + CommandBar] | RightPanel. GettingStarted는 대화 영역 위 그대로(숨기기 가능).
- 끌어서 조절: 대화 높이·오른쪽 폭 → localStorage `watson.home.layout`(try/catch).
- TodoList: 체크·지우기·직접 추가(입력에서 `@` → suggest의 student·note 후보) · 노트 링크 조각은 Link.
- Upcoming: 오늘부터 14일, 날짜별 묶음, 학사(school_calendar)·구글·내 일정(개인·업무) 태그 색 점.
- NoteBox: 최근 노트 5개 + '새 노트' + '노트함 열기'.
- NoticeTab: Task 9.
- 앱 처음 켤 때 `migrateBriefings`·`pruneChat` 한 번(App 시작 효과).

- [ ] Step 1: 시험 — 홈에 입력 막대·할 일·다가오는 일정이 보임; 전달사항 없는 날엔 '전달사항' 탭 없음, 있으면 '전달사항 2'; 할 일 '회신 @2026 공문서' 추가 → 링크 '2026 공문서' href '#/notes?id=…'; 구글·내 일정 태그 표시.
- [ ] Step 2~4: FAIL → 구현(HomePage.test 기존 기대는 새 배치로 교체) → PASS. Step 5: 커밋 "새 홈".

### Task 9: 전달사항 탭

**Files:** Create `src/pages/home/NoticeTab.tsx` (+test); 기존 `Briefing` 부품 제거

**Interfaces:** `NoticeTab({ date })` — 목록(체크·핀·↑↓·지우기(10초 되돌리기)·기간 고치기(시작·끝 날짜 칸)), '직접 추가'(기간 기본 그날 하루), '붙여넣어 AI로 나누기'(splitNotices → 각 항목 추가), '노트로 보내기'(새 노트에 체크 블록들), ExportMenu(한글 표·엑셀·PDF). 날짜 바꾸기 칸.

- [ ] Step 1: 시험 — 11/10~11/12 항목이 11/11 탭에 보임; 핀 누르면 맨 위; 지우기 후 되돌리기로 복구; 끝<시작 입력 시 오류 문구; 노트로 보내기 → 노트 1개(체크 블록 n개).
- [ ] Step 2~4: FAIL → 구현 → PASS. Step 5: 커밋 "전달사항 탭".

### Task 10: 노트함(블록 편집)

**Files:** Create `src/lib/notes/blocks.ts` (+test), `src/pages/notes/NotesPage.tsx`, `NoteEditor.tsx`, `SlashMenu.tsx`, `BlockRow.tsx` (+tests); Modify `App.tsx`(route `/notes`), `Nav.tsx`(MENU에 '노트함' 상담일지 다음), `styles.css`

**Interfaces:**
- blocks.ts(순수): `splitBlock(blocks, id, caret): {blocks, focusId}`, `mergeUp(blocks, id): {blocks, focusId, caret}`, `moveBlock(blocks, id, toIndex)`, `setType(blocks, id, type)`, `SLASH_ITEMS: {type, label, keywords}[]`(문단·제목1·제목2·체크·글머리·번호·구분선·파일·폴더), `filterSlash(q)`
- NoteEditor: 제목 입력 + 블록(각 블록 contentEditable 대신 `textarea` 자동 높이; check는 체크박스+글) · 빈 블록에서 '/' → SlashMenu · Enter 나누기 · 빈 블록 Backspace 합치기 · 손잡이 끌기(HTML5 drag) · 손잡이 메뉴(전달사항으로 보내기 · 복사 · 지우기) · 파일 끌어다 놓기 → attachFile → file 블록(이름·크기, 누르면 내려받기) · 저장은 입력 멈춤 500ms 후.
- NotesPage: 왼쪽 목록(찾기·고정·지우기·클립 표시) · `?id=` 열기 · 위에 '이 노트를 가리키는 할 일' · ExportMenu(한글·엑셀·PDF).
- 폴더 블록: Task 11의 브리지 사용, 없으면 '새 exe가 필요합니다'.

- [ ] Step 1: 시험 — blocks 순수 함수(나누기·합치기·옮기기); 화면: '/체' 입력 → 메뉴 '체크 목록' Enter → 체크 블록; 파일 놓기 → 파일 블록 표시, 51MB는 오류; 블록 메뉴 '전달사항으로 보내기' → 오늘 전달사항 생김; 할 일 목록에 연결된 할 일 보임.
- [ ] Step 2~4: FAIL → 구현 → PASS. Step 5: 커밋 "노트함".

### Task 11: 폴더 연결·PDF 용지(SHELL 4)

**Files:** Modify `electron/main.cjs`(SHELL 4, IPC), `electron/preload.cjs`; Create `src/lib/notes/folders.ts` (+test)

**Interfaces:**
- IPC `folder:pick` → `{path} | null`(showOpenDialog openDirectory), `folder:open(path)`(디렉터리이고 존재할 때만 `shell.openPath`, 아니면 Error '폴더를 찾지 못했습니다.'), `folder:list(path)` → `{name, dir: boolean}[]`(최대 200, 디렉터리만 허용).
- `pdf:save(name, opts?: {pageSize?: 'A4'|'B4'})` — B4는 `{width: 10.12, height: 14.33}`인치.
- folders.ts: `getFolderBridge(): FolderBridge | undefined`; `exportPdf(fileName, opts?)` 옵션 전달(pdf.ts 수정).

- [ ] Step 1: 시험 — 브리지 없으면 폴더 블록 클릭 시 '새 exe가 필요합니다'; exportPdf가 pageSize를 넘김(가짜 브리지).
- [ ] Step 2~4: FAIL → 구현(main은 node --check) → PASS. Step 5: 커밋 "폴더 연결·PDF 용지".

### Task 12: 반성문

**Files:** Create `src/lib/reflection/fit.ts`, `widths.ts`, `split.ts`, `hwpx.ts`, `ai.ts`, `template.ts`(생성기의 HWPX_B64를 옮김) (+tests); `src/pages/class/ReflectionTab.tsx` (+test); Modify `ClassPage.tsx`(sub 'reflection'), `CounselingPage.tsx`('반성문 n건' 링크), `styles.css`

**Interfaces:**
- widths.ts: `charEm(ch): number` — 한글 음절·자모·한자 1.0, 공백 0.33, 숫자 0.55, 영문 소문자 0.55, 대문자 0.68, 구두점 . , 0.30, 그 밖 1.0(보수적).
- fit.ts: 생성기의 `fit`/`capacity`를 DOM 측정 대신 `charEm` 합으로: `fitLine(text, {basePt, baseSp, auto, minSp, minPt, widthPt}): {pt, sp, over: boolean, state: 'ok'|'sp'|'pt'|'over', overChars?}`, 상수 `MODES`(B4 k 1, A4 k 0.7956), `widthPt(mode) = (65174*k - 282)/100 * 0.985`.
- split.ts: `splitSentences(raw)`, `distribute(raw, fits: (line)=>boolean): string[]`(16줄, 생성기 규칙 그대로, 번호 '1.' 지움)
- hwpx.ts: `buildReflectionHwpx({date, no, name, t1, t2, lines, mode, fits}): Promise<Uint8Array>`(생성기 `saveHwpx` 이식, 앱 JSZip)
- ai.ts: `fillByAi(reason, env): Promise<string[]>`(prompts kind 'reflection', 응답 JSON 배열 16개, 아니면 Error '16줄을 받지 못했습니다.')
- ReflectionTab: 설계서 3 §3 배치. 학번 = `${grade}${class_no}${String(number).padStart(2,'0')}`, 날짜 '2026.11.10.'. 저장·별표·모음 넣기·노트로 보내기·ExportMenu(한글=buildReflectionHwpx, PDF=exportPdf(.., {pageSize: mode}), 엑셀=목록).

- [ ] Step 1: 시험 — fitLine: 기본 16문장 1번(72자)이 B4에서 sp 상태(넘침 아님); 영문·숫자 섞인 줄 계산이 한글만 줄보다 좁게; distribute 3문장 긴 글 → 16줄 앞 3줄 채움; hwpx 열면 section0.xml에 학생 이름·16줄; AI에 간 글에 이름 없음; 화면: 학생 고르면 이름·학번 칸 채워짐, 저장 → 목록 1건.
- [ ] Step 2~4: FAIL → 구현 → PASS. Step 5: 커밋 "반성문".

### Task 13: 달력에 내 일정·태그

**Files:** Modify `src/pages/calendar/CalendarPage.tsx` (+test)

**Interfaces:** 달력 칸에 내 일정(태그 색: 개인·업무), 오른쪽 '고른 날'에 '일정 추가'(제목·시각·태그) · 지우기. 구글 연결 시 기존 push에 local_events 포함(`buildPushItems`에 추가).

- [ ] Step 1: 시험 — 11/12에 '업무' 일정 추가 → 칸에 보임(태그 '업무'), 지우면 사라짐; buildPushItems에 포함.
- [ ] Step 2~4: FAIL → 구현 → PASS. Step 5: 커밋 "달력 내 일정".

### Task 14: 확인·배포(0.6.0)

- [ ] Step 1: tsc 0, vitest 전부 PASS.
- [ ] Step 2: 캡처(기본·어둡게): 홈(대화·카드·자동완성 열림·전달사항 탭), W 막대, 노트함('/' 메뉴·첨부), 반성문, 달력. Electron printToPDF + pdftotext로 반성문·노트·전달사항 PDF 글자 확인.
- [ ] Step 3: version 0.6.0, exe 빌드·zip.
- [ ] Step 4: 최종 검토(새 검토자) → 수정 한 번.
- [ ] Step 5: 0.6.0 게시(MIN_SHELL=1), exe를 노트북 다운로드 폴더로, main 병합·푸시.
