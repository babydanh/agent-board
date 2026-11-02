# Tasks

Worktree: `V:/pixel-agents.worktrees/cloud-in-tree` (branch `cloud-in-tree`). Tasks run in order inside a section; sections run P0 → P4. Checks: server `npm run test:server`, webview `npm run test:webview`, fleet `node --test fleet/*.test.mjs fleet/botkeep-hub/*.test.mjs`, types `npm run check-types`. Anything marked `NGOÀI REPO` waits for the user's explicit permission. Pushing `main` is never a task.

## 0. P0 — identity, base and noise

- [x] 0.1 Measure lanes against the remote's default branch. Tiêu chí: `node --test fleet/agent.test.mjs` exit 0 with TC-BASE-DEFAULT-01 (default `master`, unrelated `main`, branch `stable` behind master → `changes` empty) and TC-BASE-DEFAULT-02 (pushed branch ahead 0 but not merged → changes kept); after deploy (0.6) the hub row for `flutter-3.47.9` shows `changes` length 0 on `danh` and `danh1`.
  - Files: sửa `fleet/agent.mjs` (`repoRow`-equivalent block near line 224 and `changedRanges` at line 154; resolve default branch from `origin/HEAD`, fallback `main`; use it for `merged`, `staged`, `origin_main`), `fleet/local-agent.mjs` (`repoRow` at line 60, same helper), test `fleet/agent.test.mjs`, `fleet/local-agent.test.mjs`.
  - Giao: `defaultBranch(path): string` exported from `fleet/agent.mjs` and reused by `fleet/local-agent.mjs`. Nhận: none.
  - Chủ file chung: 0.1 owns `fleet/agent.mjs` for P0; later tasks that touch it (1.x, 2.x) start after 0.1 is merged into this branch.
  - Phụ thuộc: none.
- [x] 0.2 Match repositories by GitHub identity in the board's overlap computation. Tiêu chí: `npm run test:server` exit 0 with TC-IDENT-01 (different folder names, same `github_repo` → one overlap) and TC-IDENT-02 (same folder name, different `github_repo` → none) and TC-IDENT-03 (no `github_repo` → folder-name fallback).
  - Files: sửa `server/src/fleet/fleetSnapshot.ts` (`computeFleetOverlaps`, `hubRepoName`), test mới `server/__tests__/fleetIdentity.test.ts`.
  - Giao: `repoIdentity(repo: FleetHubRepo): string` (lower-case `github_repo` else folder name). Nhận: `FleetHubRepo.github_repo` already typed in `server/src/fleet/hubClient.ts:23`.
  - Chủ file chung: 0.2 owns `fleetSnapshot.ts` until 0.3 is done.
  - Phụ thuộc: none.
- [x] 0.3 Flag overlaps whose two sides have a different base. Tiêu chí: `npm run asyncapi:validate` exit 0; `npm run check-types` exit 0; `npm run test:server` exit 0 with TC-BASE-01 (equal `origin_main` → no mark) and TC-BASE-02 (different → `baseDiffers` true, level `file`); `npm run test:webview` exit 0 with TC-BASE-UI-01 (mark "khác nền" rendered).
  - Files: sửa `core/asyncapi.yaml` (`FleetOverlapWarning`: add `baseDiffers`), regenerate `core/src/messages.ts` with `npm run asyncapi:generate` (never edit by hand), `server/src/fleet/fleetSnapshot.ts`, `webview-ui/src/company/fleet/FleetView.tsx`, tests `server/__tests__/fleetIdentity.test.ts`, `webview-ui/test/fleetBaseMark.test.ts`.
  - Giao: `FleetOverlapWarning.baseDiffers?: boolean`. Nhận: `repoIdentity` from 0.2.
  - Chủ file chung: 0.3 owns `core/asyncapi.yaml` for P0; every later schema change (1.x, 2.x, 3.x) is a separate task that edits it one at a time, then regenerates.
  - Phụ thuộc: 0.2.
