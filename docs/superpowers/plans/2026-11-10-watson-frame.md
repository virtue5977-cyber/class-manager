# Watson 앱 틀 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱을 Watson으로 바꾸고(새 exe, 자료 유지), 하위 메뉴·메뉴 숫자·단축키·통일된 내보내기(한글·엑셀·PDF)·명단 좌우 배치·Antigravity CLI 연결을 넣는다.

**Architecture:** 렌더러(React/HashRouter)는 주소 구조를 `/attendance/*`, `/class/*`로 바꾸고 옛 주소는 `<Navigate>`로 넘긴다. 단축키는 `src/lib/ui/shortcuts.ts` 한 곳에서 해석하고 화면별 동작은 `useShortcut` 훅으로 등록한다. Electron 쪽은 SHELL 3으로 올려 `pdf:save`, `ai:agy:*` IPC를 추가하고, userData 폴더를 옛 이름으로 고정한다. 렌더러는 브리지가 없으면(HTML판·옛 exe) 대체 동작을 쓴다.

**Tech Stack:** React 18 + TS + Vite 5, react-router-dom 6, Dexie(liveQuery), Vitest/jsdom + Testing Library, Electron 33 + electron-builder, Playwright(캡처).

**Spec:** `docs/superpowers/specs/2026-11-10-watson-frame-design.md` (+ 설계서 2의 12장 Antigravity)

## Global Constraints
- 앱 이름 `Watson`, exe `Watson.exe`, `appId`는 `kr.classmanager.app` 그대로.
- userData: 옛 폴더 `%APPDATA%/담임업무`가 있으면 그것, 없으면 `%APPDATA%/Watson`.
- SHELL = 3. 업데이트 번들은 `MIN_SHELL=1`로 내므로 새 브리지 기능은 모두 있는지 확인 후 쓰고 없으면 대체 동작.
- 주소: `/`, `/calendar`, `/attendance`, `/attendance/reports`, `/attendance/stats`, `/counseling`, `/class/roster`, `/class/sheet`, `/class/seating`, `/class/cleaning`, `/class/reflection`, `/settings`. 옛 `/reports`→`/attendance/reports`, `/stats`→`/attendance/stats`, `/class`→`/class/roster` (쿼리 유지).
- 단축키: Ctrl+K, Ctrl+1~6(홈·달력·출결·상담일지·학급·설정), Alt+←/→ 'step', Ctrl+E 'export', Ctrl+Shift+H 이름 가림, Esc. 글자 칸 안에서는 Ctrl/Alt 조합만.
- 모든 화면 글은 한국어. 학생 자료는 노트북 밖으로 보내지 않음(AI는 이름 가림 강제).
- 버전 0.5.0.

## Review Focus
- 옛 '담임업무' 폴더에 자료가 있는 선생님이 새 exe를 켜면 같은 자료가 보여야 한다 → Task 1 `pickUserDataDir` 테스트.
- 글자 입력 중 숫자·글자 키는 단축키로 먹히면 안 되고(Ctrl/Alt만), 한글 조합 중에도 마찬가지 → Task 6 테스트.
- 화면 안 링크(`#/attendance?date=…`, `/settings?tab=…`, `/class`)와 옛 주소가 모두 새 화면으로 열려야 한다 → Task 3 테스트.
- HTML판·옛 exe에서 PDF를 누르면 오류 없이 인쇄 창으로 대신해야 한다 → Task 8 테스트.
- Antigravity가 없거나 로그인 안 됨·응답 지연이면 한국어 안내로 끝나고 멈추지 않아야 한다(60초 제한) → Task 2 테스트.

---

### Task 1: Watson 이름과 자료 폴더 고정 (Electron, SHELL 3)

**Files:**
- Create: `electron/paths.cjs`, `src/lib/electron-paths.test.ts`, `scripts/make-icon.mjs`, `build/icon.ico`
- Modify: `electron/main.cjs`(맨 위 setPath, 창 제목, `SHELL = 3`), `package.json`(version 0.5.0, build.productName, win.icon, description), `index.html` `<title>Watson</title>`

**Interfaces:**
- Produces: `pickUserDataDir(appData: string, exists: (p: string) => boolean): string` (CommonJS export), SHELL 3.

