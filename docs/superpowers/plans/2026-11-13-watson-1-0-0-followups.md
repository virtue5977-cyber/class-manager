# Watson 1.0.0 후속 목록

1.0.0 실행 원장에서 옮긴 것(원장은 지움). Plan B(1.0.x 동기화)와 1.0.x 정리 때 본다.

## 결정(Ruling)
- Ruling: 실행 순서 1–8, 11, 12, 9, 10, 13–21 — T10은 T11, T9는 T12 산출물을 소비 — 틀리면 순서만 되돌림.
- Ruling: T9는 T1 지킴이(셸≤6 + watson-* DB)를 VaultGate 앞에 유지 — 1.0 렌더러는 MIN_SHELL 7이라 실제론 안 쓰이나 무해 — 비용 몇 줄.
- Ruling: T1 0.18.1 배포는 사용자가 계획(배포 단계 포함)을 'ㄱㄱ'로 승인했으므로 진행 — 지킴이는 1.0 전에 옛 exe에 퍼져야 함 — 틀리면 렌더러 패치 하나 더.
- Task 7: Ruling: dbName must equal 'watson-'+keyId.slice(0,8), keyId lowercase uuid — plan Global Constraints wording — cost if wrong: one validator line
- Task 8: Ruling: getCachedKey falls back to legacy CryptoKey backupKey when backupKeyRaw absent — plaintext DBs before migration — cost: legacy branch removed later
- Task 8: Ruling: plan gap — passphrase change must rewrap vault pass with same passKey. Added changePassphrase(db, pass, {rewrapVault}) + VaultRewrapContext in Task 8; Task 9 must provide the context (rewrap via buildVaultPayload + desktop.vault.store) — cost if wrong: user's new passphrase wouldn't open data
- Task 12: Ruling: restoreIntoNewVault also creates+returns a recovery code (UI shows it) and uses one fresh passKey for vault pass + backupKeyRaw — spec §3 same-passKey rule — cost: an extra screen
- Task 9: Ruling: VaultGate setup slot (renderSetup prop, default placeholder) for migrate/first-install/incomplete — Task 10 fills it; VaultGate provides VaultRewrapContext (rewrap pass, keep recovery) — cost: a prop rename
- Task 9: Ruling: add main API `vault:reset` (delete vault.json+.bak after explicit renderer request, only when state is incomplete) and `dpapiAvailable` in vault:status — needed by Task 10 / unlock reason line; goes into Task 10 dispatch (exe API list §10 grows by one) — cost: one IPC
- Task 10: Ruling: order DEK → create new DB → vault.store → copy → verify → completeMetaRow → backup → delete old (spec writes vault.json before DB; changed so VaultGate 'missing' never triggers mid-migration) — cost if wrong: crash window semantics
- Task 10: Ruling: vault:reset main API + dpapiAvailable in status (exe API list §10 +1); reset only when old DB exists or new DB has no user rows
- Task 10: Ruling: accept planReports :2/:3 suffix ids for colliding reports (nothing lost) — Plan B must handle pairing of suffixed ids in sync
- Task 10: Ruling: exe main API list §10 +file:save-as — cost: one IPC
- Task 15: Ruling: move bundle:alive from VaultGate to App root (spec: before vault/wizard/PIN/guard); publish script stops copying dist-single (HTML abolished)
- Task 16: Ruling: if agy rejects stream-json flags, fall back to the previous verified argv `-p prompt` (spec §9.5 wants no argv; prompts are pseudonymised; working AI beats unverified @file) — cost: prompt visible in process list on old agy versions; on teacher-PC checklist
- Task 16: fix round 2 — narrow argv-fallback trigger; auth on stderr; utf8 decoding; Ruling: allow network/mapped drives for user-picked/dropped paths (school NAS) — cost: wider fs reach, still user-chosen
- Task 19: Ruling: broken-rows banner text omits sync (not shipped): '손상된 기록 n개 — 백업에서 복원할 수 있습니다'; BackupBanner hidden for vault DB with backupKeyRaw
- Final: Ruling: fix wave also covers minors 1–6 (skip corrupt attachment in export with count; recovery-code restart sentence; '처음부터 다시' on unlock for incomplete vault; rewrite old 0.13 Watson.lnk shortcuts; unready on unWire; encrypt path-roots.json) + NoticeTab flake — all cheap, teacher-facing
- Final: Ruling: re-review found N1 (migration backup silently skips corrupt attachments then deletes old DB → loss); load-bearing → one extra targeted fix by the same fixer (+ safety-backup skip count, Startup .lnk delete when login item on) — cost: one more scoped check

