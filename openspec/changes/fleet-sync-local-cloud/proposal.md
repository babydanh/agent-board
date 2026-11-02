# Proposal

## Why

The board shows local and cloud machines side by side, but they do not coordinate. Overlap between a local lane and a cloud lane is only file-level (local reports file names, not lines), repos are matched by folder name rather than identity, a non-project checkout (`flutter-3.47.9`, `ahead 0`, `dirty 0`) produces about 200 false line overlaps, a cloud session never learns what local is editing, and "push everything to staging and tidy the junk worktrees" has no tracked, approved, verifiable path. Local already predicts exact conflicts (`overlap.py`: temp-index snapshot of each lane, then `git merge-tree`) and warns inside the session (`[overlap]` hook); cloud has the script in `~/bin` but no hook, no ledger and no cross-machine view.

## What Changes

- P0 identity and noise: match repos by `github_repo` (fallback folder name), flag overlaps whose two sides have a different `origin_main` as "different base", stop sending `changes` for a lane with `ahead 0` and `dirty 0`, and have local report the QuanLyGiaiDau repos so local and cloud can meet in one repo.
- P1 exact cross-machine overlap: every machine pushes a secret-filtered snapshot of each changed lane to `refs/wip/<machine>/<lane>` on GitHub (never `main`, never a branch, so no CI trigger); a cloud machine fetches the snapshots of other machines for the same repo and runs `git merge-tree --write-tree` per pair; results travel through the hub and reach the board and the in-session `[overlap]` hook on local and on cloud.
- P2 command queue: the hub gains a signed queue of fixed verbs (`snapshot-push`, `clean-worktree`, `run-tests`, `staging-sync`); machine agents poll their own queue and run only allow-listed argv, one at a time, and post a result; every command is logged.
- P3 "Dọn & lên staging": one board action that scans, backs up, classifies worktrees (junk vs real), shows two lists for the user to tick, then per ticked branch runs `safe-push-check`, tests on GitHub Actions and `staging-sync`, confirms through the hub that the branch reached staging, and only then removes clean junk worktrees.
- P4 reliability: local reporter runs as a scheduled task, machines that wake re-point to the hub, the board warns when the hub or a machine goes silent, and old `refs/wip` refs are pruned.

## Out of scope

- Any push to `main` or production: stays "đẩy main" by explicit user phrase only.
- Hosting the merge computation on Botkeep: the hub stays a metadata mailbox (no git, no code, no GitHub token).
- Moving or syncing source code through the hub.
- Automatic conflict resolution or automatic merging of local with cloud work.
- Waking sleeping cloud machines automatically (user or board wakes them).
- Editing `~/.omp` global files (activity-ledger hook, cloud-bundle) without separate user permission: tasks that need them are marked and wait for it.

## Capabilities

### New Capabilities
- `fleet-repo-identity`: repo matching by GitHub identity, base-difference flag, no false overlap from untouched checkouts.
- `fleet-exact-overlap`: snapshots on GitHub, merge-tree verdict per pair, results through the hub, in-session warning.
- `fleet-command-queue`: signed, allow-listed, audited commands from the board to machine agents.
- `fleet-staging-cleanup`: approved scan, backup, staging push and junk cleanup with verification.

### Modified Capabilities
- None (the repository has no archived specs yet).

## Impact

- Code: `fleet/agent.mjs`, `fleet/local-agent.mjs`, `fleet/hub.mjs`, `fleet/botkeep-hub/*`, new `fleet/snapshot.mjs`, `fleet/judge.mjs`, `fleet/commands.mjs`; `server/src/fleet/*` (`fleetSnapshot.ts`, `handler.ts`, `hubClient.ts`); `core/asyncapi.yaml` (regenerate `core/src/messages.ts`); `webview-ui/src/company/fleet/*`.
- Outside the repo (need user permission): `~/.omp/agent/extensions/activity-ledger.ts`, `~/.omp/cloud-bundle/*`, systemd units on cloud machines, Windows Task Scheduler entry.
- Security: command verbs are the only remote execution surface; the command-signing key is held by the board only.