- [ ] Step 1: 테스트 — `옛 담임업무 폴더가 있으면 그 폴더를 쓴다`: `pickUserDataDir('/A', p => p === '/A/담임업무')` → `'/A/담임업무'`; `없으면 Watson 폴더`: → `'/A/Watson'`.
- [ ] Step 2: `npx vitest run src/lib/electron-paths.test.ts` → FAIL(모듈 없음).
- [ ] Step 3: `electron/paths.cjs` 구현, main.cjs에서 `app.whenReady` 이전에 `app.setPath('userData', pickUserDataDir(app.getPath('appData'), fs.existsSync))`. 창 `title: 'Watson'`. `make-icon.mjs`: 256/48/32/16 크기 W 아이콘을 playwright로 그려 png→ico(png-to-ico 없이 ICO 헤더 직접 작성).
- [ ] Step 4: 테스트 PASS, `npx tsc --noEmit -p .` 통과.
- [ ] Step 5: 커밋 `Watson 이름·아이콘, 자료 폴더 고정, SHELL 3`.

### Task 2: Antigravity CLI 연결

**Files:**
- Create: `electron/agy.cjs`(인자 만들기·응답 풀기 순수 함수), `src/lib/ai/agy.test.ts`
- Modify: `electron/main.cjs`(`ai:agy:status`, `ai:agy:ask`), `electron/preload.cjs`(`desktop.agy.{status,ask}`), `src/lib/ai/client.ts`(공급자 'antigravity' 라우팅), `src/lib/db/types.ts`(`ai_provider: 'claude-code'|'api-key'|'antigravity'`), `src/pages/settings/AiSettings.tsx`, `src/pages/settings/AiSettings.test.tsx`

**Interfaces:**
- Produces: `agyArgs(prompt: string): string[]` → `['-p', prompt, '--output-format', 'json', '--mode', 'plan', '--sandbox', '--disable-slash-commands']`; `parseAgyOutput(stdout: string): { text?: string; error?: string }` (JSON의 `response`, `status`가 ERROR거나 `authentication required`면 error=`'Antigravity 로그인이 필요합니다. 명령 창에서 agy 를 한 번 실행해 구글 계정으로 로그인하세요.'`); `getAntigravity(): { status(): Promise<{installed:boolean; version?:string}>; ask(req): Promise<string> } | undefined`.
- Consumes: 기존 `createRoutedAiCaller`, 이름 가림.

- [ ] Step 1: 테스트 — `agyArgs`가 위 배열을 돌려줌; 프롬프트 20,000자 넘으면 throw('AI에 보낼 글이 너무 깁니다'); `parseAgyOutput('{"status":"OK","response":"안녕"}')` → `{text:'안녕'}`; 인증 오류 문자열 → error 위 문구; 빈 출력 → error `'Antigravity 응답이 없습니다.'`.
- [ ] Step 2: 테스트 — AiSettings: 'Antigravity(구글 로그인)' 라디오를 고르면 'Enable Telemetry' 안내 문구가 보이고, `mask_names` 체크박스가 체크·비활성(disabled)이다.
- [ ] Step 3: 두 테스트 FAIL 확인.
- [ ] Step 4: 구현. main: Windows에선 `agy.cmd`를 `shell:false`로 못 부르므로 `cmd.exe /d /s /c` 대신 `where agy`로 찾은 경로가 `.exe`면 직접, `.cmd`면 `spawn(process.env.ComSpec, ['/d','/s','/c', quoted])`(인자 각각 `"…"` 감싸고 `"`→`""`, `%`→`%%`). cwd는 기존 빈 임시 폴더, 60초 제한. client: 공급자가 antigravity이고 브리지가 있으면 프롬프트를 system+user 합친 문자열로 보내기.
- [ ] Step 5: 테스트 PASS, 커밋 `Antigravity CLI 연결(구글 로그인)`.

### Task 3: 주소 구조와 옛 주소 넘기기

**Files:**
- Create: `src/pages/class/ClassLayout.tsx`(학급 공통 머리·학급 없음 처리 + `<Outlet>`), `src/pages/class/ReflectionPage.tsx`('준비 중'), `src/AppRoutes.test.tsx`
- Modify: `src/App.tsx`(Routes), `src/pages/class/ClassPage.tsx`(탭 제거 → ClassLayout로 대체 후 삭제), `src/pages/home/GettingStarted.tsx`·`src/pages/home/HomePage.tsx`·그 밖 `to="/class"`, `/reports`, `/stats` 링크