## 미뤄 둔 작은 것
- PinGate rapid double-submit can lose a wrong-attempt count (app bug, found T5)
- deleteNote loads full encrypted blobs just to check existence (notes.ts ~532)
- vault export decrypt+base64 synchronous without yields (UI freeze on large totals) — revisit in Task 20 perf
- vault import holds all re-sealed blobs (~150MB) in memory before the transaction
- redundant second decryptStringAsync in shouldReEncrypt path (may vanish with I3 refactor)
- unwrapDek no iv-length check (fails safely)
- remapReportIds moves still-live links of deleted reports onto survivor (harmless today; check in Task 10 migration)
- NoticeTab tests flaky in vault full-suite runs (different test each time, pass on rerun) — investigate before final
- '_1000' collision suffix parsed as device tag (practically impossible)
- lost-key restore on same PC gets new deviceId → old-tag backup files never rotated (~14 stranded) — mention in Task 9 UI or carry deviceId
- deviceTag overwrites non-hex deviceId — revisit if sync §7.2 reuses key
- spec §3 Drive key file + passphrase unlock path — belongs to Plan B (sync)
- vault:reset has no main-side guard (renderer resetAllowed only)
- marker 'copy' + complete row + old gone → 'blocked' (restore only), unlikely
- non-DPAPI PC asks passphrase again right after migration
- resumeOrReset deletes old DB without backup proof when old has only OLD_SEEDED tables (ai_prompts/school_calendar/reflection_phrases/app_settings may hold teacher edits; data survives in verified new DB) — shrink OLD_SEEDED or require proof
- crash-resume path skips BitLocker notice
- DEK in VaultGate Phase state/setupKey prop during setup (dev DevTools visible)
- incremental login returning a refresh token for a different account switches account silently
- scope lists duplicated in google.ts and googleApi.cjs
- callback error codes other than access_denied collapsed to one message
- old-exe status without scopes maps to CALENDAR scopes → hides '캘린더도 연결' (correct for legacy calendar-only logins)
- 0o600 temp files meaningless on Windows (per-user dir, deleted)
- pre-1.0 bundle on new exe passes Promise as STT path (old bundles pruned after 1.0 install)
- wireBeforeClose lives in FlushOnLeave (mounted once) rather than App root
- NoteEditor marks saved before save resolves; rejected save not retried (pre-existing)
- second instance also clears tmp-dumps/prunes logs
- BrokenRowsBanner misses rows broken before mount
- 누가기록 reads 2,000 rows several times on mount (shared query + chunked render in 1.0.x); time on real school PC
- export peak memory near 150MB cap higher than before; restore ~1s long task + memory near cap — teacher checklist
- readFile uses two auto-transactions (concurrent replace → corrupt error, never wrong data)
- canStartOver opens vault DB without key (harmless at current schema; revisit on schema upgrades)
- old-exe 'changed' detection restarts migration if old exe only refreshed settings → new recovery code (safe, no loop)

## Plan B 메모
- Plan B note: PC rebuilding reports from scratch can produce ids that differ from another PC's drifted ids (report keeps old start_date id) — handle in sync merge

## 측정
- Task 20 measurements (Chromium 153, 2-core VM, median before→after): 홈 469→383ms, 출결 398→396ms, 누가기록 985(worst 1027)→728(759)ms; readFile longest task 10MB 300→0ms, 50MB 1195→53ms; export 5×10MB longest task 1013→203ms; restore longest task 491ms (unchanged)
- 1.0.2 A4 measurement (same VM, 누가기록 중앙, 겹친 읽기 3→1): 725 -> 511ms (최대 766 -> 606ms, 가장 긴 task 126 -> 110ms); 홈·출결 변화 없음
