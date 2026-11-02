# Spec Delta

## Purpose
Let the board ask any machine, local or cloud, to run a small set of known actions through the hub, with signing, validation and an audit trail, so no machine accepts free-form remote commands.

## ADDED Requirements

### Requirement: Commands are signed by the board and limited to fixed verbs
The hub SHALL accept a command only when it is signed with the board's command credential and names one verb from a fixed list with validated arguments; any other verb or malformed argument MUST be rejected.

#### Scenario: Unknown verb
- **WHEN** a signed request names a verb that is not on the list
- **THEN** the hub rejects it and nothing is queued

#### Scenario: Request signed by a machine
- **WHEN** a machine's reporting credential is used to queue a command
- **THEN** the hub rejects it

### Requirement: Machines poll only their own queue
A machine agent SHALL fetch commands addressed to its own identity, SHALL run at most one command at a time, and SHALL post a result (success, failure with a short reason, or refused).

#### Scenario: Command for another machine
- **WHEN** an agent requests the queue
- **THEN** it receives only commands addressed to its own identity

#### Scenario: Two commands queued
- **WHEN** two commands are waiting for one machine
- **THEN** they run one after the other in queue order

### Requirement: Commands are idempotent and expire
A command SHALL carry a unique id, SHALL run at most once, and SHALL be discarded unrun after a time limit.

#### Scenario: Agent restarts mid-poll
- **WHEN** an agent fetches a command, restarts and fetches again
- **THEN** a command already marked running or finished is not run a second time

#### Scenario: Machine asleep
- **WHEN** a command stays queued past its time limit
- **THEN** it is marked expired and never runs when the machine wakes

### Requirement: Every command is audited
The hub SHALL record, for each command, who queued it, the verb, the arguments, the target, each state change and the result, and the board SHALL show this record.

#### Scenario: Reviewing history
- **WHEN** the user opens the command history
- **THEN** each command shows its verb, target, state and result text

### Requirement: Production is not reachable by command
No verb SHALL push to `main`, `master` or a production deployment.

#### Scenario: Attempt to name main
- **WHEN** a `staging-sync` command names `main` as its branch
- **THEN** it is rejected before queuing