**Interfaces:**
- Produces: `export function AppRoutes(props: { backupIterations?: number })`(App에서 분리, 테스트에서 MemoryRouter로 감싸 씀). 학급 하위 화면은 `useOutletContext<{ classRec: ClassRec }>()`로 학급을 받는다.

- [ ] Step 1: 테스트 — MemoryRouter `initialEntries=['/reports?x=1']` → 결석신고서 제목이 보이고 location이 `/attendance/reports?x=1`; `/stats` → 통계; `/class` → 명단; `/class/seating` → '무작위 배치' 버튼; `/class/reflection` → '반성문은 다음 업데이트에서'.
- [ ] Step 2: FAIL 확인.
- [ ] Step 3: 구현(`<Route path="/reports" element={<Navigate to={'/attendance/reports'+search} replace/>}/>` 식).
- [ ] Step 4: 전체 테스트 PASS(기존 ClassPage 테스트는 ClassLayout 대상으로 옮김), 커밋 `주소 구조: 출결·학급 하위 화면`.

### Task 4: 사이드바 — Watson 머리·하위 메뉴·버전

**Files:**
- Modify: `src/components/Nav.tsx`, `src/pages/common/useClasses.tsx`(SidebarClass → SidebarBrand), `src/App.tsx`, `src/components/HideNames.tsx`(사이드바에서 제거, Task 7에서 재사용), `src/styles.css`
- Test: `src/components/Nav.test.tsx`

**Interfaces:**
- Produces: `MENU: { to: string; label: string; icon: IconName; children?: { to: string; label: string }[] }[]`; `SidebarBrand()` — 'Watson', 학교명(settings.school_name), `${school_year}학년도 ${grade}학년 ${class_no}반`(학급 2개 이상이면 select, aria-label '학급 전환').

- [ ] Step 1: 테스트 — `/attendance/stats`에서 '결석신고서'·'통계' 하위 링크가 보이고 '명단'은 안 보임; `/class/sheet`에선 학급 하위 5개가 보임; 사이드바에 'Watson'과 'v0.5.0'(package.json version) 표시; '이름 보임' 버튼이 사이드바에 없음.
- [ ] Step 2: FAIL 확인. Step 3: 구현(버전은 `import.meta.env` 대신 vite `define: { __APP_VERSION__ }`). Step 4: PASS, 커밋 `사이드바: Watson·하위 메뉴`.

### Task 5: 메뉴 숫자(미제출 신고서·미정리 상담)

**Files:**
- Create: `src/lib/ui/badges.ts`, `src/lib/ui/badges.test.ts`
- Modify: `src/components/Nav.tsx`

**Interfaces:**
- Produces: `countBadges(db: AppDB, classId: string, month: string): Promise<{ openReports: number; unorganizedLogs: number }>`; `useBadges(): { openReports: number; unorganizedLogs: number }`(Dexie `liveQuery`, 현재 학급·이번 달).
- Consumes: `listReportsForMonth`, `listLogsByStudents`.

- [ ] Step 1: 테스트 — 미제출 2·제출 1, 미정리 1·정리됨 1 → `{openReports:2, unorganizedLogs:1}`; 지운 기록 제외.
- [ ] Step 2~4: FAIL → 구현 → PASS. Nav는 0이면 숫자를 숨기고 `aria-label="출결, 미제출 신고서 2건"`.
- [ ] Step 5: 커밋 `메뉴 숫자`.

### Task 6: 단축키

**Files:**
- Create: `src/lib/ui/shortcuts.ts`, `src/lib/ui/shortcuts.test.ts`, `src/components/Shortcuts.tsx`(App 전역 처리), `src/components/Shortcuts.test.tsx`
- Modify: `src/App.tsx`, `src/pages/attendance/AttendancePage.tsx`·`src/pages/calendar/CalendarPage.tsx`·`src/pages/reports/ReportsPage.tsx`·`src/pages/stats/StatsPage.tsx`(step 등록)

