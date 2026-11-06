# 1단계: 프로젝트 골격 · 기기 저장소 · 암호화 백업 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 담임 업무 앱의 뼈대(왼쪽 메뉴가 있는 빈 화면들), 모든 데이터 표를 갖춘 기기 저장소, 그리고 암호화 자동 백업·복원을 동작하는 상태로 만든다.

**Architecture:** React + TypeScript 웹앱(Vite). 데이터는 Dexie(IndexedDB)에만 저장하고 모든 접근은 `src/lib/db`를 거친다. 백업은 스냅샷(JSON) → AES-GCM 암호화 → 머리말 붙인 파일 → 지정 폴더 저장이며, 폴더 접근은 `FsAdapter` 인터페이스 뒤에 숨겨 웹(File System Access API)과 나중의 Electron을 갈아끼울 수 있게 한다.

**Tech Stack:** Node 22, Vite 5, React 18.3, TypeScript 5, Dexie 4, react-router-dom 6(HashRouter), Vitest 2, @testing-library/react 16, fake-indexeddb 6, jsdom.

**Spec:** `docs/superpowers/specs/2026-11-04-class-manager-design.md` (개정 9). 이 계획은 14절 구현 순서의 1번 항목과 4절(데이터 보호 중 4.2 백업), 5절(데이터 모델), 11절(복원 오류 처리)을 구현한다. PIN(4.1)은 10단계, Electron 어댑터는 10단계.

## Global Constraints