- [x] 0.4 Local reporter lists the shared project repositories. Tiêu chí: `node --test fleet/local-agent.test.mjs` exit 0 with TC-LOCALROOTS-01 (config roots expand to every worktree); after the user supplies the paths, `~/.pixel-agents/fleet-local.json` lists them and the hub row for `local-desktop-6g1153o` includes `babydanh/HethongBackendApi_QuanlyGiaiDau`.
  - Files: NGOÀI REPO `~/.pixel-agents/fleet-local.json` (data only, no secret); sửa `fleet/local-agent.test.mjs` only if a gap shows.
  - Giao: none. Nhận: the three repo paths from the user.
  - Chủ file chung: none. Phụ thuộc: 0.1.
- [ ] 0.5 Update `agent.mjs` on `danh` and `danh1`, and on `danh3`–`danh6` when they are awake. Tiêu chí: `systemctl is-active fleet-agent.timer` is `active` on each, and the hub row for `flutter-3.47.9` has no changes.
  - Files: NGOÀI REPO (`/data/home` agent copy on each machine, via `install-agent.sh <id> <hub>` which keeps the key).
  - Giao/Nhận: none. Chủ file chung: none. Phụ thuộc: 0.1 merged; the user approves the deployment.
  - Status 2026-11-02: `danh` and `danh1` verified (agent files match the repo, timer active, `flutter-3.47.9` ahead 0 and dirty 0 on the hub). Still open: `danh3` unreachable (`host_unavailable`), `danh4`–`danh6` suspended (not woken), `danh2` has no `~/.fleet` (no timer).
- [x] 0.6 Light local scan (added 2026-11-02 after the first installed reporter froze the machine: ~15–20 `git` calls per checkout, 63 checkouts, every 60 s, and each call opened a console window — fixed in `086d662d` with `windowsHide`). Tiêu chí: `node --test fleet/lane-scan.test.mjs fleet/git-window.test.mjs` exit 0 with TC-LIGHT-01 (an unchanged checkout is measured once), TC-LIGHT-02 (a changed fingerprint measures again), TC-LIGHT-03 (a changed dirty list measures again), TC-LIGHT-04 (cache per path), TC-LIGHT-05 (fingerprint changes after a commit and after the default branch ref moves, in a linked worktree), TC-LIGHT-06 (a non-repository does not throw); measured on the 63 real checkouts: first cycle 1518 git processes, a steady cycle 68 (63 `git status` + 5 `worktree list`) in 8 s.
  - Changed from the plan after measuring: no activity-ledger read (extra schema coupling for no gain once `git status` is the per-cycle check) and no change-gated post (the cycle is now 120 s, close to the heartbeat, so the post is sent every cycle). Priority is lowered with `os.setPriority` in `--loop` (not covered by a test: it is one guarded call). The "under 20 git calls" target was missed (68), the old cost was ~1200+ per cycle every 60 s.
  - Files: tạo `fleet/laneScan.mjs`, `fleet/lane-scan.test.mjs`; sửa `fleet/local-agent.mjs` (default row scanner, 120 s interval, below-normal priority).
  - Giao: none. Nhận: none. Chủ file chung: `fleet/local-agent.mjs` (also edited by P1.3 and P2.2, so they build on this). Phụ thuộc: 0.4.
  - Gate: the reporter is not installed in the background again (4.1 stays open) until the user has seen the measured count above and agrees.

## 1. P1 — snapshots and the exact verdict

- [ ] 1.1 Prove GitHub accepts the reserved ref namespace. Tiêu chí: push a one-commit ref `refs/wip/test/probe` to a throwaway repository, `git ls-remote` shows it, no workflow run starts, then delete it; result recorded in `design.md` decision 2 (keep refs, or fall back to `wip/**` branches).
  - Files: sửa `openspec/changes/fleet-sync-local-cloud/design.md` (record result only); throwaway repository chosen by the user.
  - Giao: decision "refs" or "branches". Nhận: none. Chủ file chung: none. Phụ thuộc: the user names the throwaway repository.
