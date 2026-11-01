# Spec Delta

## Purpose
Give the user one approved, verifiable path from "lots of worktrees on local and cloud" to "real work on staging and junk removed", without ever touching production or deleting unsaved work.

## ADDED Requirements

### Requirement: Scan, then classify worktrees as junk or real
The system SHALL scan every worktree on every online machine, SHALL back up unsaved work first, and SHALL classify a worktree as junk only when it is already merged into main, or has no commits ahead and no uncommitted files, or is prunable; every other worktree is real.

#### Scenario: Merged worktree
- **WHEN** a worktree's work is already contained in main and it has no uncommitted files
- **THEN** it is listed as junk

#### Scenario: Unsaved work
- **WHEN** a worktree has uncommitted files or commits ahead of its upstream
- **THEN** it is listed as real and its content is backed up before anything else happens

### Requirement: The user approves two lists before anything runs
The board SHALL show a "will go to staging" list and a "will be removed" list, each item unticked by default, and SHALL run nothing for an item the user did not tick.

#### Scenario: Nothing ticked
- **WHEN** the user starts the action without ticking any item
- **THEN** no push and no removal is performed

### Requirement: Staging push is gated and verified
For each ticked branch the system SHALL run the safe-push check, then tests on GitHub Actions, then the staging merge; it SHALL stop that branch on the first failure and report the failing step, and it SHALL confirm that the branch content is on staging by reading it back from the hub.

#### Scenario: Test fails
- **WHEN** the tests for a ticked branch fail
- **THEN** that branch is not merged into staging and the board shows the failing step

#### Scenario: Reached staging
- **WHEN** the staging merge succeeds
- **THEN** within one reporting cycle the hub shows the branch as present on staging

### Requirement: Cleanup removes only clean, verified worktrees
Removal SHALL run only for ticked junk worktrees that are clean at that moment, SHALL NOT use force, and SHALL happen only after a backup of the worktree exists on GitHub.

#### Scenario: Worktree became dirty after the scan
- **WHEN** a ticked junk worktree has an uncommitted file at removal time
- **THEN** it is not removed and is reported as skipped

### Requirement: Production stays manual
The action MUST NOT push to `main` or trigger a production deployment.

#### Scenario: Finished run
- **WHEN** all ticked branches reached staging
- **THEN** the board states that production needs the user's explicit instruction
