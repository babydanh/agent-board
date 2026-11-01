# Spec Delta

## Purpose
Decide which work on different machines is the same repository and which overlap warnings are trustworthy, so local and cloud lanes are compared only when they truly belong together.

## ADDED Requirements

### Requirement: Repositories are matched by GitHub identity
The system SHALL treat two lanes as the same repository when their reported GitHub identity (owner/name) is equal, and SHALL fall back to the folder name only when a lane reports no GitHub identity.

#### Scenario: Same repository under different folder names
- **WHEN** a local checkout folder `Backend` and a cloud checkout folder `HethongBackendApi_QuanlyGiaiDau` both report `babydanh/HethongBackendApi_QuanlyGiaiDau`
- **THEN** their files are compared for overlap as one repository

#### Scenario: Different repositories with the same folder name
- **WHEN** two lanes share a folder name but report different GitHub identities
- **THEN** they are never compared for overlap

### Requirement: Overlaps from different bases are marked approximate
The system MUST mark an overlap warning as based on different origins when the two sides report a different `origin/main` commit, and MUST NOT present its line numbers as exact.

#### Scenario: Same base
- **WHEN** both machines report the same `origin/main` commit and the same file ranges intersect
- **THEN** the warning is shown at line level without a base-difference mark

#### Scenario: Different base
- **WHEN** the two machines report different `origin/main` commits
- **THEN** the warning is shown at file level with a visible "khác nền" mark

### Requirement: Changes are measured against the repository's own default branch
A machine agent SHALL measure a lane's changed files and its merged/staged state against the repository's default branch as the remote declares it, and SHALL fall back to `main` only when the remote declares none. A lane that is pushed but not yet merged MUST still report its changes.

#### Scenario: Third-party checkout whose default branch is not main
- **WHEN** a checkout such as the Flutter SDK on branch `stable` has default branch `master` and an unrelated remote branch named `main`
- **THEN** its changes are measured against `master`, and it does not report the 105 commits that separate it from the unrelated `main`

#### Scenario: Pushed branch awaiting merge
- **WHEN** a lane has zero commits ahead of its upstream but its work is not yet in the default branch
- **THEN** its changed files are still reported

### Requirement: Local machine reports the shared project repositories
The local reporter SHALL be configured with the main checkout of every repository that cloud machines also work on, so that local and cloud lanes of the same repository can be compared.

#### Scenario: Backend edited on both sides
- **WHEN** local has uncommitted edits to a Backend file and `danh` has the same file in its dirty list
- **THEN** the board shows a local-with-cloud overlap for that file