- [x] 1.2 Secret filter module. Tiêu chí: `node --test fleet/snapshotFilter.test.mjs` exit 0 with TC-SNAPFILTER-01..04 (env file, key file, over 50 MB, token in added line → each omitted and listed).
  - Files: tạo `fleet/snapshotFilter.mjs`, `fleet/snapshotFilter.test.mjs`.
  - Giao: `filterSnapshotFiles(files: {path, size, addedText}[]): { keep: string[], omitted: { path, reason }[] }`. Nhận: patterns copied from `~/.omp/scripts/backup-push.py` (comment names the source).
  - Chủ file chung: owns `snapshotFilter.mjs`. Phụ thuộc: 0.1.
- [x] 1.3 Snapshot builder and pusher (module and tests; the per-cycle call is wired in 1.5 behind an opt-in flag). Tiêu chí: `node --test fleet/snapshot.test.mjs` exit 0 with TC-SNAPSHOT-01 (real index, working tree and HEAD byte-identical before/after), TC-SNAPSHOT-02 (unchanged lane → no push), TC-SNAPSHOT-03 (refuses a ref named main/master/heads), TC-SNAPSHOT-04 (pushes at most once per minute per lane).
  - Files: tạo `fleet/snapshot.mjs`, `fleet/snapshot.test.mjs`; sửa `fleet/agent.mjs` and `fleet/local-agent.mjs` to call it each cycle.
  - Giao: `snapshotLane(lanePath, machineId, {push}): { ref, commit, omitted[] } | null`. Nhận: `filterSnapshotFiles` from 1.2, decision from 1.1.
  - Chủ file chung: `fleet/agent.mjs` is edited by this task only in P1.
  - Phụ thuộc: 1.1, 1.2.
  - Status 2026-11-02: `fleet/snapshotFilter.mjs` (TC-SNAPFILTER-01..05) and `fleet/snapshot.mjs` (TC-SNAPSHOT-01..09, real repositories and a local bare remote) are done and green. Not yet proven against GitHub: 1.1. Nothing calls `snapshotLane` in a loop yet, so no code leaves a machine until 1.1 passes and the user turns the opt-in on. A token-shaped line in the lane's own commits blocks that lane's push (`ref: null`); a dirty secret file is only left out.
- [x] 1.4 Judge: pairwise `git merge-tree` over fetched snapshots. Tiêu chí: `node --test fleet/judge.test.mjs` exit 0 with TC-JUDGE-01 (same lines → conflict with file and range), TC-JUDGE-02 (same file, other region → auto-mergeable), TC-JUDGE-03 (budget hit → incomplete, never clean), TC-JUDGE-04 (lane mid-merge → incomplete).
  - Files: tạo `fleet/judge.mjs`, `fleet/judge.test.mjs` (uses a scratch repository fixture).
  - Giao: `judgeRepo(repoPath, snapshots[], {budgetMs}): Verdict[]` with `Verdict = { a, b, file, status: 'conflict'|'auto'|'clean'|'incomplete', ranges?: [number, number][] }`. Nhận: snapshot refs from 1.3.
  - Chủ file chung: owns `judge.mjs`. Phụ thuộc: 1.3.
  - Status 2026-11-02: `fleet/judge.mjs` and `fleet/judge.test.mjs` (TC-JUDGE-01..07) done and green. A pair is measured only when both snapshots touch a common file; a missing snapshot commit, an `unstable` lane or an exhausted budget gives `incomplete`. Nothing yet sets `unstable` (a lane mid-merge/rebase): the snapshot side must report it in 1.5.
