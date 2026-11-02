# Spec Delta

## Purpose
Predict, before merging, whether work on one machine conflicts with work on another, using the same merge that git will run, and tell the people and sessions involved while they are still editing.

## ADDED Requirements

### Requirement: Machines publish a safe snapshot of each changed lane
Each machine agent SHALL publish a snapshot of every lane that has uncommitted or unpushed work to GitHub under a reserved ref namespace for work-in-progress, SHALL NOT write to `main`, `master` or any branch, and SHALL publish only when the lane changed since its last snapshot.

#### Scenario: A lane changes
- **WHEN** a lane gains an uncommitted edit
- **THEN** within one reporting cycle a snapshot containing that edit is published under that machine's namespace, and the working tree, index and HEAD of the lane are unchanged

#### Scenario: Nothing changed
- **WHEN** a lane is identical to its last published snapshot
- **THEN** no push is made

### Requirement: Snapshots never contain secrets
A snapshot MUST exclude files whose name marks them as secrets (environment files, private keys, keystores, service-account files), files over 50 MB, and any file whose added lines contain a recognisable token; when such content is found the file is omitted and the omission is reported, not pushed.

#### Scenario: Environment file in the lane
- **WHEN** a lane has an untracked `.env` file
- **THEN** the snapshot is published without it and the report lists it as omitted

### Requirement: Cross-machine verdict uses a real merge
For each pair of snapshots of the same repository from different machines that touch a common file, the system SHALL run git's own merge of the two snapshots and SHALL report the result as clean, auto-mergeable or conflicting with file and line range.

#### Scenario: Same lines edited on two machines
- **WHEN** local and `danh` edit overlapping lines of one file
- **THEN** the verdict is "conflict" with that file and line range

#### Scenario: Same file, different regions
- **WHEN** local and `danh` edit the same file in non-overlapping regions
- **THEN** the verdict is "auto-mergeable"

#### Scenario: Not fully scanned
- **WHEN** the scan stops early because of a time budget or a lane in the middle of a merge or rebase
- **THEN** the result says it is incomplete and never reports "clean"

### Requirement: Verdicts reach people and sessions
Verdicts SHALL be delivered through the hub to the board and to a warning shown inside the coding session of each machine involved, before the session writes to a conflicting file.

#### Scenario: Warning before editing
- **WHEN** a session is about to edit a file that conflicts with another machine's snapshot
- **THEN** it receives a warning naming the other machine, branch, file and line range

#### Scenario: Hub unreachable
- **WHEN** the hub cannot be reached
- **THEN** the session continues to work and the warning is skipped without blocking any tool call