**Interfaces:**
- Produces: `type ShortcutAction = { kind: 'nav'; to: string } | { kind: 'step'; dir: 1 | -1 } | { kind: 'export' } | { kind: 'hideNames' } | { kind: 'command' } | { kind: 'close' }`; `matchShortcut(e: Pick<KeyboardEvent,'key'|'code'|'ctrlKey'|'altKey'|'shiftKey'|'metaKey'|'isComposing'>, inField: boolean): ShortcutAction | null`; `useShortcut(kind: ShortcutAction['kind'], fn: (a: ShortcutAction) => void)`(window 이벤트 `watson:shortcut`로 전달); `SHORTCUT_TABLE: { keys: string; label: string }[]`(설정 화면용).

- [ ] Step 1: 테스트(`matchShortcut`) — Ctrl+2 → nav `/calendar`; Ctrl+6 → `/settings`; Alt+ArrowRight → step 1; Ctrl+Shift+H → hideNames; Ctrl+K → command; Ctrl+E → export; Escape → close; 글자 칸에서 '2' → null; 글자 칸에서 Ctrl+2 → nav; isComposing → null.
- [ ] Step 2: 테스트(`Shortcuts`) — 출결 화면에서 Alt+→ 누르면 날짜 칸이 다음 수업일로(2026-11-06 → 11-09); Ctrl+2로 달력 제목이 보임.
- [ ] Step 3~4: FAIL → 구현 → PASS. Ctrl+K는 지금은 `/`로 이동 후 `window.dispatchEvent(new Event('watson:command'))`.
- [ ] Step 5: 커밋 `단축키`.

### Task 7: 이름 가림 띠와 설정 > 화면

**Files:**
- Modify: `src/components/HideNames.tsx`(→ `HideNamesBar`: 켜졌을 때만 '이름 가림 중 · 끄기' 띠, `toggleHideNames()` 내보냄), `src/pages/settings/AppearanceSettings.tsx`(이름 가림 체크 + 단축키 표), `src/App.tsx`
- Test: `src/components/HideNames.test.tsx`(기존 수정), `src/pages/settings/AppearanceSettings.test.tsx`

**Interfaces:**
- Produces: `toggleHideNames(): void`, `isHideNames(): boolean`(localStorage `cm.hideNames` 그대로).
- Consumes: `SHORTCUT_TABLE`, `useShortcut('hideNames', …)`(Task 6).

- [ ] Step 1: 테스트 — 꺼져 있으면 띠 없음; Ctrl+Shift+H → body에 `hide-names` 클래스와 띠 '이름 가림 중'; 띠의 '끄기' → 해제; 화면 설정에 단축키 표 7줄.
- [ ] Step 2~4: FAIL → 구현 → PASS. Step 5: 커밋.

### Task 8: 내보내기 메뉴와 PDF

**Files:**
- Create: `src/components/ExportMenu.tsx`, `src/components/ExportMenu.test.tsx`, `src/lib/export/pdf.ts`, `src/lib/export/pdf.test.ts`
- Modify: `electron/main.cjs`(`pdf:save`: `webContents.printToPDF({ pageSize:'A4', printBackground:true })` → 저장 대화상자, 기본 이름 인자), `electron/preload.cjs`(`desktop.pdf.save(name)`), `src/styles.css`(인쇄용: 사이드바·도구·W 숨김)

**Interfaces:**
- Produces: `ExportMenu({ items }: { items: { format: 'hwpx'|'xlsx'|'pdf'; run: () => void | Promise<void> }[] })` — 버튼 '내보내기 ▾', 항목 '한글(hwpx)'·'엑셀(xlsx)'·'PDF', `useShortcut('export')`로 열림; `exportPdf(fileName: string): Promise<'saved'|'canceled'|'printed'>` — 브리지 있으면 저장, 없으면 `window.print()` 후 'printed'.

- [ ] Step 1: 테스트 — 브리지 없으면 `window.print` 호출·'printed'; 브리지 있으면 `save('통계_2026-11.pdf')` 호출; ExportMenu: 버튼 누르면 3항목, 'PDF' 누르면 run 호출, Ctrl+E로도 열림.
- [ ] Step 2~4: FAIL → 구현 → PASS. Step 5: 커밋.

### Task 9: 화면마다 내보내기 메뉴 붙이기 + 새 엑셀