- 1단계는 노트북 전용, 데이터 서버 없음. 학생 데이터를 네트워크로 보내는 코드를 쓰지 않는다.
- 화면 문구는 모두 한국어.
- 모든 동기화 대상 레코드: `id`(crypto.randomUUID), `created_at`, `updated_at`(ISO 8601 UTC 문자열), `deleted`(boolean).
- 데이터 읽기·쓰기는 `src/lib/db`를 통해서만 한다.
- 키 유도 PBKDF2-SHA256 반복 `600000`회, salt 16바이트(암호구 설정 시 1회 생성), AES-GCM-256, 파일마다 무작위 IV 12바이트, 키는 추출 불가(`extractable: false`).
- 백업 파일명 `백업_YYYYMMDD_HHMM.enc`(기기 현지 시각), 보관 개수 기본 `14`, 자동 백업 간격 24시간.
- AI 키·NEIS 키·PIN·캐시 키·폴더 핸들·마지막 백업 시각은 `device_local` 표에 두고 백업에서 통째로 제외한다.
- 라우터는 `HashRouter`(Electron의 file:// 대비).
- 커밋은 로컬 저장소에만 한다(푸시 없음).

## Review Focus

1. 잘린·손상된·다른 앱의 파일을 복원 → 형식 오류 메시지, 기존 데이터는 그대로. (Task 4, Task 7 테스트)
2. 더 새로운 앱 버전이 만든 백업을 복원 → 버전 오류 메시지, 기존 데이터 그대로. (Task 5 테스트)
3. 복원 도중 실패(잘못된 레코드) → 모든 표가 복원 전 상태로 남음(부분 복원 없음). (Task 5 테스트)
4. 같은 분에 두 번 백업 → 앞 파일을 덮어쓰지 않고 `_2`를 붙임, 보관 정리는 이름 순이 아니라 시각·번호 순. (Task 7 테스트)
5. 복원 후에도 이 기기의 AI 키·백업 키·폴더 설정이 유지됨. (Task 5, Task 7 테스트)

---

## File Structure

```
class-manager/
  package.json, tsconfig.json, vite.config.ts, index.html
  src/
    main.tsx, App.tsx
    test/setup.ts                     # fake-indexeddb, jest-dom
    lib/db/types.ts                   # 레코드 타입(스펙 5절)
    lib/db/schema.ts                  # AppDB, SCHEMA_VERSION, SYNCED_TABLES, createDb
    lib/db/records.ts                 # newRecord, save, softDelete, listActive
    lib/backup/errors.ts              # BackupDecryptError, BackupFormatError, BackupVersionError
    lib/backup/crypto.ts              # deriveKey, encrypt, decrypt, keyCheck
    lib/backup/format.ts              # 파일 머리말 인코딩/디코딩
    lib/backup/snapshot.ts            # export/import, serialize/parse, MIGRATIONS
    lib/backup/service.ts             # 암호구 설정, 백업 실행, 정리, 복원, 자동 백업 판단
    lib/fs/adapter.ts                 # BackupFolder, FsAdapter 인터페이스
    lib/fs/memory.ts                  # 테스트용 메모리 구현
    lib/fs/web.ts                     # File System Access API 구현
    app/context.tsx                   # DbContext, FsContext
    app/startup.ts                    # runStartup
    components/Nav.tsx, components/BackupBanner.tsx
    pages/Placeholder.tsx
    pages/settings/SettingsPage.tsx, pages/settings/BackupSettings.tsx
  tests 는 각 파일 옆에 *.test.ts(x)
```

---

### Task 1: 프로젝트 골격과 테스트 환경

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/test/setup.ts`, `src/App.test.tsx`, `.gitignore`

**Interfaces:**
- Produces: `npm test`(vitest run), `npm run build`, `npm run dev`. Vitest 환경 `jsdom`, setup 파일이 `fake-indexeddb/auto`와 `@testing-library/jest-dom/vitest`를 불러오고, `globalThis.crypto?.subtle`이 없으면 `node:crypto`의 `webcrypto`로 채운다(jsdom에서 WebCrypto 보장). `src/lib/**` 테스트는 파일 첫 줄에 `// @vitest-environment node`를 둔다.

- [ ] **Step 1:** `git init`, Vite react-ts 구성으로 위 파일 생성, 의존성 설치(`dexie`, `react-router-dom@6`, dev: `vitest@2`, `jsdom`, `fake-indexeddb@6`, `@testing-library/react@16`, `@testing-library/jest-dom`, `@testing-library/user-event`). `.gitignore`에 `node_modules`, `dist`.
- [ ] **Step 2: 실패하는 테스트** `src/App.test.tsx`

```tsx
test('앱 제목이 보인다', () => {
  render(<App />)
  expect(screen.getByText('담임 업무')).toBeInTheDocument()
})
```

- [ ] **Step 3:** `npx vitest run src/App.test.tsx` → FAIL.
- [ ] **Step 4:** `App`이 `<h1>담임 업무</h1>`를 그리게 한다.
- [ ] **Step 5:** `npm test` PASS, `npm run build` 성공.
- [ ] **Step 6:** 커밋 `chore: scaffold vite react ts app with vitest`

### Task 2: 기기 저장소(스키마와 레코드 도우미)

**Files:**
- Create: `src/lib/db/types.ts`, `src/lib/db/schema.ts`, `src/lib/db/records.ts`
- Test: `src/lib/db/records.test.ts`, `src/lib/db/schema.test.ts`

**Interfaces:**
- Produces:
  - `interface BaseRecord { id: string; created_at: string; updated_at: string; deleted: boolean }`
  - `types.ts`: 스펙 5절 표마다 `BaseRecord`를 확장한 인터페이스(필드명은 스펙의 snake_case 그대로): `ClassRec, StudentRec, AttendanceRec, AbsenceReportRec, ReportAttendanceRec, CounselingLogRec, SeatingChartRec, CleaningChartRec, SchoolCalendarRec, NeisCacheRec, TeacherTimetableRec, AiPromptRec, NoticeRec, BriefingRec, HwpxTemplateRec, AppSettingsRec`. `AppSettingsRec`에서는 기기 전용 필드를 뺀다(아래 `DeviceLocalRec`로).
  - `interface DeviceLocalRec { id: string; value: unknown }` — 알려진 id: `'backupKey'`, `'backupFolder'`, `'lastBackupAt'`, `'aiApiKey'`, `'neisApiKey'`, `'pin'`.
  - `schema.ts`: `SCHEMA_VERSION = 1`, `SYNCED_TABLES`(아래 16개 이름 배열, `as const`), `type SyncedTable`, `class AppDB extends Dexie`, `createDb(name?: string): AppDB`(기본 이름 `'class-manager'`).
  - `records.ts`: `newRecord<T>(fields: T, now?: Date): T & BaseRecord`, `save<T extends BaseRecord>(table: Table<T, string>, rec: T, now?: Date): Promise<T>`, `softDelete(table: Table<BaseRecord, string>, id: string, now?: Date): Promise<void>`, `listActive<T extends BaseRecord>(table: Table<T, string>): Promise<T[]>`.

Dexie v1 스토어 정의(인덱스):

```
classes: 'id, [school_year+grade+class_no]'
students: 'id, class_id'
attendance: 'id, student_id, date, &[student_id+date+kind]'
absence_reports: 'id, student_id, start_date'
report_attendance: 'id, report_id, attendance_id'
counseling_logs: 'id, student_id, date'
seating_charts: 'id, class_id'
cleaning_charts: 'id, class_id'
school_calendar: 'id, date'
neis_cache: 'id, [kind+range_key]'
teacher_timetable: 'id, [weekday+period]'
ai_prompts: 'id, kind'
notices: 'id, target_date'
briefings: 'id, [target_date+slot]'
hwpx_templates: 'id, name'
app_settings: 'id'
device_local: 'id'
```

`SYNCED_TABLES`는 위에서 `device_local`을 뺀 16개.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('newRecord는 uuid와 같은 created_at/updated_at, deleted=false를 붙인다', () => {
  const now = new Date('2026-11-04T01:00:00Z')
  const r = newRecord({ name: '가' }, now)
  expect(r.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(r.created_at).toBe('2026-11-04T01:00:00.000Z')
  expect(r.updated_at).toBe(r.created_at)
  expect(r.deleted).toBe(false)
})
test('save는 updated_at만 갱신한다', async () => { /* created_at 유지, updated_at === 새 now */ })
test('softDelete는 deleted=true로 바꾸고 행을 남긴다', async () => { /* get(id).deleted === true */ })
test('listActive는 삭제된 행을 뺀다', async () => { /* 2건 저장, 1건 softDelete → 길이 1 */ })
test('SYNCED_TABLES는 16개이고 device_local을 포함하지 않는다', () => {
  expect(SYNCED_TABLES).toHaveLength(16)
  expect(SYNCED_TABLES).not.toContain('device_local')
})
test('같은 학생·날짜·구분 출결은 중복 저장되지 않는다', async () => { /* 두 번째 add → reject (ConstraintError) */ })
```

각 테스트는 `createDb('test-' + crypto.randomUUID())`로 독립 DB를 쓴다.
- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** `types.ts`, `schema.ts`, `records.ts` 구현.
- [ ] **Step 4:** `npx vitest run src/lib/db` PASS.
- [ ] **Step 5:** 커밋 `feat(db): dexie schema v1 and record helpers`

### Task 3: 암호화 기본 기능

**Files:**
- Create: `src/lib/backup/errors.ts`, `src/lib/backup/crypto.ts`
- Test: `src/lib/backup/crypto.test.ts`

**Interfaces:**
- Produces:
  - `errors.ts`: `class BackupDecryptError`(메시지 `'암호구가 틀렸거나 백업 파일이 손상되었습니다.'`), `class BackupFormatError`(`'백업 파일 형식이 올바르지 않습니다.'`), `class BackupVersionError`(`'이 백업은 더 새로운 버전의 앱에서 만들어졌습니다. 앱을 업데이트한 뒤 복원하세요.'`). 모두 `Error` 상속, `name` 설정.
  - `crypto.ts`: `PBKDF2_ITERATIONS = 600_000`, `randomBytes(n: number): Uint8Array`, `deriveKey(passphrase: string, salt: Uint8Array, iterations?: number): Promise<CryptoKey>`, `encrypt(key: CryptoKey, plaintext: Uint8Array, aad: Uint8Array): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }>`, `decrypt(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Promise<Uint8Array>`(실패 시 `BackupDecryptError`), `makeKeyCheck(key: CryptoKey): Promise<string>`, `verifyKeyCheck(key: CryptoKey, check: string): Promise<boolean>`.

`makeKeyCheck`는 고정 문자열 `'class-manager-key-check'`를 빈 AAD로 암호화해 `base64(iv ‖ ciphertext)`로 돌려준다.

- [ ] **Step 1: 실패하는 테스트**(테스트에서는 `iterations = 1000`)

```ts
test('암호화 후 복호화하면 원문이 나온다')
test('다른 암호구로 복호화하면 BackupDecryptError')
test('암호문 한 바이트를 바꾸면 BackupDecryptError')
test('AAD가 다르면 BackupDecryptError')
test('유도한 키는 내보낼 수 없다', async () => {
  const k = await deriveKey('암호구12345', randomBytes(16), 1000)
  await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow()
})
test('기본 반복 횟수는 600000', () => expect(PBKDF2_ITERATIONS).toBe(600000))
test('같은 평문도 매번 다른 IV')
test('verifyKeyCheck는 같은 키면 true, 다른 키면 false')
```

- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** WebCrypto(`crypto.subtle`)로 구현. `deriveKey`는 PBKDF2-SHA256 → `{ name: 'AES-GCM', length: 256 }`, `extractable: false`, usages `['encrypt','decrypt']`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(backup): aes-gcm encryption with pbkdf2 key derivation`

### Task 4: 백업 파일 형식

**Files:**
- Create: `src/lib/backup/format.ts`
- Test: `src/lib/backup/format.test.ts`

**Interfaces:**
- Consumes: `BackupFormatError`
- Produces: `interface BackupHeader { formatVersion: 1; iterations: number; salt: Uint8Array }`, `HEADER_LENGTH = 25`, `encodeHeader(h: BackupHeader): Uint8Array`, `encodeBackupFile(h: BackupHeader, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array`, `decodeBackupFile(bytes: Uint8Array): { header: BackupHeader; headerBytes: Uint8Array; iv: Uint8Array; ciphertext: Uint8Array }`.

바이트 배치: `'CMBK'`(4) | formatVersion u8(1) | iterations u32 big-endian(4) | salt(16) | iv(12) | ciphertext(나머지). 머리말 25바이트(`headerBytes`)를 암호화의 AAD로 쓴다(Task 7). 최소 길이 = 25 + 12 + 16(GCM 태그) = 53.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('인코딩 후 디코딩하면 머리말·IV·암호문이 같다')
test('앞 4바이트가 CMBK가 아니면 BackupFormatError')
test('53바이트보다 짧으면 BackupFormatError')
test('formatVersion이 1이 아니면 BackupFormatError')
test('iterations가 big-endian으로 저장된다', () => {
  const f = encodeBackupFile({ formatVersion: 1, iterations: 600000, salt: new Uint8Array(16) }, new Uint8Array(12), new Uint8Array(16))
  expect([...f.slice(5, 9)]).toEqual([0x00, 0x09, 0x27, 0xc0])
})
```

- [ ] **Step 2:** FAIL 확인. **Step 3:** 구현(DataView). **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(backup): binary backup file header format`

### Task 5: 스냅샷 내보내기·가져오기

**Files:**
- Create: `src/lib/backup/snapshot.ts`
- Test: `src/lib/backup/snapshot.test.ts`

**Interfaces:**
- Consumes: `AppDB`, `SYNCED_TABLES`, `SCHEMA_VERSION`, `BackupFormatError`, `BackupVersionError`
- Produces:
  - `interface Snapshot { app: 'class-manager'; schemaVersion: number; exportedAt: string; tables: Record<SyncedTable, unknown[]> }`
  - `exportSnapshot(db: AppDB, now?: Date): Promise<Snapshot>` — 16개 표의 **모든 행(삭제 표시 포함)**, `device_local` 제외.
  - `importSnapshot(db: AppDB, snap: Snapshot): Promise<void>` — 검증 → 마이그레이션 → 16개 표를 하나의 읽기·쓰기 트랜잭션에서 `clear()` 후 `bulkAdd()`. `device_local`은 건드리지 않는다.
  - `MIGRATIONS: Record<number, (s: Snapshot) => Snapshot>` — 키 n은 버전 n → n+1. v1에서는 빈 객체.
  - `serializeSnapshot(s: Snapshot): Uint8Array`, `parseSnapshot(bytes: Uint8Array): Snapshot` — UTF-8 JSON. `Uint8Array` 값은 `{ "__bytes": "<base64>" }`로 바꿔 저장하고 되돌린다(hwpx 양식 바이너리용).

검증 규칙: `app !== 'class-manager'` 또는 `tables`가 객체가 아니면 `BackupFormatError`. `schemaVersion > SCHEMA_VERSION`이면 `BackupVersionError`. 행에 문자열 `id`가 없으면 `BackupFormatError`(트랜잭션 시작 전에 전부 검사).

- [ ] **Step 1: 실패하는 테스트**

```ts
test('내보내기는 삭제 표시된 행도 포함하고 device_local은 뺀다')
test('가져오기는 기존 데이터를 백업 내용으로 바꾼다')
test('가져오기 후에도 device_local(aiApiKey)은 그대로다')
test('schemaVersion이 더 크면 BackupVersionError이고 기존 데이터는 그대로다')
test('app 값이 다르면 BackupFormatError')
test('id 없는 행이 하나라도 있으면 아무 표도 바뀌지 않는다')
test('가져오기 중 bulkAdd가 실패하면 모든 표가 원래대로다', async () => {
  // 같은 id 두 행을 넣은 스냅샷 → bulkAdd ConstraintError → 이전 students 그대로
})
test('Uint8Array 값은 serialize/parse 왕복 후 같은 바이트다')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(backup): snapshot export/import with migrations and atomic restore`

### Task 6: 폴더 어댑터

**Files:**
- Create: `src/lib/fs/adapter.ts`, `src/lib/fs/memory.ts`, `src/lib/fs/web.ts`
- Test: `src/lib/fs/memory.test.ts`

**Interfaces:**
- Consumes: `AppDB`(`device_local`의 `'backupFolder'`에 핸들 저장)
- Produces:

```ts
interface BackupFolder {
  name: string
  writeFile(name: string, bytes: Uint8Array): Promise<void>
  readFile(name: string): Promise<Uint8Array>
  listFiles(): Promise<string[]>
  deleteFile(name: string): Promise<void>
}
type FolderState = { status: 'ready'; folder: BackupFolder } | { status: 'needs-permission' } | { status: 'none' }
interface FsAdapter {
  isFolderSupported(): boolean
  pickFolder(): Promise<BackupFolder | null>          // 사용자가 취소하면 null
  restoreFolder(): Promise<FolderState>              // 저장된 핸들로 권한 조회만(요청 안 함)
  requestPermission(): Promise<BackupFolder | null>  // 사용자 동작 안에서 호출
  downloadFile(name: string, bytes: Uint8Array): void
  pickFileToRead(): Promise<{ name: string; bytes: Uint8Array } | null>
}
createMemoryFolder(name?: string): BackupFolder & { files: Map<string, Uint8Array> }
createMemoryFsAdapter(folder?: BackupFolder): FsAdapter   // 테스트용, isFolderSupported=true
createWebFsAdapter(db: AppDB): FsAdapter
```

웹 구현: `showDirectoryPicker({ mode: 'readwrite' })`, 핸들을 `device_local` `{ id: 'backupFolder', value: handle }`에 저장, `queryPermission`/`requestPermission({ mode: 'readwrite' })`. 지원하지 않으면 `isFolderSupported()`가 false이고 `downloadFile`은 Blob + `<a download>`로 내려받게 한다. `pickFileToRead`는 `<input type=file accept=".enc">`.

- [ ] **Step 1: 실패하는 테스트**(메모리 구현만): 쓰기 → 목록에 보임, 읽기 → 같은 바이트, 삭제 → 목록에서 빠짐, 없는 파일 읽기 → reject.
- [ ] **Step 2:** FAIL. **Step 3:** 세 파일 구현. **Step 4:** PASS, `npx tsc --noEmit` 통과(web.ts 타입 확인).
- [ ] **Step 5:** 커밋 `feat(fs): backup folder adapter (memory and web)`

### Task 7: 백업 서비스

**Files:**
- Create: `src/lib/backup/service.ts`
- Test: `src/lib/backup/service.test.ts`

**Interfaces:**
- Consumes: Task 2~6의 모든 공개 함수
- Produces:

```ts
const BACKUP_KEEP_DEFAULT = 14
const AUTO_BACKUP_INTERVAL_MS = 86_400_000
const BACKUP_FILE_RE = /^백업_(\d{8})_(\d{4})(?:_(\d+))?\.enc$/
interface CachedKey { key: CryptoKey; salt: Uint8Array; iterations: number; check: string }
backupFileName(now: Date, existing: Set<string>): string
setupPassphrase(db: AppDB, passphrase: string, opts?: { iterations?: number }): Promise<void>
getCachedKey(db: AppDB): Promise<CachedKey | null>
runBackup(db: AppDB, folder: BackupFolder, opts?: { now?: Date; keep?: number }): Promise<string>
rotateBackups(folder: BackupFolder, keep: number): Promise<string[]>   // 지운 파일명
restoreFromBytes(db: AppDB, bytes: Uint8Array, passphrase: string, opts?: { safetyFolder?: BackupFolder; now?: Date }): Promise<void>
needsAutoBackup(lastBackupAt: string | undefined, now: Date): boolean
getLastBackupAt(db: AppDB): Promise<string | undefined>
```

동작 규칙:
- `setupPassphrase`: 8자 미만이면 `Error('암호구는 8자 이상이어야 합니다.')`. salt 16바이트 생성, 키 유도, `device_local` `'backupKey'`에 `CachedKey` 저장(CryptoKey는 IndexedDB에 그대로 저장 가능).
- `runBackup`: 키 없으면 `Error('백업 암호구가 설정되지 않았습니다.')`. export → serialize → `encrypt(key, data, encodeHeader(header))` → `encodeBackupFile` → `backupFileName(now, 기존 파일)`로 저장 → `rotateBackups(folder, keep ?? 14)` → `device_local` `'lastBackupAt'` = now ISO → 파일명 반환.
- `backupFileName`: 현지 시각 `백업_20261104_0905.enc`; 이미 있으면 `_2`, `_3` …
- `rotateBackups`: `BACKUP_FILE_RE`에 맞는 파일만 대상, (날짜, 시각, 번호[없으면 1]) 순으로 정렬해 최신 `keep`개를 남기고 지운다.
- `restoreFromBytes`: `decodeBackupFile` → 머리말의 salt·iterations로 키 유도 → `decrypt`(AAD=`headerBytes`) → `parseSnapshot` → `safetyFolder`가 있고 캐시 키가 있으면 먼저 `runBackup(db, safetyFolder)` → `importSnapshot`. 앞 단계 실패 시 데이터는 바뀌지 않는다.
- `needsAutoBackup`: 값이 없거나 `now - last >= 24시간`이면 true.

- [ ] **Step 1: 실패하는 테스트**(모두 `iterations: 1000`, 메모리 폴더)

```ts
test('파일명 형식', () => expect(backupFileName(new Date(2026, 10, 4, 9, 5), new Set())).toBe('백업_20261104_0905.enc'))
test('같은 분 충돌 시 _2, _3', () => { /* existing에 기본·_2 → _3 */ })
test('8자 미만 암호구 거부')
test('백업 후 같은 암호구로 복원하면 데이터가 같다')
test('다른 기기 시나리오: 새 DB에서 암호구만으로 복원된다')   // getCachedKey 없는 DB
test('틀린 암호구 복원 → BackupDecryptError, 데이터 그대로')
test('잘린 파일 복원 → BackupFormatError, 데이터 그대로')
test('복원 전에 안전 백업 파일이 하나 생긴다')
test('복원 후 device_local의 aiApiKey와 backupKey가 유지된다')
test('15번째 백업 때 가장 오래된 파일 하나가 지워지고, 이름 규칙에 안 맞는 파일은 남는다')
test('정리는 _2가 기본 파일보다 최신으로 취급된다')
test('runBackup은 lastBackupAt을 갱신한다')
test('needsAutoBackup: 없음 true, 23시간 false, 24시간 true')
test('키 없이 runBackup → 오류')
```

- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** `npx vitest run src/lib/backup` PASS.
- [ ] **Step 5:** 커밋 `feat(backup): passphrase setup, backup rotation, restore service`

### Task 8: 앱 셸, 시작 처리, 백업 설정 화면

**Files:**
- Create: `src/app/context.tsx`, `src/app/startup.ts`, `src/components/Nav.tsx`, `src/components/BackupBanner.tsx`, `src/pages/Placeholder.tsx`, `src/pages/settings/SettingsPage.tsx`, `src/pages/settings/BackupSettings.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`, `src/App.test.tsx`
- Test: `src/app/startup.test.ts`, `src/pages/settings/BackupSettings.test.tsx`, `src/App.test.tsx`

**Interfaces:**
- Consumes: `createDb`, `createWebFsAdapter`, `createMemoryFsAdapter`, Task 7 서비스 전부
- Produces:
  - `DbContext`, `FsContext`, `useDb(): AppDB`, `useFs(): FsAdapter`. `App`은 `props: { db?: AppDB; fs?: FsAdapter }`를 받고 없으면 기본값(`createDb()`, `createWebFsAdapter`)을 쓴다.
  - `type StartupStatus = 'done' | 'not-due' | 'needs-setup' | 'needs-folder' | 'needs-permission' | 'failed'`
  - `runStartup(db: AppDB, fs: FsAdapter, now?: Date): Promise<{ backup: StartupStatus; error?: string; persisted: boolean }>` — `navigator.storage?.persist?.()` 시도(없으면 false), 키 없음 → `needs-setup`, 폴더 없음 → `needs-folder`, 권한 필요 → `needs-permission`, 기한 전 → `not-due`, 실행 성공 → `done`, 예외 → `failed`(+메시지).

화면 사양:
- 왼쪽 메뉴 위에 앱 제목 `담임 업무`(h1, Task 1 테스트 유지). 메뉴 순서와 문구: `홈, 출결, 상담일지, 학급, 결석신고서, 통계, 설정`. 경로 `#/`, `#/attendance`, `#/counseling`, `#/class`, `#/reports`, `#/stats`, `#/settings`. 설정 외에는 `Placeholder`("준비 중입니다.").
- 배너 문구: `needs-setup` "백업 암호구가 설정되지 않았습니다. 설정에서 백업을 켜 주세요." / `needs-folder` "백업 폴더가 지정되지 않았습니다." / `needs-permission` "백업 폴더 접근 허용이 필요합니다." + 버튼 "허용"(누르면 `requestPermission` 후 `runBackup`) / `failed` "자동 백업에 실패했습니다: {메시지}". `done`, `not-due`는 배너 없음.
- 설정 > 백업 영역:
  - 암호구 설정: 입력 2칸 + "암호구 저장". 불일치 시 "두 암호구가 일치하지 않습니다.". 설정 화면에 항상 "암호구를 잃으면 백업 파일을 복구할 수 없습니다. 종이 등에 적어 보관하세요." 표시.
  - 폴더: "백업 폴더 지정" 버튼, 지정된 폴더 이름 표시. `isFolderSupported()`가 false면 "이 브라우저는 폴더 자동 백업을 지원하지 않습니다. '백업 파일 내려받기'를 사용하세요."와 내려받기 버튼.
  - "지금 백업" 버튼, "마지막 백업: YYYY-MM-DD HH:mm"(없으면 "아직 없음").
  - 복원: "백업 파일에서 복원" → 파일 선택 → 암호구 입력 → 확인 문구 "현재 데이터가 백업 내용으로 바뀝니다. 복원 전에 현재 상태를 한 번 더 백업합니다." → 실행. 오류는 오류 객체의 메시지를 그대로 표시. 성공 시 "복원했습니다."

- [ ] **Step 1: 실패하는 테스트**

```tsx
test('메뉴 7개가 순서대로 보인다')                       // App, MemoryRouter 대신 HashRouter 그대로
test('runStartup: 키 없음 → needs-setup')
test('runStartup: 키 있음, 폴더 없음 → needs-folder')
test('runStartup: 기한 지남 → done, 폴더에 파일 1개')
test('runStartup: 23시간 전 백업 → not-due, 파일 추가 없음')
test('암호구 불일치 문구')
test('암호구 저장 후 지금 백업 → 메모리 폴더에 백업_ 파일, 마지막 백업 시각 표시')
test('틀린 암호구로 복원 → BackupDecryptError 문구 표시')
```

UI 테스트는 `App`에 `createDb('test-…')`와 `createMemoryFsAdapter()`를 주입한다. 테스트 속도를 위해 `setupPassphrase`의 반복 횟수를 주입할 수 있게 `BackupSettings`에 `iterations?: number` prop을 두고 테스트에서만 1000을 넘긴다(기본은 `PBKDF2_ITERATIONS`).
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** `npm test` 전체 PASS.
- [ ] **Step 5:** 커밋 `feat(app): shell navigation, startup auto-backup, backup settings`

### Task 9: 검증

- [ ] **Step 1:** `npm test` → 전부 PASS, 실패 0.
- [ ] **Step 2:** `npx tsc --noEmit` 오류 0, `npm run build` 성공.
- [ ] **Step 3:** `npm run preview`를 띄우고 Playwright(Chromium)로 `#/settings`를 열어 스크린샷을 확인: 메뉴 7개, 경고 문구, 배너("백업 암호구가 설정되지 않았습니다…")가 보이고 콘솔 오류 0.
- [ ] **Step 4:** 사용자 확인 안내: 노트북 크롬에서 미리보기로 폴더 지정 → 지금 백업 → 폴더에 `.enc` 파일 생성 → 복원까지 해 보기(폴더 선택 창은 자동화가 안 되어 사용자가 직접 확인).
- [ ] **Step 5:** 커밋(필요 시) `chore: stage 1 verification fixes`