- [ ] 1.5 Judge selection and verdict transport (hub stores and serves verdicts, report carries them). Tiêu chí: `node --test fleet/hub.test.mjs fleet/agent.test.mjs` exit 0 with TC-VERDICT-01 (lowest online cloud id with the repo judges), TC-VERDICT-02 (none online → "chưa tính"), TC-VERDICT-03 (hub rejects an oversized or malformed verdict list).
  - Files: sửa `fleet/hub.mjs` (normalize `verdicts` like `normalizeGuard`), `fleet/agent.mjs` (run judge when selected), `server/src/fleet/hubClient.ts` (type), `server/src/fleet/fleetSnapshot.ts` (merge verdicts into `overlaps`, replace approximate rows), tests.
  - Giao: report field `verdicts: Verdict[]`; `FleetOverlapWarning.verdict?: 'conflict'|'auto'|'incomplete'`. Nhận: `judgeRepo` from 1.4.
  - Chủ file chung: `core/asyncapi.yaml` (add `verdict`), edited by this task alone in P1, then regenerate `core/src/messages.ts`.
  - Phụ thuộc: 1.4, 0.3.
- [ ] 1.6 Board shows verdicts. Tiêu chí: `npm run test:webview` exit 0 with TC-VERDICT-UI-01 (conflict shows file and range), TC-VERDICT-UI-02 (incomplete shows "chưa quét hết", not clean).
  - Files: sửa `webview-ui/src/company/fleet/FleetView.tsx`, test `webview-ui/test/fleetVerdict.test.ts`.
  - Giao: none. Nhận: `verdict` field from 1.5. Chủ file chung: owns `FleetView.tsx` after 0.3. Phụ thuộc: 1.5.
- [ ] 1.7 In-session warning on local and cloud. Tiêu chí: agent writes `<git-common-dir>/fleet-overlap.json` in the existing format (`node --test fleet/agent.test.mjs` TC-OVERLAPFILE-01 exit 0); after the user allows the outside-repo edits, editing a conflicting file in a local session and in a cloud session each shows `[overlap]` naming the other machine; with the hub down the tool call is not blocked.
  - Files: sửa `fleet/agent.mjs`, `fleet/local-agent.mjs` (write the file); NGOÀI REPO `~/.omp/agent/extensions/activity-ledger.ts` (read the second file), NGOÀI REPO cloud bundle hook script plus `install.sh` line.
  - Giao: file `fleet-overlap.json` shape identical to `overlap-lanes.json`. Nhận: verdicts from 1.5.
  - Chủ file chung: outside-repo files edited only after explicit permission. Phụ thuộc: 1.5.

## 2. P2 — command queue

- [ ] 2.1 Hub `command` role, queue, audit log. Tiêu chí: `node --test fleet/hub.test.mjs fleet/botkeep-hub/hub-bundle.test.mjs` exit 0 with TC-CMDQ-01 (machine key cannot queue), TC-CMDQ-02 (unknown verb refused), TC-CMDQ-03 (an agent gets only its own commands), TC-CMDQ-04 (duplicate fetch does not re-run), TC-CMDQ-05 (expiry), TC-CMDQ-06 (audit record has every state change).
  - Files: sửa `fleet/hub.mjs`, `fleet/jwt.mjs` (role `command`), tests; rebuild the Botkeep zip (`fleet/botkeep-hub/build-zip.mjs`).
  - Giao: `POST /v1/commands` (role `command`), `GET /v1/commands` (role `read`, history), report response `{ commands: Command[] }`, report body `{ results: Result[] }`. Nhận: none.
  - Chủ file chung: owns `fleet/hub.mjs` for P2. Phụ thuộc: 1.5.