**Files:**
- Create: `src/lib/export/sheets.ts`(새 엑셀 4종), `src/lib/export/sheets.test.ts`
- Modify: `src/pages/reports/ReportsPage.tsx`, `src/pages/stats/StatsPage.tsx`, `src/pages/counseling/CounselingPage.tsx`, `src/pages/class/RosterDocTab.tsx`(명렬표), `src/pages/class/SeatingTab.tsx`, `src/pages/class/CleaningTab.tsx`, `src/pages/calendar/CalendarPage.tsx`

**Interfaces:**
- Produces: `reportsXlsx(rows: ReportRow[], stuName): Promise<Uint8Array>`(열: 번호·이름·기간·출결·수업일·증빙·진단서·제출), `rosterXlsx(students, columns)`, `seatingXlsx(chart, students)`(행·열 그대로, 칸 '번호 이름', 교탁 줄 포함), `calendarXlsx(month, days)`(날짜·종류(학사/구글/출결/상담)·내용). 모두 기존 `writeSimpleXlsx` 사용.
- Consumes: `ExportMenu`, `exportPdf`(Task 8).

- [ ] Step 1: 테스트 — 각 함수의 결과를 `readXlsx`로 다시 읽어 머리줄과 첫 줄 값 확인(예: seating 2×2에 학생 1명 → `[['1번 가나',''],['','']]` + '교탁').
- [ ] Step 2~4: FAIL → 구현 → PASS.
- [ ] Step 5: 화면 테스트 — 각 화면에 '내보내기' 버튼이 하나만 있고 기존 개별 내보내기 버튼은 없음(신고서 '미제출 n건 hwpx'와 선택 줄은 유지).
- [ ] Step 6: 커밋 `내보내기 통일`.

### Task 10: 명단 좌우 배치

**Files:**
- Modify: `src/pages/class/RosterTab.tsx`, `src/styles.css`; Test: `src/pages/class/RosterTab.test.tsx`

**Interfaces:**
- Consumes: 기존 학생 상세(StudentEditor) 부품.

- [ ] Step 1: 테스트 — 왼쪽 목록에 '1번 가나' 형식만(전화번호 칸 없음); 처음엔 첫 학생 상세가 오른쪽에 열림; 전출 학생은 맨 아래 `inactive` 클래스; 찾기 칸에 '다라' → 목록 1명.
- [ ] Step 2~4: FAIL → 구현 → PASS. Step 5: 커밋.

### Task 11: 백업 알림 '오늘은 그만 보기'와 화면 머리 공통 부품

**Files:**
- Create: `src/components/PageHead.tsx`
- Modify: `src/components/BackupBanner.tsx`(+test), 화면들의 `.page-head` 마크업 → `<PageHead title summary tools>`

**Interfaces:**
- Produces: `PageHead({ title, summary, children })`.

- [ ] Step 1: 테스트 — '오늘은 그만 보기' 누르면 띠가 사라지고 같은 날 다시 그려도 없음, 다음 날엔 다시 보임(device_local `backupBannerHidden` = 날짜).
- [ ] Step 2~4: FAIL → 구현 → PASS(PageHead 교체 후 전체 테스트 PASS). Step 5: 커밋.

### Task 12: 확인·배포

- [ ] Step 1: `npx tsc --noEmit -p .` 오류 0, `npx vitest run` 전부 PASS.
- [ ] Step 2: `ux.cjs`로 전 화면 캡처(기본·어둡게) + 사이드바 펼침·숫자·이름 가림 띠·내보내기 메뉴 열린 모습; 이전 캡처와 나란히 보고 깨진 곳 고치기.
- [ ] Step 3: Windows exe 빌드(`npx electron-builder --win dir`) → `Watson.exe` 확인, Python zipfile로 ASCII 이름 zip(`watson-app/Watson.exe`).
- [ ] Step 4: 자료 이어짐 확인 — Linux에서 `xvfb-run`으로 Electron 실행, appData 아래 '담임업무' 폴더에 가상 학생 자료를 만든 뒤 새 빌드로 열어 명단에 보이는지 캡처.
- [ ] Step 5: 0.5.0 업데이트 번들 게시(`MIN_SHELL=1`), 새 exe zip을 선생님 노트북 다운로드 폴더로 전달하고 바꾸는 순서(백업 → 옛 폴더 닫기 → 새 폴더 실행) 안내.
- [ ] Step 6: main 병합·푸시.
