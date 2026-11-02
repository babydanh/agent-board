# Design

## Context (verified before writing)

- Local predicts exact conflicts with `~/.omp/scripts/overlap.py`: each lane (HEAD plus uncommitted files) becomes a temporary commit through a temporary index, then `git merge-tree --write-tree` runs per pair; the `[overlap]` hook in `activity-ledger.ts` reads the result. `backup-push.py` already snapshots dirty worktrees, filters secrets and never touches `main`.
- Cloud machines get only `overlap.py` in `~/bin`, a git-danger hook (`guard.sh`) and `botkeep-nhac`; no ledger, no overlap hook.
- The hub (Node, no dependencies) now runs on a Botkeep node and holds metadata only. Roles today: `report`, `read`. Agents report every 30 s (cloud systemd timer) or 60 s (local loop).
- Each report row already carries `repo` (folder name), `github_repo`, `head`, `origin_main`; the board's overlap code uses only `repo`.
- Measured: the Flutter checkout (`stable`, default branch `master`, an unrelated remote branch `main`) has 105 commits not in `origin/main`, so `changedRanges` listed 200 changed files on both cloud machines. The base `origin/main` is hard-coded in `fleet/agent.mjs`.

## Data plane and control plane

```
local agent ─┐                       ┌─ GitHub  refs/wip/<machine>/<lane>   (code, secret-filtered)
cloud agents ─┼─ report/commands ─▶ hub (Botkeep) ─▶ board (view + buttons)   (metadata, queue, audit)
              └─ judge (one cloud machine per repo) fetches refs/wip, runs git merge-tree, posts verdicts
```

## Decisions

1. **Code travels through GitHub, metadata through the hub.** Chosen. Rejected: diffs through the hub (code and secrets would sit on a 2 GB shared node, size limits); `instabox cp` between machines (needs a credential per machine on a weak local box, no local target).
2. **Snapshots go to `refs/wip/<machine>/<lane>`, not branches.** Chosen because it adds no branch to the repository and triggers no branch-based CI. This is unverified against GitHub: task 2.1 proves it on a throwaway ref before anything depends on it. Fallback: branches named `wip/<machine>/<lane>` with workflows ignoring `wip/**`.
3. **Snapshot method.** Same plumbing as `overlap.py` and `backup-push.py` (temporary index, `commit-tree` with parent HEAD); the real index, working tree and HEAD never change. The secret filter patterns are copied from `backup-push.py` into one tested module; a comment names the source so they are kept in step.
4. **Judge runs on a cloud machine.** Chosen because InstaBox machines already hold the repos, a GitHub token and disk, and the local box is weak. Rejected: Botkeep (unknown git availability, would hold a GitHub token and clones on ~2 GB disk — not measured); the board machine (weak, asleep at times). Selection is deterministic: the online cloud machine with the repo, lowest id. With none online the verdict reads "chưa tính" and local-with-local checks keep working.
5. **Verdict is git's own merge** (`git merge-tree --write-tree` on two snapshot commits) in a scratch clone that fetches `+refs/wip/*:refs/wip/*`. A budget bounds each scan; an unfinished scan is reported as incomplete.
6. **Different base is flagged, not hidden.** Line numbers from machines with different `origin/main` are approximate; the board shows "khác nền" and the judge's merge result (which is exact) replaces them when it exists.
7. **Base is the remote's default branch.** `fleet/agent.mjs` resolves the default branch from `origin/HEAD` and falls back to `main`; this is the root cause of the Flutter noise. A guard on `ahead 0` alone was rejected: it would hide pushed-but-unmerged feature lanes. Measured later on `danh`: the default branch is not enough either, because `stable` has 105 commits `master` lacks (205 files differ), so long-lived branches (main, master, develop, dev, stable, beta, release/*) are measured against their own upstream instead.
8. **Commands ride the existing report round trip.** The report response carries the commands for that machine; the next report carries the results. Rejected: a separate polling endpoint (more auth surface, more requests). The hub gains one new role, `command`, held only by the board with its own key pair; the machine roles cannot queue.
9. **Verbs are a fixed list executed as argv, never through a shell:** `snapshot-push`, `clean-worktree` (clean only, no force), `run-tests` (GitHub Actions through the existing runner), `staging-sync`. Arguments are validated against patterns; `main`, `master` and production names are refused at queue time and again on the machine.
10. **In-session warning reuses existing hooks.** The agent writes verdicts for each lane to `<git-common-dir>/fleet-overlap.json` in the format of the existing `overlap-lanes.json`. Local needs a small read of the second file in `activity-ledger.ts`; cloud gets one `PreToolUse` hook script in the cloud bundle. Both live outside this repository and wait for the user's permission.
11. **Cleanup is two-phase and user-gated.** Scan and back up first, show two unticked lists, run per ticked branch, read the result back from the hub, then remove clean junk. Production is never part of it.

## Risks and mitigations

- Many `refs/wip` refs: prune refs older than a set number of days and push at most once a minute per lane.
- A secret in a snapshot: filter before commit, scan added lines, omit the file and report it; a failed scan blocks that lane's push.
- Hub holds the keys file; if the node's disk resets all machines get 401. Keep a copy of the public keys file and check it after the first node restart.
- The command role is remote execution: fixed verbs, argv only, validation twice, audit log, one command at a time, expiry.
- Sleeping machines miss commands: they expire instead of running late.