- [ ] 2.2 Agent command runner with the fixed verbs. Tiêu chí: `node --test fleet/commands.test.mjs` exit 0 with TC-CMDRUN-01 (argv only, no shell), TC-CMDRUN-02 (names `main`/`master` → refused), TC-CMDRUN-03 (one at a time), TC-CMDRUN-04 (`clean-worktree` refuses dirty and never forces).
  - Files: tạo `fleet/commands.mjs`, `fleet/commands.test.mjs`; sửa `fleet/agent.mjs`, `fleet/local-agent.mjs`.
  - Giao: `runCommand(cmd, deps): Result`. Nhận: `Command` shape from 2.1.
  - Chủ file chung: `fleet/agent.mjs` owned here for P2. Phụ thuộc: 2.1.
- [ ] 2.3 Board signs and queues commands. Tiêu chí: `npm run test:server` exit 0 with TC-CMDBOARD-01 (new key pair created with mode 0600, public key printed for the user to register), TC-CMDBOARD-02 (unprivileged socket refused); the command history view shows verb, target, state, result.
  - Files: sửa `server/src/fleet/hubClient.ts`, `server/src/fleet/handler.ts`, `core/asyncapi.yaml` (+ regenerate), `webview-ui/src/company/fleet/FleetView.tsx`, tests.
  - Giao: `fleetCommandQueue`, `fleetCommandHistory` messages (privileged only). Nhận: hub API from 2.1.
  - Chủ file chung: `core/asyncapi.yaml` owned here for P2. Phụ thuộc: 2.1.
- [ ] 2.4 Register the board's command key and update the hub. Tiêu chí: queuing a `snapshot-push` for `danh` from the board runs it and the result shows `success`; the same request signed with `danh`'s key is refused.
  - Files: NGOÀI REPO hub `keys.json` on Botkeep (the user pastes the public key), redeploy the zip.
  - Giao/Nhận: none. Chủ file chung: none. Phụ thuộc: 2.1, 2.3.

## 3. P3 — "Dọn & lên staging"

- [ ] 3.1 Scan and classification. Tiêu chí: `npm run test:server` exit 0 with TC-CLEAN-CLASS-01 (merged, empty or prunable → junk; dirty or unpushed → real), TC-CLEAN-CLASS-02 (unknown state → real), TC-CLEAN-CLASS-03 (a checkout with a live session or changed in the last 24 hours → real, design decision 12), TC-CLEAN-CLASS-04 (cleanup is queued only to the machine that owns the checkout).
  - Files: tạo `server/src/fleet/cleanupPlan.ts`, test `server/__tests__/fleetCleanupPlan.test.ts`; reads guard data already in the hub rows.
  - Giao: `planCleanup(machines): { staging: Item[], junk: Item[] }`. Nhận: guard rows (`mergedToMain`, `unpushed`, `dirty`, `prunable`, `backedUp`).
  - Chủ file chung: owns `cleanupPlan.ts`. Phụ thuộc: 2.3.
- [ ] 3.2 Pipeline runner on the board server (backup → check → tests → staging → read-back → clean). Tiêu chí: `npm run test:server` exit 0 with TC-CLEAN-RUN-01 (nothing ticked → no command queued), TC-CLEAN-RUN-02 (tests fail → branch stops, step named), TC-CLEAN-RUN-03 (read-back not seen in time → reported "chưa thấy trên staging", no cleanup), TC-CLEAN-RUN-04 (worktree dirty at removal → skipped), TC-CLEAN-RUN-05 (no step ever names main or production).
  - Files: tạo `server/src/fleet/cleanupRunner.ts`, test `server/__tests__/fleetCleanupRunner.test.ts`; sửa `server/src/fleet/handler.ts`.
  - Giao: messages `fleetCleanupPlan`, `fleetCleanupStart`, `fleetCleanupProgress`. Nhận: `planCleanup`, command API from 2.3.
  - Chủ file chung: `core/asyncapi.yaml` owned here for P3. Phụ thuộc: 3.1, 2.2.
- [ ] 3.3 Board screen with two unticked lists and live progress. Tiêu chí: `npm run test:webview` exit 0 with TC-CLEAN-UI-01 (items start unticked), TC-CLEAN-UI-02 (start disabled with nothing ticked), TC-CLEAN-UI-03 (final message says production needs the user's instruction), TC-CLEAN-UI-04 (two ticked branches whose verdict is `conflict` or `incomplete` disable Start and name the pair, design decision 13; staging runs one branch at a time, each read back before the next).
  - Files: tạo `webview-ui/src/company/fleet/CleanupDialog.tsx`, test `webview-ui/test/fleetCleanup.test.ts`; sửa `webview-ui/src/company/fleet/FleetView.tsx`.
  - Giao: none. Nhận: messages from 3.2. Chủ file chung: `FleetView.tsx`. Phụ thuộc: 3.2.
- [ ] 3.4 Dry run on real data. Tiêu chí: with the user ticking one real branch and one junk worktree, the branch appears on staging (hub row `staged: true`), the junk worktree is gone after a verified backup, `main` is unchanged (`git ls-remote` shows the same SHA before and after).
  - Files: none (acceptance run). Giao/Nhận: none. Chủ file chung: none. Phụ thuộc: 3.3, 2.4.

## 4. P4 — keep it running

- [ ] 4.1 Local reporter as a scheduled task. Tiêu chí: after a reboot `local-desktop-6g1153o` reports within 2 minutes without a terminal open; the task entry is removable with one command.
  - Files: tạo `fleet/install-local-task.mjs` and `fleet/install-local-task.test.mjs` (TC-LOCALTASK-01..06); NGOÀI REPO a launcher in the user's Startup folder plus a copy of the agent in `~/.pixel-agents/fleet-agent/` (made only with `--apply`, undone with `--remove`). Changed from the plan: a Node script and a Startup launcher instead of a PowerShell script and Task Scheduler, so it needs no admin rights and can be tested. Also `fleet/agent.mjs` `contentIn` caches its answer per HEAD and ref commit, with `fleet/content-in.test.mjs` (TC-CONTENTIN-01..04): measured on 63 checkouts, one full report took 126–168 s the first time and 52 s the second, because `merge-tree` cost ~94 s of the first. Giao/Nhận: none. Chủ file chung: none. Phụ thuộc: 0.4.
  - Open: `--apply` has not run (the permission classifier refused it as persistence; the user runs it). The first scan after a reboot still takes over 2 minutes on this machine, so "within 2 minutes" is not met on a cold start.
- [ ] 4.2 Silence warning and wake re-point. Tiêu chí: `npm run test:server` exit 0 with TC-SILENCE-01 (hub unreachable → board says so, not "empty fleet"), TC-SILENCE-02 (a machine silent past the threshold shows "im lặng", not an error); `danh3`–`danh6` each point at the Botkeep hub after waking.
  - Files: sửa `server/src/fleet/handler.ts`, `webview-ui/src/company/fleet/FleetView.tsx`, tests; NGOÀI REPO per-machine re-point through `install-agent.sh`.
  - Giao: none. Nhận: none. Chủ file chung: `FleetView.tsx`. Phụ thuộc: 3.3.
- [ ] 4.3 Prune old snapshot refs. Tiêu chí: `node --test fleet/snapshot.test.mjs` exit 0 with TC-SNAPPRUNE-01 (refs older than the limit removed, newer kept, only this machine's namespace touched).
  - Files: sửa `fleet/snapshot.mjs`, `fleet/snapshot.test.mjs`. Giao/Nhận: none. Chủ file chung: owns `snapshot.mjs`. Phụ thuộc: 1.3.
- [ ] 4.4 Final verification and report. Tiêu chí: `npm run check-types`, `npm run lint`, `npm run test:server`, `npm run test:webview`, `node --test fleet/*.test.mjs fleet/botkeep-hub/*.test.mjs`, `npm run test:package-contract` all exit 0; secret scan of staged diff is empty.
  - Files: none. Giao/Nhận: none. Chủ file chung: none. Phụ thuộc: 0–4 above.
