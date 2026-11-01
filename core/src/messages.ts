/**
 * AUTO-GENERATED FROM core/asyncapi.yaml. DO NOT EDIT MANUALLY.
 *
 * Run `npm run asyncapi:generate` to regenerate.
 *
 * Source of truth: the yaml at core/asyncapi.yaml.
 * Editors and clients in any language can consume the spec directly.
 */

export type ServerMessage =
  | ProviderCapabilities
  | AgentCreated
  | AgentClosed
  | AgentSelected
  | ExistingAgents
  | AgentStatus
  | AgentToolStart
  | AgentToolDone
  | AgentToolsClear
  | AgentToolPermission
  | AgentToolPermissionClear
  | SubagentToolStart
  | SubagentToolDone
  | SubagentClear
  | SubagentToolPermission
  | AgentTeamInfo
  | AgentContextUsage
  | LayoutLoaded
  | FurnitureAssetsLoaded
  | CharacterSpritesLoaded
  | PetSpritesLoaded
  | FloorTilesLoaded
  | WallTilesLoaded
  | CarpetTilesLoaded
  | OfficeAccess
  | SettingsLoaded
  | BypassPermissionsUpdated
  | HooksStatus
  | HooksConsentRequest
  | ExternalAssetDirectoriesUpdated
  | AreaMappingsLoaded
  | DirectoriesLoaded
  | DirectorySaved
  | DirectoryRejected
  | DirectorySuggestions
  | TerminalAvailability
  | TerminalSessionOpened
  | TerminalSessionClosed
  | AgentDiagnostics
  | CompanySnapshotMessage
  | CompanyStateChangedMessage
  | CompanyCommandResultMessage
  | CompanyWorkItemsMessage
  | CompanySquadMessage
  | CompanySquadLiveMessage
  | CompanyTextDeltaMessage
  | CompanySessionLogMessage
  | HerdrAgentsMessage
  | HerdrScreenMessage
  | BrowserReaperStatusMessage
  | CompanySessionInfoMessage
  | HerdrInfoMessage
  | CompanyModelCatalogMessage
  | CompanyOmpSessionsMessage
  | CompanyWorkspacesMessage
  | CompanyArtifactPageMessage
  | CompanyFileListMessage
  | CompanyFileReadMessage
  | CompanyAttachmentUploadedMessage
  | UsageLimitsMessage
  | UsageHistoryMessage
  | UsageStatsMessage
  | LedgerSnapshotMessage
  | LedgerOpenSpecSnapshotMessage
  | LedgerOpenSpecFileMessage
  | LedgerTimelineMessage
  | LedgerFileDiffMessage
  | LedgerFileHistoryMessage
  | LedgerCoordinationMessage
  | LedgerToolUsageMessage
  | LedgerCommandResultMessage
  | FleetSnapshotMessage
  | FleetCommandResultMessage
  | FleetTerminalOpenedMessage
  | FleetTaskCreatedMessage
  | FleetTaskCleanedMessage
  | FleetLavishOpenedMessage
  | FleetDiffMessage
  | ProjectTreeSnapshotMessage
  | ProjectDiffMessage
  | ProjectSettingsMessage
  | ProjectCommandResultMessage
  | ProjectSessionStartResultMessage
  | ProjectImageSavedMessage
  | ProjectMergePreviewResultMessage
  | ProjectBranchCompareMessage
  | LibraryClaudeRolesSnapshot
  | LibraryAccountsSnapshot
  | LibrarySkillsSnapshot
  | LibraryMcpSnapshot
  | LibraryStorageSearchResult
  | LibrarySkillPreview
  | LibraryCommandResult
  | TerminalAttachedMessage
  | TerminalSnapshotMessage
  | TerminalDataMessage
  | TerminalClosedMessage
  | TerminalAttachedMessage
  | TerminalSnapshotMessage
  | TerminalDataMessage
  | TerminalClosedMessage;

export type ClientMessage =
  | WebviewReady
  | LaunchAgent
  | FocusAgent
  | CloseAgent
  | SaveAgentSeats
  | SaveLayout
  | SetSoundEnabled
  | SetLastSeenVersion
  | SetAlwaysShowLabels
  | SetGhostHeadlessAgents
  | SetHooksEnabled
  | HooksConsentResponse
  | SetHooksInfoShown
  | SetWatchAllSessions
  | ExportLayout
  | ImportLayout
  | OpenSessionsFolder
  | AddExternalAssetDirectory
  | RemoveExternalAssetDirectory
  | SaveAreaMappings
  | SetShowAreas
  | SetBypassPermissions
  | SetShowHostDirectories
  | SaveDirectory
  | RemoveDirectory
  | RequestDirectorySuggestions
  | RequestDiagnostics
  | CompanySnapshotRequestMessage
  | CompanyPromptSubmitMessage
  | CompanyContractDecisionMessage
  | CompanyQuestionAnswerMessage
  | CompanySessionControlMessage
  | CompanyPromptCancelMessage
  | CompanyOmpSessionsRequestMessage
  | CompanySessionResumeMessage
  | CompanyWorkspaceOpenMessage
  | CompanySettingsUpdateMessage
  | CompanyModelCatalogRequestMessage
  | CompanyArtifactRequestMessage
  | CompanyFileListRequestMessage
  | CompanyFileReadRequestMessage
  | CompanyAttachmentUploadMessage
  | CompanySessionLogRequestMessage
  | CompanySessionRenameMessage
  | CompanySessionInfoRequestMessage
  | CompanyChatNewMessage
  | CompanyViewModeMessage
  | CompanyFolderPickMessage
  | CompanyFolderNameMessage
  | CompanyFolderForgetMessage
  | CompanyWorkItemCreateMessage
  | CompanyWorkItemAssignMessage
  | CompanyWorkItemFollowUpMessage
  | CompanyWorkItemMarkMessage
  | CompanyWorkItemCloudPushMessage
  | CompanyWorkItemCloudPullMessage
  | CompanyCloudIssueCloseMessage
  | CompanyWorkItemCancelMessage
  | CompanyWorkItemDependenciesMessage
  | CompanyWorkItemJudgeMessage
  | CompanyWorkItemCleanWorktreeMessage
  | CompanyAgentRoleSetMessage
  | CompanySquadSettingsSetMessage
  | CompanySquadRequestMessage
  | CompanySquadApproveMessage
  | CompanySquadDismissMessage
  | CompanySquadCancelMessage
  | CompanySquadRemoveMessage
  | CompanySquadRetryMessage
  | CompanySquadReplyMessage
  | CompanySquadCloseMessage
  | CompanySquadClaudeCheckMessage
  | LedgerViewRequestMessage
  | LedgerOpenSpecRequestMessage
  | LedgerOpenSpecFileRequestMessage
  | LedgerTimelineRequestMessage
  | LedgerFileDiffRequestMessage
  | LedgerFileHistoryRequestMessage
  | LedgerCoordinationRequestMessage
  | LedgerToolUsageRequestMessage
  | LedgerSendMessage
  | FleetRequestMessage
  | FleetTerminalOpenMessage
  | FleetTaskCreateMessage
  | FleetTaskCleanMessage
  | FleetMachineWakeMessage
  | FleetLavishOpenMessage
  | FleetLavishDeleteMessage
  | FleetDiffRequestMessage
  | FleetCloudCommentSendMessage
  | FleetBranchActionMessage
  | ProjectTreeRequestMessage
  | ProjectNodeCreateMessage
  | ProjectNodeUpdateMessage
  | ProjectNodeDeleteMessage
  | ProjectNodeMoveMessage
  | ProjectDiffRequestMessage
  | ProjectCommentMessage
  | ProjectSettingsRequestMessage
  | ProjectSettingsSetMessage
  | ProjectSettingsClearMessage
  | ProjectSessionStartMessage
  | ProjectSessionStopMessage
  | ProjectSessionWakeMessage
  | ProjectImageSaveMessage
  | ProjectBranchCompareRequestMessage
  | ProjectMergePreviewRequestMessage
  | LibrarySnapshotRequest
  | LibrarySkillPreviewRequest
  | LibraryClaudeRoleSet
  | LibrarySkillModeSet
  | LibraryStorageSearchRequest
  | LibraryWorkItemRestore
  | LibraryAccountLogin
  | LibraryMcpCheckRequest
  | HerdrReadMessage
  | HerdrPromptMessage
  | HerdrKeysMessage
  | HerdrFocusMessage
  | HerdrRenameMessage
  | HerdrInfoRequestMessage
  | HerdrCloseMessage
  | HerdrWakeMessage
  | HerdrWatchMessage
  | BrowserReaperReapNow
  | UsageLimitsRequestMessage
  | UsageHistoryRequestMessage
  | UsageStatsRequestMessage
  | TerminalAttachMessage
  | TerminalInputMessage
  | TerminalResizeMessage
  | TerminalDetachMessage;

export interface ProviderCapabilities {
  type: 'providerCapabilities';
  readingTools: string[];
  subagentToolNames: string[];
}

export interface AgentCreated {
  type: 'agentCreated';
  id: number;
  directoryName?: string;
  isExternal?: boolean;
  palette?: number;
  hueShift?: number;
}

export interface AgentClosed {
  type: 'agentClosed';
  id: number;
}

export interface AgentSelected {
  type: 'agentSelected';
  id: number;
}

export interface ExistingAgents {
  type: 'existingAgents';
  agents: number[];
  agentMeta: Record<string, AgentSeatMeta>;
  directoryNames: Record<string, string>;
  externalAgents: Record<string, boolean>;
}

export interface AgentSeatMeta {
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

export interface AgentStatus {
  type: 'agentStatus';
  id: number;
  status: AgentActivityStatus;
  awaitingInput?: boolean;
}

export type AgentActivityStatus = 'active' | 'waiting';

export interface AgentToolStart {
  type: 'agentToolStart';
  id: number;
  toolId: string;
  status: string;
  toolName?: string;
  permissionActive?: boolean;
  runInBackground?: boolean;
  isTeammateSpawn?: boolean;
}

export interface AgentToolDone {
  type: 'agentToolDone';
  id: number;
  toolId: string;
}

export interface AgentToolsClear {
  type: 'agentToolsClear';
  id: number;
}

export interface AgentToolPermission {
  type: 'agentToolPermission';
  id: number;
}

export interface AgentToolPermissionClear {
  type: 'agentToolPermissionClear';
  id: number;
}

export interface SubagentToolStart {
  type: 'subagentToolStart';
  id: number;
  parentToolId: string;
  toolId: string;
  status: string;
}

export interface SubagentToolDone {
  type: 'subagentToolDone';
  id: number;
  parentToolId: string;
  toolId: string;
}

export interface SubagentClear {
  type: 'subagentClear';
  id: number;
  parentToolId: string;
}

export interface SubagentToolPermission {
  type: 'subagentToolPermission';
  id: number;
  parentToolId: string;
}

export interface AgentTeamInfo {
  type: 'agentTeamInfo';
  id: number;
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}

export interface AgentContextUsage {
  type: 'agentContextUsage';
  id: number;
  contextTokens: number;
  maxContextTokens: number;
}

export interface LayoutLoaded {
  type: 'layoutLoaded';
  layout: Record<string, any> | null;
  wasReset?: boolean;
}

export interface FurnitureAssetsLoaded {
  type: 'furnitureAssetsLoaded';
  catalog: FurnitureAssetMessage[];
  sprites: Record<string, string[][]>;
}

export interface FurnitureAssetMessage {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

export interface CharacterSpritesLoaded {
  type: 'characterSpritesLoaded';
  characters: CharacterSpriteSet[];
}

export interface CharacterSpriteSet {
  down: string[][][];
  up: string[][][];
  right: string[][][];
}

export interface PetSpritesLoaded {
  type: 'petSpritesLoaded';
  pets: PetSpriteFrameSet[];
  petNames: string[];
}

export interface PetSpriteFrameSet {
  walkDown: string[][][];
  idleDown: string[][][];
  walkUp: string[][][];
  idleUp: string[][][];
  walkRight: string[][][];
}

export interface FloorTilesLoaded {
  type: 'floorTilesLoaded';
  sprites: string[][][];
}

export interface WallTilesLoaded {
  type: 'wallTilesLoaded';
  sets: string[][][][];
}

export interface CarpetTilesLoaded {
  type: 'carpetTilesLoaded';
  sets: string[][][][];
}

export interface OfficeAccess {
  type: 'officeAccess';
  readOnly: boolean;
}

export interface SettingsLoaded {
  type: 'settingsLoaded';
  soundEnabled: boolean;
  lastSeenVersion: string;
  extensionVersion: string;
  watchAllSessions: boolean;
  alwaysShowLabels: boolean;
  ghostHeadlessAgents: boolean;
  hooksEnabled: boolean;
  hooksInfoShown: boolean;
  externalAssetDirectories: string[];
  showAreas: boolean;
  bypassPermissions: boolean;
  showHostDirectories: boolean;
}

export interface BypassPermissionsUpdated {
  type: 'bypassPermissionsUpdated';
  enabled: boolean;
}

export interface HooksStatus {
  type: 'hooksStatus';
  providerId: string;
  installed: boolean;
}

export interface HooksConsentRequest {
  type: 'hooksConsentRequest';
  providerId: string;
  headline: string;
  disclosure: string;
}

export interface ExternalAssetDirectoriesUpdated {
  type: 'externalAssetDirectoriesUpdated';
  dirs: string[];
}

export interface AreaMappingsLoaded {
  type: 'areaMappingsLoaded';
  mappings: Record<string, string[]>;
}

export interface DirectoriesLoaded {
  type: 'directoriesLoaded';
  directories: Directory[];
}

export interface Directory {
  name: string;
  path: string;
  source: DirectorySource;
}

export type DirectorySource = 'user' | 'host';

export interface DirectorySaved {
  type: 'directorySaved';
  directory: Directory;
}

export interface DirectoryRejected {
  type: 'directoryRejected';
  path: string;
  reason: string;
}

export interface DirectorySuggestions {
  type: 'directorySuggestions';
  paths: string[];
}

export interface TerminalAvailability {
  type: 'terminalAvailability';
  available: boolean;
  reason?: string;
}

export interface TerminalSessionOpened {
  type: 'terminalSessionOpened';
  agentId: number;
}

export interface TerminalSessionClosed {
  type: 'terminalSessionClosed';
  agentId: number;
  exitCode?: number;
}

export interface AgentDiagnostics {
  type: 'agentDiagnostics';
  agents: Record<string, any>[];
}

export interface CompanySnapshotMessage {
  type: 'companySnapshot';
  requestId: string;
  snapshot: CompanySnapshot;
  workspacePath?: string;
}

export interface CompanySnapshot {
  revision: number;
  settings: CompanySettings;
  prompts: CompanyPromptSummary[];
  contracts: Contract[];
  tasks: Task[];
  sessions: CompanySessionSummary[];
  questions: Question[];
  quotas: QuotaSnapshot[];
  diagnostics?: CompanyDiagnostics;
  attempts?: Attempt[];
  evidence?: VerificationEvidence[];
  reports?: CompanyReport[];
  usage?: UsageRecord[];
}

export interface CompanySettings {
  workspacePath: string;
  maxRetainedSessions: 10;
  maxLiveRunners: 4;
  maxConcurrentModelCalls: 4;
  maxWorkers: 4;
  idleParkSeconds: 120;
  roleProfiles: Record<string, RoleProfile>;
  verificationProfiles: Record<string, VerificationProfile>;
}

export interface RoleProfile {
  role: CompanyRole;
  requestedModel: string;
  thinking: string;
  workflowFingerprint: string;
  toolsPolicy: AnonymousSchema_226;
}

export type CompanyRole = 'director' | 'advisor' | 'worker' | 'qa' | 'judge' | 'chat';

export type AnonymousSchema_226 = 'read-only' | 'scoped-write' | 'verification-only' | 'omp';

export interface VerificationProfile {
  id: string;
  criterionIds: string[];
  commands: VerificationCommand[];
  prerequisites: string[];
  outputScopes: string[];
}

export interface VerificationCommand {
  id: string;
  executable: string;
  argv: string[];
  cwd: string;
  timeoutSeconds: number;
}

export interface CompanyPromptSummary {
  id: string;
  preview: string;
  createdAt: string;
  attachments: PromptAttachment[];
  targetSessionId?: string;
}

export interface PromptAttachment {
  artifactId: string;
  fileName: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
}

export interface Contract {
  id: string;
  code: string;
  revision: number;
  title?: string;
  summary?: string;
  promptIds: string[];
  requirements: Requirement[];
  phases: Phase[];
  tasks: Task[];
  assumptions: string[];
  decisions: string[];
  risks?: string[];
  acceptance: AcceptanceCriterion[];
  architectureReviews?: CompanyArchitectureReview[];
  relatedFiles?: RelatedWorkspaceFile[];
  status: AnonymousSchema_340;
}

export interface Requirement {
  id: string;
  promptId: string;
  fragmentIds: string[];
  text: string;
  kind: AnonymousSchema_267;
  status: AnonymousSchema_268;
}

export type AnonymousSchema_267 = 'goal' | 'constraint' | 'context';

export type AnonymousSchema_268 = 'open' | 'clarification' | 'planned' | 'satisfied' | 'blocked';

export interface Phase {
  id: string;
  title: string;
  ordinal: number;
  taskIds: string[];
  acceptanceIds: string[];
}

export interface Task {
  id: string;
  code: string;
  contractId: string;
  phaseId: string;
  title: string;
  requirementIds: string[];
  dependsOn: string[];
  workstreamId: string;
  readScopes: ReadScope[];
  writeScopes: WriteScope[];
  sharedResources: string[];
  acceptance: string[];
  executionMode: AnonymousSchema_302;
  sessionId?: string;
  status: AnonymousSchema_304;
  attemptIds: string[];
  routeReason: string;
  relatedFiles?: RelatedWorkspaceFile[];
}

export interface ReadScope {
  path: string;
  kind: AnonymousSchema_290;
  operations: AnonymousSchema_292[];
}

export type AnonymousSchema_290 = 'file' | 'directory';

export type AnonymousSchema_292 = 'read' | 'list' | 'search';

export interface WriteScope {
  path: string;
  kind: AnonymousSchema_295;
  operations: AnonymousSchema_297[];
}

export type AnonymousSchema_295 = 'file' | 'directory';

export type AnonymousSchema_297 = 'create' | 'modify';

export type AnonymousSchema_302 = 'inline' | 'subagent' | 'session';

export type AnonymousSchema_304 =
  | 'planned'
  | 'ready'
  | 'running'
  | 'waiting_input'
  | 'paused'
  | 'verifying'
  | 'changes_requested'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface RelatedWorkspaceFile {
  path: string;
  relation: AnonymousSchema_310;
  reason?: string;
  artifactId?: string;
}

export type AnonymousSchema_310 = 'source' | 'changed' | 'test' | 'config' | 'evidence';

export interface AcceptanceCriterion {
  id: string;
  requirementIds: string[];
  description: string;
  kind: AnonymousSchema_324;
  required: boolean;
}

export type AnonymousSchema_324 = 'command' | 'surface' | 'review';

export interface CompanyArchitectureReview {
  revision: number;
  verdict: AnonymousSchema_328;
  issues: CompanyArchitectureIssue[];
  advisorNotes: string[];
  reviewedAt: string;
}

export type AnonymousSchema_328 = 'approve' | 'changes_requested';

export interface CompanyArchitectureIssue {
  severity: AnonymousSchema_330;
  requirementIds: string[];
  evidence: string[];
  fix: string;
}

export type AnonymousSchema_330 = 'P0' | 'P1' | 'P2' | 'P3';

export type AnonymousSchema_340 =
  | 'draft'
  | 'clarifying'
  | 'architecture_review'
  | 'awaiting_approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'cancelled';

export interface CompanySessionSummary {
  id: string;
  code: string;
  name: string;
  cwd?: string;
  role: CompanyRole;
  requestedModel: string;
  effectiveModel?: string;
  agentId?: number;
  runEpoch: number;
  status: string;
  activeTaskId?: string;
  lastUsedAt: string;
  contextSnapshot?: Record<string, any>;
  insight?: CompanySessionInsight;
}

export interface CompanySessionInsight {
  observedAt: string;
  todo?: CompanySessionTodo;
  planMode: string;
  subagents: CompanySessionSubagent[];
}

export interface CompanySessionTodo {
  phases: CompanySessionTodoPhase[];
}

export interface CompanySessionTodoPhase {
  name: string;
  tasks: CompanySessionTodoTask[];
}

export interface CompanySessionTodoTask {
  content: string;
  status: AnonymousSchema_360;
  blocker?: string;
}

export type AnonymousSchema_360 = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';

export interface CompanySessionSubagent {
  id: string;
  agent: string;
  status: AnonymousSchema_366;
  task?: string;
  currentTool?: string;
  tokens: number;
  contextTokens?: number;
  contextWindow?: number;
  costUsd?: number;
  durationMs: number;
  completionPercent?: number;
}

export type AnonymousSchema_366 = 'pending' | 'running' | 'completed' | 'failed' | 'aborted';

export interface Question {
  id: string;
  sessionId: string;
  taskId?: string;
  runEpoch: number;
  nativeToolCallId?: string;
  kind: AnonymousSchema_381;
  title: string;
  questions: QuestionPrompt[];
  actionDigest?: string;
  status: AnonymousSchema_392;
  answer?: Record<string, any>;
  createdAt: string;
  resolvedAt?: string;
}

export type AnonymousSchema_381 = 'clarification' | 'technical_choice' | 'approval';

export interface QuestionPrompt {
  id: string;
  question: string;
  options: QuestionOption[];
  recommended?: number;
  multi?: boolean;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export type AnonymousSchema_392 = 'pending' | 'answered' | 'rejected' | 'cancelled' | 'expired';

export interface QuotaSnapshot {
  provider: string;
  accountId?: string;
  accountLabel?: string;
  note?: string;
  windows: QuotaWindow[];
  fetchedAt: string;
  status: AnonymousSchema_416;
}

export interface QuotaWindow {
  id: string;
  label: string;
  windowLabel?: string;
  durationMs?: number;
  shared?: boolean;
  tier?: string;
  used?: number;
  limit?: number;
  remaining?: number;
  usedFraction?: number;
  resetAt?: string;
  reportedUnit: string;
  status?: string;
}

export type AnonymousSchema_416 =
  'available' | 'unsupported' | 'unauthenticated' | 'error' | 'stale';

export interface CompanyDiagnostics {
  liveRunners: number;
  modelLeases: number;
  nativeJobs: number;
  queuedTasks: number;
  pendingQuestions: number;
  retainedSessions: number;
  archivedSessions: number;
  terminalBufferedBytes: number;
  ownedHandleCount: number;
  ownedRssBytes?: number;
  measuredAt: string;
}

export interface Attempt {
  id: string;
  taskId: string;
  sessionId: string;
  runEpoch: number;
  startedAt: string;
  endedAt?: string;
  status: AnonymousSchema_435;
  changes: WorkspaceChange[];
  evidenceIds: string[];
  qaVerdict?: Record<string, any>;
  judgeVerdict?: Record<string, any>;
  error?: string;
}

export type AnonymousSchema_435 = 'running' | 'passed' | 'failed' | 'interrupted' | 'blocked';

export interface WorkspaceChange {
  path: string;
  kind: AnonymousSchema_438;
  summary: string;
  diffArtifactId?: string;
}

export type AnonymousSchema_438 = 'create' | 'modify' | 'delete';

export interface VerificationEvidence {
  id: string;
  command: VerificationCommand;
  startedAt: string;
  endedAt: string;
  exitCode?: number;
  signal?: string;
  stdoutArtifactId?: string;
  stderrArtifactId?: string;
  prerequisites?: string[];
  criterionIds: string[];
}

export interface CompanyReport {
  contractId: string;
  revision: number;
  requirements: RequirementResult[];
  relatedChanges: WorkspaceChange[];
  verificationEvidenceIds: string[];
  advisorNotes: string[];
  usage: UsageRecord[];
  sessions: SessionLifecycleSummary[];
}

export interface RequirementResult {
  requirementId: string;
  taskIds: string[];
  attemptIds: string[];
  evidenceIds: string[];
  result: string;
}

export interface UsageRecord {
  sessionId: string;
  nativeSessionId: string;
  nativeEntryId: string;
  role: CompanyRole;
  model: string;
  provider: string;
  purpose: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd?: number;
  timestamp: string;
  source: AnonymousSchema_488;
  availability: string;
  provenance: UsageProvenance;
  toolCallId?: string;
  runEpoch: number;
  taskId?: string;
  contractId?: string;
  totalTokens?: number;
}

export type AnonymousSchema_488 = 'provider' | 'native_session';

export type UsageProvenance = 'own_turn' | 'native_child' | 'child_aggregate';

export interface SessionLifecycleSummary {
  sessionId: string;
  role: CompanyRole;
  requestedModel: string;
  effectiveModel?: string;
  runEpoch: number;
  status: string;
}

export interface CompanyStateChangedMessage {
  type: 'companyStateChanged';
  revision: number;
  workspacePath?: string;
  changes: (
    | CompanyPromptPutChange
    | CompanyContractPutChange
    | CompanyTaskPutChange
    | CompanySessionPutChange
    | CompanyQuestionPutChange
    | CompanyAttemptPutChange
    | CompanyReportPutChange
    | CompanyEvidencePutChange
    | CompanySettingsPutChange
    | CompanyUsagePutChange
    | CompanyQuotaPutChange
    | CompanyCountersPutChange
    | CompanyRemoveChange
  )[];
}

export interface CompanyPromptPutChange {
  entity: 'prompt';
  op: 'put';
  id: string;
  value: CompanyPrompt;
}

export interface CompanyPrompt {
  id: string;
  rawTextArtifactId: string;
  preview: string;
  createdAt: string;
  fragments: PromptFragment[];
  attachments?: PromptAttachment[];
  targetContractId?: string;
  targetSessionId?: string;
  routingReason?: string;
}

export interface PromptFragment {
  id: string;
  start: number;
  end: number;
  ordinal: number;
}

export interface CompanyContractPutChange {
  entity: 'contract';
  op: 'put';
  id: string;
  value: Contract;
}

export interface CompanyTaskPutChange {
  entity: 'task';
  op: 'put';
  id: string;
  value: Task;
}

export interface CompanySessionPutChange {
  entity: 'session';
  op: 'put';
  id: string;
  value: CompanySession;
}

export interface CompanySession {
  id: string;
  code: string;
  name: string;
  role: CompanyRole;
  workstreamId: string;
  workspaceKey: string;
  cwd?: string;
  requestedModel: string;
  effectiveModel?: string;
  nativeSessionId?: string;
  nativeSessionPath?: string;
  agentId?: number;
  runEpoch: number;
  status: AnonymousSchema_544;
  activeTaskId?: string;
  lastUsedAt: string;
  contextSnapshot?: Record<string, any>;
  handoffArtifactId?: string;
  insight?: CompanySessionInsight;
}

export type AnonymousSchema_544 =
  | 'parked'
  | 'starting'
  | 'idle'
  | 'busy'
  | 'waiting_input'
  | 'pausing'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'crashed'
  | 'archived';

export interface CompanyQuestionPutChange {
  entity: 'question';
  op: 'put';
  id: string;
  value: Question;
}

export interface CompanyAttemptPutChange {
  entity: 'attempt';
  op: 'put';
  id: string;
  value: Attempt;
}

export interface CompanyReportPutChange {
  entity: 'report';
  op: 'put';
  id: string;
  value: CompanyReport;
}

export interface CompanyEvidencePutChange {
  entity: 'evidence';
  op: 'put';
  id: string;
  value: VerificationEvidence;
}

export interface CompanySettingsPutChange {
  entity: 'settings';
  op: 'put';
  id: 'settings';
  value: CompanySettings;
}

export interface CompanyUsagePutChange {
  entity: 'usage';
  op: 'put';
  id: string;
  value: UsageRecord;
}

export interface CompanyQuotaPutChange {
  entity: 'quota';
  op: 'put';
  id: string;
  value: QuotaSnapshot;
}

export interface CompanyCountersPutChange {
  entity: 'counters';
  op: 'put';
  id: 'counters';
  value: CompanyCounters;
}

export interface CompanyCounters {
  session: number;
  task: number;
  contract: number;
}

export interface CompanyRemoveChange {
  entity: AnonymousSchema_576;
  op: 'remove';
  id: string;
}

export type AnonymousSchema_576 =
  | 'prompt'
  | 'contract'
  | 'task'
  | 'session'
  | 'question'
  | 'attempt'
  | 'report'
  | 'evidence'
  | 'usage'
  | 'quota';

export interface CompanyCommandResultMessage {
  type: 'companyCommandResult';
  requestId: string;
  ok: boolean;
  errorCode?: string;
  message?: string;
  revision?: number;
  sessionId?: string;
  workItemId?: string;
  paneId?: string;
  squadRunId?: string;
  workspacePath?: string;
}

export interface CompanyWorkItemsMessage {
  type: 'companyWorkItems';
  workspacePath: string;
  revision: number;
  items: WorkItem[];
  cloudIssues?: WorkItemCloudIssue[];
  roles: AgentRole[];
  settings: SquadSettings;
  claudeStatus?: ClaudeCodeStatus;
  claudeMcpServers: string[];
  parkedSessionIds?: string[];
  repos: string[];
  agents: OmpAgentInfo[];
}

export interface WorkItem {
  id: string;
  text: string;
  assignee: WorkItemAssignee;
  status: WorkItemStatus;
  sequence: number;
  reason?: string;
  result?: string;
  priority: number;
  acceptance?: string;
  dependsOn: string[];
  repo?: string;
  role?: CompanyRole;
  areas?: string[];
  agent?: string;
  worktree?: AnonymousSchema_608;
  claudeRun?: WorkItemClaudeRun;
  agyRun?: WorkItemAgyRun;
  judge?: WorkItemJudge;
  conflicts?: WorkItemConflicts;
  worktreeRemoved?: boolean;
  delivery?: WorkItemDelivery;
  cloud?: WorkItemCloud;
  blocker?: WorkItemBlocker;
  squadRunId?: string;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  history: WorkItemEvent[];
}

export interface WorkItemAssignee {
  kind: WorkItemAssigneeKind;
  paneId?: string;
  sessionId?: string;
}

export type WorkItemAssigneeKind = 'herdr' | 'session' | 'new-session' | 'auto' | 'claude' | 'agy';

export type WorkItemStatus = 'queued' | 'running' | 'needs_input' | 'review' | 'done' | 'failed';

export interface AnonymousSchema_608 {
  path: string;
  branch: string;
}

export interface WorkItemClaudeRun {
  mode: AnonymousSchema_611;
  startedAt: string;
  sessionId?: string;
  progress?: string;
  interrupted?: boolean;
}

export type AnonymousSchema_611 = 'edit' | 'read';

export interface WorkItemAgyRun {
  mode: AnonymousSchema_616;
  startedAt: string;
  pid?: number;
  progress?: string;
  interrupted?: boolean;
  conversationId?: string;
}

export type AnonymousSchema_616 = 'edit' | 'read';

export interface WorkItemJudge {
  status: AnonymousSchema_622;
  verdict?: WorkItemJudgeVerdict;
  reason?: string;
  error?: string;
  followUps: number;
}

export type AnonymousSchema_622 = 'running' | 'waiting' | 'verdict' | 'interrupted' | 'error';

export type WorkItemJudgeVerdict = 'pass' | 'fail' | 'need_evidence';

export interface WorkItemConflicts {
  sequences: number[];
  main: boolean;
}

export interface WorkItemDelivery {
  checkedAt: string;
  branch: string;
  stage: WorkItemDeliveryStage;
  dirtyFiles: number;
  commitsAhead: number;
  inStaging: boolean | null;
  inMain: boolean;
  nextStep: string;
}

export type WorkItemDeliveryStage = 'uncommitted' | 'no_commits' | 'branch' | 'staging' | 'main';

export interface WorkItemCloud {
  issue: number;
  url: string;
  branch: string;
  repo: string;
  state: WorkItemCloudState;
  startedAt: string;
  summary?: string;
  logUrl?: string;
  reason?: string;
}

export type WorkItemCloudState =
  'running' | 'finished' | 'waiting_clean' | 'diverged' | 'pulled' | 'no_changes' | 'closed';

export interface WorkItemBlocker {
  kind: WorkItemBlockerKind;
  sequence?: number;
  area?: string;
  running?: number;
  limit?: number;
  detail?: string;
}

export type WorkItemBlockerKind =
  | 'agent'
  | 'dependency'
  | 'failed'
  | 'capacity'
  | 'area'
  | 'no_member'
  | 'busy_checkout'
  | 'pool_full'
  | 'repo_full'
  | 'worktree'
  | 'disk_full';

export interface WorkItemEvent {
  at: string;
  kind: WorkItemEventKind;
  message?: string;
}

export type WorkItemEventKind =
  'created' | 'assigned' | 'queued' | 'dispatched' | 'followed_up' | 'status' | 'note';

export interface WorkItemCloudIssue {
  issue: number;
  title: string;
  url: string;
  createdAt: string;
  state: AnonymousSchema_662;
  repo?: string;
}

export type AnonymousSchema_662 = 'running' | 'finished';

export interface AgentRole {
  agent: WorkItemAssignee;
  description: string;
  updatedAt: string;
}

export interface SquadSettings {
  maxParallel: number;
  maxSquadSessions: number;
  maxPerRepo?: number;
  minFreeRamGb: number;
  minFreeDiskGb?: number;
  autoJudge: boolean;
  autoApproveNext: boolean;
  compactSquad: boolean;
  engineLeader: AnonymousSchema_675;
  engineJudge: AnonymousSchema_676;
  engineWorker: AnonymousSchema_677;
  claudeModelLeader: string;
  claudeModelJudge: string;
  maxClaudeRuns: number;
  maxAgyRuns: number;
  claudeMaxTurns: number;
  claudeMaxBudgetUsd: number;
  claudePermission: AnonymousSchema_684;
  claudeAllowedTools: string[];
  claudeWorkerMcp: string[];
}

export type AnonymousSchema_675 = 'omp' | 'claude' | 'agy';

export type AnonymousSchema_676 = 'omp' | 'claude' | 'agy';

export type AnonymousSchema_677 = 'omp' | 'claude' | 'agy';

export type AnonymousSchema_684 = 'auto' | 'acceptEdits';

export interface ClaudeCodeStatus {
  state: AnonymousSchema_689;
  checkedAt?: string;
}

export type AnonymousSchema_689 = 'unknown' | 'missing' | 'signed_out' | 'signed_in';

export interface OmpAgentInfo {
  name: string;
  description: string;
  readOnly: boolean;
  source: AnonymousSchema_701;
}

export type AnonymousSchema_701 = 'bundled' | 'user' | 'project';

export interface CompanySquadMessage {
  type: 'companySquad';
  workspacePath: string;
  revision: number;
  runs: SquadRun[];
}

export interface SquadRun {
  id: string;
  request: string;
  status: SquadRunStatus;
  turns: number;
  maxTurns: number;
  proposal?: SquadProposal;
  progress: SquadProgress;
  note?: string;
  compact?: boolean;
  closed?: boolean;
  proposalIds?: string[];
  error?: string;
  history: SquadEvent[];
  createdAt: string;
  updatedAt: string;
}

export type SquadRunStatus =
  'planning' | 'proposed' | 'working' | 'done' | 'dismissed' | 'failed' | 'stopped';

export interface SquadProposal {
  id: string;
  turn: number;
  note: string;
  rows: SquadRow[];
  warnings: string[];
  status: SquadProposalStatus;
  createdAt: string;
}

export interface SquadRow {
  text: string;
  assignee: WorkItemAssignee;
  reason?: string;
  priority: number;
  acceptance?: string;
  dependsOn: SquadDependency[];
  repo?: string;
  role?: CompanyRole;
  agent?: string;
  areas?: string[];
}

export interface SquadDependency {
  kind: AnonymousSchema_718;
  row?: number;
  sequence?: number;
}

export type AnonymousSchema_718 = 'row' | 'item';

export type SquadProposalStatus = 'pending' | 'approved' | 'dismissed';

export interface SquadProgress {
  done: number;
  total: number;
}

export interface SquadEvent {
  at: string;
  kind: SquadEventKind;
  message?: string;
}

export type SquadEventKind =
  | 'request'
  | 'turn'
  | 'proposal'
  | 'approved'
  | 'review'
  | 'done'
  | 'dismissed'
  | 'failed'
  | 'stopped';

export interface CompanySquadLiveMessage {
  type: 'companySquadLive';
  workspacePath: string;
  runId: string;
  live?: SquadLeaderLive;
}

export interface SquadLeaderLive {
  phase: AnonymousSchema_744;
  chars: number;
  text?: string;
  startedAt: string;
}

export type AnonymousSchema_744 = 'thinking' | 'writing';

export interface CompanyTextDeltaMessage {
  type: 'companyTextDelta';
  sessionId: string;
  taskId?: string;
  runEpoch: number;
  seq: number;
  text: string;
  workspacePath?: string;
}

export interface CompanySessionLogMessage {
  type: 'companySessionLog';
  requestId?: string;
  sessionId: string;
  replay: boolean;
  entries: CompanySessionLogEntry[];
}

export interface CompanySessionLogEntry {
  seq: number;
  at: string;
  kind: AnonymousSchema_762;
  runEpoch: number;
  taskId?: string;
  text: string;
  toolName?: string;
  exitCode?: number;
  ok?: boolean;
}

export type AnonymousSchema_762 =
  'text' | 'tool' | 'command' | 'verdict' | 'question' | 'state' | 'error';

export interface HerdrAgentsMessage {
  type: 'herdrAgents';
  available: boolean;
  reason?: string;
  agents: HerdrAgent[];
  sleeping: HerdrSleepingSession[];
}

export interface HerdrAgent {
  paneId: string;
  name?: string;
  kind: string;
  status: AnonymousSchema_776;
  cwd?: string;
  title?: string;
  workspaceId: string;
  workspaceLabel?: string;
  repo?: string;
  branch?: string;
  worktreeRoot?: string;
  focused?: boolean;
  workspacePath?: string;
  sessionFile?: string;
  sessionId?: string;
}

export type AnonymousSchema_776 = 'working' | 'blocked' | 'idle' | 'done' | 'unknown';

export interface HerdrSleepingSession {
  paneId: string;
  title: string;
  sessionFile: string;
  sleptAt: string;
  cwd?: string;
  workspaceLabel?: string;
  repo?: string;
  branch?: string;
  worktreeRoot?: string;
  workspacePath?: string;
}

export interface HerdrScreenMessage {
  type: 'herdrScreen';
  requestId?: string;
  paneId: string;
  text: string;
  at: string;
}

export interface BrowserReaperStatusMessage {
  type: 'browserReaperStatus';
  enabled: boolean;
  browsers: BrowserReaperBrowser[];
  reapedCount: number;
  freedMb: number;
}

export interface BrowserReaperBrowser {
  projectDir: string;
  pages: number;
  idleSince: string | null;
  uptimeMs: number;
}

export interface CompanySessionInfoMessage {
  type: 'companySessionInfo';
  requestId: string;
  sessionId: string;
  info: AgentInfo;
}

export interface AgentInfo {
  cwd?: string;
  launchCwd?: string;
  model?: string;
  thinking?: string;
  sessionFile?: string;
  tools?: AgentToolInfo[];
  skills?: AgentSkillInfo[];
  toolUsage?: AgentToolUsage[];
  collectedFrom: AnonymousSchema_833;
  collectedAt: string;
  note?: string;
}

export interface AgentToolInfo {
  name: string;
  source: AnonymousSchema_823;
  mcpServer?: string;
  active: boolean;
}

export type AnonymousSchema_823 = 'builtin' | 'extension' | 'mcp' | 'sdk' | 'other';

export interface AgentSkillInfo {
  name: string;
  description?: string;
  used: boolean;
}

export interface AgentToolUsage {
  name: string;
  count: number;
}

export type AnonymousSchema_833 = 'live' | 'transcript' | 'herdr';

export interface HerdrInfoMessage {
  type: 'herdrInfo';
  requestId: string;
  paneId: string;
  info: AgentInfo;
}

export interface CompanyModelCatalogMessage {
  type: 'companyModelCatalog';
  requestId: string;
  entries: CompanyModelCatalogEntry[];
}

export interface CompanyModelCatalogEntry {
  id: string;
  provider: string;
  model: string;
  thinking: string[];
  acceptsImages: boolean;
  credentialsConfigured: boolean;
}

export interface CompanyOmpSessionsMessage {
  type: 'companyOmpSessions';
  requestId: string;
  folder: string;
  sessions: OmpSessionEntry[];
}

export interface OmpSessionEntry {
  file: string;
  title?: string;
  updatedAt: string;
  sizeBytes: number;
  boardSessionId?: string;
}

export interface CompanyWorkspacesMessage {
  type: 'companyWorkspaces';
  workspaces: CompanyWorkspaceEntry[];
}

export interface CompanyWorkspaceEntry {
  path: string;
  name?: string;
  active: boolean;
  open: boolean;
  working: number;
  waiting: number;
  missing?: boolean;
  sessions?: CompanyWorkspaceSession[];
}

export interface CompanyWorkspaceSession {
  id: string;
  code: string;
  name: string;
  role: CompanyRole;
  status: string;
}

export interface CompanyArtifactPageMessage {
  type: 'companyArtifactPage';
  requestId: string;
  page: ArtifactPage;
}

export interface ArtifactPage {
  id: string;
  offset: number;
  totalBytes: number;
  dataBase64: string;
  contentType: string;
  eof: boolean;
}

export interface CompanyFileListMessage {
  type: 'companyFileList';
  requestId: string;
  path: string;
  entries: CompanyFileEntry[];
}

export interface CompanyFileEntry {
  name: string;
  path: string;
  kind: AnonymousSchema_886;
  sizeBytes?: number;
  modifiedAt?: string;
}

export type AnonymousSchema_886 = 'file' | 'directory';

export interface CompanyFileReadMessage {
  type: 'companyFileRead';
  requestId: string;
  content: CompanyFileContent;
}

export interface CompanyFileContent {
  path: string;
  totalBytes: number;
  offset: number;
  encoding: AnonymousSchema_894;
  text?: string;
  dataBase64?: string;
  mediaType?: string;
  truncated: boolean;
}

export type AnonymousSchema_894 = 'utf8' | 'base64';

export interface CompanyAttachmentUploadedMessage {
  type: 'companyAttachmentUploaded';
  requestId: string;
  attachment: PromptAttachment;
}

export interface UsageLimitsMessage {
  type: 'usageLimits';
  requestId: string;
  generatedAt: string;
  status: AnonymousSchema_904;
  message?: string;
  cached: boolean;
  snapshots: QuotaSnapshot[];
  capacity: QuotaCapacityRow[];
}

export type AnonymousSchema_904 = 'available' | 'unsupported' | 'unauthenticated' | 'error';

export interface QuotaCapacityRow {
  provider: string;
  window: string;
  durationMs: number;
  meter?: string;
  accounts: number;
  usedAccounts: number;
  remainingAccounts: number;
}

export interface UsageHistoryMessage {
  type: 'usageHistory';
  requestId: string;
  generatedAt: string;
  sinceAt: string;
  days: number;
  entries: UsageHistoryEntry[];
  clients: UsageClientBurn[];
}

export interface UsageHistoryEntry {
  recordedAt: string;
  provider: string;
  accountKey: string;
  email?: string;
  accountId?: string;
  limitId: string;
  label: string;
  windowLabel?: string;
  usedFraction?: number;
  status?: string;
  resetAt?: string;
}

export interface UsageClientBurn {
  name: string;
  metrics: AnonymousSchema_936[];
}

export interface AnonymousSchema_936 {
  key: string;
  value: number;
}

export interface UsageStatsMessage {
  type: 'usageStats';
  requestId: string;
  generatedAt: string;
  overall: UsageStatsTotals;
  byModel: UsageStatsModelRow[];
  byFolder: UsageStatsFolderRow[];
  byAgentType: UsageStatsAgentRow[];
  timeSeries: UsageStatsTimePoint[];
  modelPerformanceSeries: UsageStatsModelPerformancePoint[];
  costSeries: UsageStatsCostPoint[];
}

export interface UsageStatsTotals {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  cacheRate: number;
  cacheSavings: number;
  totalCost: number;
  unpricedRequests: number;
  totalPremiumRequests: number;
  avgDuration?: number;
  avgTtft?: number;
  avgTokensPerSecond?: number;
  firstAt?: string;
  lastAt?: string;
}

export interface UsageStatsModelRow {
  model: string;
  provider: string;
  totals: UsageStatsTotals;
}

export interface UsageStatsFolderRow {
  folder: string;
  totals: UsageStatsTotals;
}

export interface UsageStatsAgentRow {
  agentType: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCost: number;
}

export interface UsageStatsTimePoint {
  timestamp: string;
  requests: number;
  errors: number;
  tokens: number;
  cost: number;
}

export interface UsageStatsModelPerformancePoint {
  timestamp: string;
  model: string;
  provider: string;
  requests: number;
  avgTtft?: number;
  avgTokensPerSecond?: number;
}

export interface UsageStatsCostPoint {
  timestamp: string;
  model: string;
  provider: string;
  cost: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  requests: number;
  unpricedRequests: number;
}

export interface LedgerSnapshotMessage {
  type: 'ledgerSnapshot';
  requestId?: string;
  view: LedgerView;
}

export interface LedgerView {
  generatedAt: string;
  database: LedgerDatabaseStatus;
  repos: LedgerRepo[];
  unscannedFolders: LedgerUnscannedFolder[];
  sessions: LedgerSession[];
  pending: LedgerPending[];
  notices: LedgerNotice[];
  mainWrites: LedgerMainWrite[];
  overlaps: LedgerOverlapScan[];
  mergeBlocks: LedgerMergeBlock[];
  spamRule: LedgerSpamRule;
}

export interface LedgerDatabaseStatus {
  state: AnonymousSchema_1000;
  error?: string;
}

export type AnonymousSchema_1000 = 'ok' | 'missing' | 'unreadable';

export interface LedgerRepo {
  repo: string;
  name: string;
  worktrees: LedgerWorktree[];
  workspacePath?: string;
}

export interface LedgerWorktree {
  path: string;
  workspacePath?: string;
  name: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  ahead: number;
  behind: number;
  dirtyCount: number;
  dirtyFiles: LedgerDirtyFile[];
  merged: boolean;
  hasUpstream: boolean;
  unpushed: number | null;
  lastCommitSubject: string;
  lastCommitAt: string | null;
  sessionIds: string[];
  gitError?: string;
}

export interface LedgerDirtyFile {
  path: string;
  status: string;
}

export interface LedgerUnscannedFolder {
  path: string;
  workspacePath?: string;
}

export interface LedgerSession {
  sessionId: string;
  agentKind: string;
  agentName: string;
  parentId?: string | null;
  open: boolean;
  live: boolean;
  state: string;
  cwd: string;
  repo: string | null;
  checkout: string | null;
  branch: string | null;
  lastIntent: string | null;
  lastCallAt: string | null;
  calls5m: number;
  calls30m: number;
  spamming: boolean;
  spamReason: string | null;
  pid: number | null;
}

export interface LedgerPending {
  checkout: string;
  sessionId: string | null;
  branch: string | null;
  dirty: number;
  unpushed: number;
  notInMain: number;
  hasRemote: boolean;
  ts: string;
}

export interface LedgerNotice {
  id: number;
  ts: string;
  toSession: string;
  fromSession: string | null;
  relKey: string | null;
  content: string;
}

export interface LedgerMainWrite {
  sessionId: string;
  ts: string;
  tool: string | null;
  path: string | null;
  intent: string | null;
}

export interface LedgerOverlapScan {
  repo: string;
  state: AnonymousSchema_1073;
  startedAt: string | null;
  finishedAt: string | null;
  base: string | null;
  lanes: number;
  pairs: LedgerOverlapPair[];
  main: LedgerOverlapMain[];
  pending: string[];
  complete: boolean;
  error: string | null;
}

export type AnonymousSchema_1073 = 'idle' | 'running' | 'done' | 'partial' | 'error';

export interface LedgerOverlapPair {
  a: string;
  b: string;
  aLabel: string;
  bLabel: string;
  conflicts: LedgerOverlapConflict[];
  auto: string[];
}

export interface LedgerOverlapConflict {
  file: string;
  hunks: LedgerOverlapHunk[];
}

export interface LedgerOverlapHunk {
  line: number;
  symbol: string;
  ours: string[];
  theirs: string[];
}

export interface LedgerOverlapMain {
  lane: string;
  label: string;
  conflicts: LedgerOverlapConflict[];
}

export interface LedgerMergeBlock {
  repo: string;
  branch: string;
  at: string;
  briefPath: string;
  files: string[];
}

export interface LedgerSpamRule {
  windowMinutes: number;
  callsPerWindow: number;
  sameIntentPerWindow: number;
  lookbackMinutes: number;
}

export interface LedgerOpenSpecSnapshotMessage {
  type: 'ledgerOpenSpecSnapshot';
  requestId: string;
  changes: LedgerOpenSpecChange[];
}

export interface LedgerOpenSpecChange {
  repo: string;
  repoName: string;
  worktree: string;
  worktreeName: string;
  branch: string | null;
  id: string;
  summary: string;
  completedTasks: number;
  totalTasks: number;
  progressPercent: number | null;
  hasProposal: boolean;
  hasTasks: boolean;
  hasHandoff: boolean;
}

export interface LedgerOpenSpecFileMessage {
  type: 'ledgerOpenSpecFile';
  requestId: string;
  worktree: string;
  changeId: string;
  file: LedgerOpenSpecFileName;
  ok: boolean;
  content: string;
  reason?: string;
}

export type LedgerOpenSpecFileName = 'proposal.md' | 'tasks.md' | 'handoff.md';

export interface LedgerTimelineMessage {
  type: 'ledgerTimeline';
  requestId: string;
  timeline: LedgerTimeline;
}

export interface LedgerTimeline {
  windowMinutes: number;
  bucketSeconds: number;
  startedAt: string;
  endedAt: string;
  lanes: LedgerTimelineLane[];
  shared: LedgerSharedFile[];
  truncated: boolean;
}

export interface LedgerTimelineLane {
  sessionId: string;
  agentKind: string;
  agentName: string;
  repo: string | null;
  spamming: boolean;
  spamReason: string | null;
  total: number;
  buckets: LedgerTimelineBucket[];
}

export interface LedgerTimelineBucket {
  index: number;
  edit: number;
  bash: number;
  read: number;
  other: number;
  intents: string[];
  files: string[];
}

export interface LedgerSharedFile {
  a: string;
  b: string;
  path: string;
  bucket: number;
}

export interface LedgerFileDiffMessage {
  type: 'ledgerFileDiff';
  requestId: string;
  ok: boolean;
  worktree: string;
  path: string;
  diff: string;
  truncated: boolean;
  reason?: string;
}

export interface LedgerFileHistoryMessage {
  type: 'ledgerFileHistory';
  requestId: string;
  path: string;
  entries: LedgerFileTouch[];
  reason?: string;
}

export interface LedgerFileTouch {
  ts: string;
  sessionId: string;
  agentKind: string | null;
  agentName: string | null;
  branch: string | null;
  checkout: string | null;
  tool: string | null;
  intent: string | null;
}

export interface LedgerCoordinationMessage {
  type: 'ledgerCoordination';
  requestId: string;
  messages: LedgerAgentMessage[];
  handoffs: LedgerHandoff[];
}

export interface LedgerAgentMessage {
  id: number;
  ts: string;
  toSession: string;
  fromSession: string | null;
  relKey: string | null;
  content: string;
  delivered: number;
  fromKind: string | null;
  fromCwd: string | null;
  toKind: string | null;
  toCwd: string | null;
}

export interface LedgerHandoff {
  worktree: string;
  branch: string | null;
  path: string;
  modifiedAt: string;
  goal: string;
  status: string;
  openQuestions: string;
}

export interface LedgerToolUsageMessage {
  type: 'ledgerToolUsage';
  requestId: string;
  ok: boolean;
  running: boolean;
  generatedAt: string | null;
  days: number | null;
  transcripts: Record<string, number>;
  rows: LedgerToolUsageRow[];
  unusedSkills: Record<string, string[]>;
  tokenUsage: LedgerTokenUsage;
  nameOnlyCandidates: string[];
  reason: string;
}

export interface LedgerToolUsageRow {
  cli: string;
  kind: string;
  name: string;
  calls: number;
  ok: number;
  err: number;
  sessions: number;
  last: string | null;
  topErrors: any[][];
}

export interface LedgerTokenUsage {
  totalUnits: number;
  rows: LedgerTokenUsageRow[];
}

export interface LedgerTokenUsageRow {
  kind: AnonymousSchema_1233;
  name: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  messages: number;
  units: number;
  share: number;
  models: string[];
}

export type AnonymousSchema_1233 = 'main' | 'subagent' | 'skill' | 'plugin';

export interface LedgerCommandResultMessage {
  type: 'ledgerCommandResult';
  requestId: string;
  ok: boolean;
  reason?: string;
  delivered?: string[];
}

export interface FleetSnapshotMessage {
  type: 'fleetSnapshot';
  requestId: string;
  machines: FleetMachineSnapshot[];
  overlaps: FleetOverlapWarning[];
  hubError?: string;
  localGuard?: GitGuardReport;
  localActiveBranches?: string[];
  localActivePaths?: string[];
  localBranches?: FleetLocalBranchSnapshot[];
  branchAnalyses?: FleetBranchAnalysis[];
  branchAnalysisPending?: boolean;
}

export interface FleetMachineSnapshot {
  agentId: string;
  receivedAt: number;
  state: FleetMachineState;
  sessionCount: number;
  engines: FleetSessionEngine[];
  repos: FleetRepoSnapshot[];
  diskFreeGb?: number;
  skillVersion?: string;
  skillStale?: boolean;
  taskSlugs?: string[];
  lavishSessions?: FleetLavishSession[];
  tmuxSessions?: FleetTmuxSession[];
  guard?: GitGuardReport;
  activeBranches?: string[];
  activePaths?: string[];
  activeTaskSlugs?: string[];
}

export type FleetMachineState = 'online' | 'stale';

export type FleetSessionEngine = 'omp' | 'claude' | 'agy' | 'codex' | 'pi' | 'thinkrail';

export interface FleetRepoSnapshot {
  path?: string;
  name: string;
  branch: string;
  ahead: number;
  behind: number;
  dirtyCount: number;
  merged?: boolean;
  staged?: boolean;
  pullRequest?: FleetPullRequest;
}

export interface FleetPullRequest {
  number: number;
  state: AnonymousSchema_1270;
  isDraft: boolean;
  reviewDecision: string | null;
  url: string;
  ci: AnonymousSchema_1274;
  failedChecks: string[];
}

export type AnonymousSchema_1270 = 'open' | 'merged' | 'closed';

export type AnonymousSchema_1274 = 'green' | 'red' | 'running' | 'none';

export interface FleetLavishSession {
  key: string;
  file: string;
}

export interface FleetTmuxSession {
  name: string;
  attached: boolean;
  idleSeconds: number;
  engine?: FleetSessionEngine;
  command?: string;
  branch?: string;
  cwd?: string;
  asking?: boolean;
  recentRequests?: string[];
}

export interface GitGuardReport {
  machine: string;
  scannedAt: string;
  repos: GitGuardRepo[];
  risks: GitGuardRisk[];
}

export interface GitGuardRepo {
  repo: string;
  worktrees: GitGuardWorktree[];
  stashes?: number;
}

export interface GitGuardWorktree {
  path: string;
  branch: string | null;
  head: string;
  unpushed: number;
  unpushedSubjects: string[];
  backedUp: boolean;
  dirty: number;
  ignored?: number;
  dirtyKnown?: boolean;
  dirtyOldestMinutes: number | null;
  op: string | null;
  mergedToMain: boolean;
  idleDays: number;
  idleMinutes?: number;
  prunable: boolean;
}

export interface GitGuardRisk {
  level: GitGuardRiskLevel;
  kind: GitGuardRiskKind;
  repo: string;
  path: string;
  detail: string;
}

export type GitGuardRiskLevel = 'red' | 'yellow';

export type GitGuardRiskKind = 'unpushed' | 'dirty' | 'stash' | 'op' | 'prunable' | 'detached';

export interface FleetOverlapWarning {
  repo: string;
  path: string;
  machines: string[];
  local: boolean;
  level?: AnonymousSchema_1333;
  detail?: string;
}

export type AnonymousSchema_1333 = 'line' | 'file';

export interface FleetLocalBranchSnapshot {
  repo: string;
  checkout: string;
  branch: string;
  ahead: number;
  behind: number;
  sessionIds: string[];
  pullRequest?: FleetPullRequest;
}

export interface FleetBranchAnalysis {
  id: string;
  repo: string;
  branch: string;
  checkout?: string;
  machine?: string;
  path?: string;
  changedFileCount: number;
  modules: AnonymousSchema_1357[];
  changedFiles: string[];
  overlaps: FleetBranchOverlap[];
  suggestion: string;
}

export interface AnonymousSchema_1357 {
  name: string;
  count: number;
}

export interface FleetBranchOverlap {
  branch: string;
  files: string[];
  mergeClean: boolean | null;
}

export interface FleetCommandResultMessage {
  type: 'fleetCommandResult';
  requestId: string;
  ok: boolean;
  code: FleetCommandResultCode;
  reason?: string;
}

export type FleetCommandResultCode = 'forbidden' | 'unavailable' | 'failed' | 'success';

export interface FleetTerminalOpenedMessage {
  type: 'fleetTerminalOpened';
  requestId: string;
  terminalId: number;
}

export interface FleetTaskCreatedMessage {
  type: 'fleetTaskCreated';
  requestId: string;
  machine: string;
  session: string;
}

export interface FleetTaskCleanedMessage {
  type: 'fleetTaskCleaned';
  requestId: string;
  machine: string;
  session: string;
}

export interface FleetLavishOpenedMessage {
  type: 'fleetLavishOpened';
  requestId: string;
  url: string;
}

export interface FleetDiffMessage {
  type: 'fleetDiff';
  requestId: string;
  machine: string;
  path: string;
  text: string;
  truncated: boolean;
}

export interface ProjectTreeSnapshotMessage {
  type: 'projectTreeSnapshot';
  requestId: string;
  nodes: ProjectTreeNode[];
  partial?: boolean;
}

export interface ProjectTreeNode {
  id: string;
  parentId?: string;
  kind: AnonymousSchema_1398;
  name: string;
  path?: string;
  engine?: FleetSessionEngine | AnonymousSchema_1401;
  agentKind?: FleetSessionEngine | AnonymousSchema_1402;
  branch?: string;
  sessionId?: string;
  boardSessionId?: string;
  parentSessionId?: string;
  herdrPaneId?: string;
  editCheckouts?: string[];
  progress?: AnonymousSchema_1410;
  request?: string;
  lastRequest?: string;
  recentRequests?: string[];
  interrupted?: string;
  stoppedAt?: string;
  lastReply?: string;
  transcriptId?: string;
  state?: string;
  title?: string;
  color?: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  additions?: number;
  deletions?: number;
  overlap?: boolean;
  overlappingWorktrees?: string[];
  pendingWork?: boolean;
}

export type AnonymousSchema_1398 =
  'project' | 'folder' | 'group' | 'repository' | 'checkout' | 'file-agg' | 'session';

export type AnonymousSchema_1401 = 'herdr' | 'board';

export type AnonymousSchema_1402 = 'sub' | 'herdr' | 'board';

export interface AnonymousSchema_1410 {
  done: number;
  total: number;
  current?: string;
  blocked?: string;
}

export interface ProjectDiffMessage {
  type: 'projectDiff';
  requestId: string;
  checkout: string;
  scope: AnonymousSchema_1439;
  sha: string;
  files: ProjectDiffFile[];
  truncated: boolean;
  reason?: string;
}

export type AnonymousSchema_1439 = 'uncommitted' | 'branch' | 'commit' | 'compare';

export interface ProjectDiffFile {
  path: string;
  oldPath?: string;
  status: AnonymousSchema_1444;
  additions: number;
  deletions: number;
  author: string;
  hunks: ProjectDiffHunk[];
}

export type AnonymousSchema_1444 =
  'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'binary';

export interface ProjectDiffHunk {
  header: string;
  content: string;
}

export interface ProjectSettingsMessage {
  type: 'projectSettings';
  requestId: string;
  nodeId?: string;
  values: ProjectSettingsValues;
  sources: ProjectSettingsSources;
}

export interface ProjectSettingsValues {
  engineLeader?: AnonymousSchema_1456;
  engineJudge?: AnonymousSchema_1457;
  engineWorker?: AnonymousSchema_1458;
  claudeModelLeader?: string;
  claudeModelJudge?: string;
  maxParallel?: number;
  maxPerRepo?: number;
  minFreeDiskGb?: number;
  maxClaudeRuns?: number;
  maxAgyRuns?: number;
  worktreePrepare?: ProjectPrepareScript;
}

export type AnonymousSchema_1456 = 'omp' | 'claude' | 'agy';

export type AnonymousSchema_1457 = 'omp' | 'claude' | 'agy';

export type AnonymousSchema_1458 = 'omp' | 'claude' | 'agy';

export interface ProjectPrepareScript {
  argv: string[];
  timeoutMs: number;
}

export interface ProjectSettingsSources {
  engineLeader?: AnonymousSchema_1469;
  engineJudge?: AnonymousSchema_1470;
  engineWorker?: AnonymousSchema_1471;
  claudeModelLeader?: AnonymousSchema_1472;
  claudeModelJudge?: AnonymousSchema_1473;
  maxParallel?: AnonymousSchema_1474;
  maxPerRepo?: AnonymousSchema_1475;
  minFreeDiskGb?: AnonymousSchema_1476;
  maxClaudeRuns?: AnonymousSchema_1477;
  maxAgyRuns?: AnonymousSchema_1478;
  worktreePrepare?: AnonymousSchema_1479;
}

export type AnonymousSchema_1469 = 'global' | 'project' | 'folder';

export type AnonymousSchema_1470 = 'global' | 'project' | 'folder';

export type AnonymousSchema_1471 = 'global' | 'project' | 'folder';

export type AnonymousSchema_1472 = 'global' | 'project' | 'folder';

export type AnonymousSchema_1473 = 'global' | 'project' | 'folder';

export type AnonymousSchema_1474 = 'global' | 'project' | 'folder';

export type AnonymousSchema_1475 = 'global' | 'project' | 'folder';

export type AnonymousSchema_1476 = 'global' | 'project' | 'folder';

export type AnonymousSchema_1477 = 'global' | 'project' | 'folder';

export type AnonymousSchema_1478 = 'global' | 'project' | 'folder';

export type AnonymousSchema_1479 = 'global' | 'project' | 'folder';

export interface ProjectCommandResultMessage {
  type: 'projectCommandResult';
  requestId: string;
  command: AnonymousSchema_1482;
  ok: boolean;
  nodeId?: string;
  paneId?: string;
  boardSessionId?: string;
  folder?: string;
  reason?: string;
}

export type AnonymousSchema_1482 =
  | 'create'
  | 'update'
  | 'delete'
  | 'move'
  | 'comment'
  | 'settingsSet'
  | 'settingsClear'
  | 'stop'
  | 'wake'
  | 'imageSave';

export interface ProjectSessionStartResultMessage {
  type: 'projectSessionStartResult';
  requestId: string;
  ok: boolean;
  sessionId?: string;
  checkout?: string;
  reason?: string;
}

export interface ProjectImageSavedMessage {
  type: 'projectImageSaved';
  requestId: string;
  path: string;
}

export interface ProjectMergePreviewResultMessage {
  type: 'projectMergePreviewResult';
  requestId: string;
  repo: string;
  branchA: string;
  branchB: string;
  clean: boolean;
  conflicts: string[];
  reason?: string;
}

export interface ProjectBranchCompareMessage {
  type: 'projectBranchCompare';
  requestId: string;
  repo: string;
  branchA: string;
  branchB: string;
  a: ProjectBranchCompareSide;
  b: ProjectBranchCompareSide;
  mergeBase: string | null;
  onlyA: ProjectBranchCommit[];
  onlyB: ProjectBranchCommit[];
  commitsTruncated: boolean;
  files: ProjectBranchCompareFile[];
  mergeClean: boolean;
  conflicts: ProjectBranchCompareConflict[];
  reason?: string;
}

export interface ProjectBranchCompareSide {
  branch: string;
  head: string;
  lastCommitAt: string | null;
  lastCommitSubject: string | null;
  checkout?: string;
  dirtyFiles: AnonymousSchema_1518[];
}

export interface AnonymousSchema_1518 {
  path: string;
  status: string;
}

export interface ProjectBranchCommit {
  sha: string;
  subject: string;
  author: string;
  at: string;
}

export interface ProjectBranchCompareFile {
  path: string;
  inA: boolean;
  inB: boolean;
  conflict: boolean;
}

export interface ProjectBranchCompareConflict {
  file: string;
  hunks: ProjectBranchConflictHunk[];
}

export interface ProjectBranchConflictHunk {
  line: number;
  ours: string;
  theirs: string;
}

export interface LibraryClaudeRolesSnapshot {
  type: 'libraryClaudeRolesSnapshot';
  requestId: string;
  roles: LibraryClaudeRole[];
  reason?: string;
}

export interface LibraryClaudeRole {
  id: string;
  name: string;
  source: AnonymousSchema_1547;
  plugin?: string;
  description: string;
  model: string;
  effort: string | null;
  writesFiles: boolean;
  editable: boolean;
  enabled: boolean;
  overridden: boolean;
}

export type AnonymousSchema_1547 = 'builtin' | 'user' | 'plugin';

export interface LibraryAccountsSnapshot {
  type: 'libraryAccountsSnapshot';
  requestId: string;
  accounts: LibraryAccount[];
  reason?: string;
}

export interface LibraryAccount {
  tool: AnonymousSchema_1560;
  loggedIn: boolean;
  authMethod?: string;
  subscriptionType?: string;
  orgName?: string;
  email?: string;
  modelCount?: number;
  providers?: string[];
  credentials?: LibraryCredential[];
  updatedAt?: string;
  reason?: string;
}

export type AnonymousSchema_1560 = 'claude' | 'agy' | 'omp';

export interface LibraryCredential {
  provider: string;
  credentialType: string;
  disabled: boolean;
  disabledCause?: string;
  updatedAt: string;
  blockedUntilMs?: number;
}

export interface LibrarySkillsSnapshot {
  type: 'librarySkillsSnapshot';
  requestId: string;
  skills: LibrarySkill[];
  reason?: string;
}

export interface LibrarySkill {
  id: string;
  name: string;
  description: string;
  tools: AnonymousSchema_1586[];
  claudeMode: AnonymousSchema_1587;
  plugin?: string;
  sizeBytes: number;
  preferredSource?: AnonymousSchema_1590;
  preferredSourceId?: string;
  sources?: LibrarySkillSource[];
  ignoredTools?: AnonymousSchema_1601[];
  hasContentDifferences?: boolean;
}

export type AnonymousSchema_1586 = 'omp' | 'claude' | 'agents' | 'agy';

export type AnonymousSchema_1587 = 'on' | 'name-only' | 'user-invocable-only' | 'off';

export type AnonymousSchema_1590 = 'omp' | 'claude' | 'agents' | 'agy';

export interface LibrarySkillSource {
  id: string;
  tool: AnonymousSchema_1594;
  location: string;
  contentHash: string;
  lineCount: number;
  ignored: boolean;
  kind?: string;
}

export type AnonymousSchema_1594 = 'omp' | 'claude' | 'agents' | 'agy';

export type AnonymousSchema_1601 = 'omp' | 'claude' | 'agents' | 'agy';

export interface LibraryMcpSnapshot {
  type: 'libraryMcpSnapshot';
  requestId: string;
  servers: LibraryMcpServer[];
  reason?: string;
}

export interface LibraryMcpServer {
  name: string;
  tools: AnonymousSchema_1609[];
  transport: AnonymousSchema_1610;
  commandName?: string;
  endpoint?: string;
  status: AnonymousSchema_1613;
}

export type AnonymousSchema_1609 = 'omp' | 'claude' | 'agy';

export type AnonymousSchema_1610 = 'stdio' | 'http' | 'sse';

export type AnonymousSchema_1613 = 'connected' | 'error' | 'unchecked';

export interface LibraryStorageSearchResult {
  type: 'libraryStorageSearchResult';
  requestId: string;
  kind: AnonymousSchema_1617;
  results: LibraryStorageResult[];
  reason?: string;
}

export type AnonymousSchema_1617 = 'workItems' | 'sessions' | 'openViking' | 'proofs';

export interface LibraryStorageResult {
  id: string;
  kind: AnonymousSchema_1620;
  title: string;
  description?: string;
  repo?: string;
  assignee?: string;
  status?: string;
  cwd?: string;
  timestamp?: string;
  editedFileCount?: number;
  transcriptPath?: string;
  uri?: string;
  score?: number;
  proofUrl?: string;
  mediaType?: string;
}

export type AnonymousSchema_1620 = 'workItems' | 'sessions' | 'openViking' | 'proofs';

export interface LibrarySkillPreview {
  type: 'librarySkillPreview';
  requestId: string;
  id: string;
  sourceId?: string;
  content: string;
  truncated: boolean;
  reason?: string;
}

export interface LibraryCommandResult {
  type: 'libraryCommandResult';
  requestId: string;
  command: AnonymousSchema_1644;
  ok: boolean;
  reason?: string;
  target?: string;
}

export type AnonymousSchema_1644 =
  'restoreWorkItem' | 'login' | 'checkMcp' | 'setClaudeRole' | 'setSkillMode';

export interface TerminalAttachedMessage {
  type: 'terminalAttached';
  requestId: string;
  sessionId: string;
  runEpoch: number;
  leaseId: string;
  cols: number;
  rows: number;
}

export interface TerminalSnapshotMessage {
  type: 'terminalSnapshot';
  sessionId: string;
  runEpoch: number;
  seq: number;
  data: string;
}

export interface TerminalDataMessage {
  type: 'terminalData';
  sessionId: string;
  runEpoch: number;
  seq: number;
  data: string;
}

export interface TerminalClosedMessage {
  type: 'terminalClosed';
  sessionId: string;
  runEpoch: number;
  seq: number;
  reason: string;
}

export interface WebviewReady {
  type: 'webviewReady';
}

export interface LaunchAgent {
  type: 'launchAgent';
  directoryPath?: string;
}

export interface FocusAgent {
  type: 'focusAgent';
  id: number;
}

export interface CloseAgent {
  type: 'closeAgent';
  id: number;
}

export interface SaveAgentSeats {
  type: 'saveAgentSeats';
  seats: Record<string, SeatAssignment>;
}

export interface SeatAssignment {
  palette: number;
  hueShift: number;
  seatId: string | null;
}

export interface SaveLayout {
  type: 'saveLayout';
  layout: Record<string, any>;
}

export interface SetSoundEnabled {
  type: 'setSoundEnabled';
  enabled: boolean;
}

export interface SetLastSeenVersion {
  type: 'setLastSeenVersion';
  version: string;
}

export interface SetAlwaysShowLabels {
  type: 'setAlwaysShowLabels';
  enabled: boolean;
}

export interface SetGhostHeadlessAgents {
  type: 'setGhostHeadlessAgents';
  enabled: boolean;
}

export interface SetHooksEnabled {
  type: 'setHooksEnabled';
  providerId: string;
  enabled: boolean;
}

export interface HooksConsentResponse {
  type: 'hooksConsentResponse';
  providerId: string;
  choice: HooksConsentChoice;
}

export type HooksConsentChoice = 'install' | 'notNow' | 'never';

export interface SetHooksInfoShown {
  type: 'setHooksInfoShown';
}

export interface SetWatchAllSessions {
  type: 'setWatchAllSessions';
  enabled: boolean;
}

export interface ExportLayout {
  type: 'exportLayout';
}

export interface ImportLayout {
  type: 'importLayout';
}

export interface OpenSessionsFolder {
  type: 'openSessionsFolder';
}

export interface AddExternalAssetDirectory {
  type: 'addExternalAssetDirectory';
  path?: string;
}

export interface RemoveExternalAssetDirectory {
  type: 'removeExternalAssetDirectory';
  path: string;
}

export interface SaveAreaMappings {
  type: 'saveAreaMappings';
  mappings: Record<string, string[]>;
}

export interface SetShowAreas {
  type: 'setShowAreas';
  enabled: boolean;
}

export interface SetBypassPermissions {
  type: 'setBypassPermissions';
  enabled: boolean;
}

export interface SetShowHostDirectories {
  type: 'setShowHostDirectories';
  enabled: boolean;
}

export interface SaveDirectory {
  type: 'saveDirectory';
  name: string;
  path: string;
  previousPath?: string;
}

export interface RemoveDirectory {
  type: 'removeDirectory';
  path: string;
}

export interface RequestDirectorySuggestions {
  type: 'requestDirectorySuggestions';
}

export interface RequestDiagnostics {
  type: 'requestDiagnostics';
}

export interface CompanySnapshotRequestMessage {
  type: 'companySnapshotRequest';
  requestId: string;
  includeDiagnostics?: boolean;
  workspacePath?: string;
}

export interface CompanyPromptSubmitMessage {
  type: 'companyPromptSubmit';
  prompt: SubmitPromptInput;
  workspacePath?: string;
}

export interface SubmitPromptInput {
  requestId: string;
  text: string;
  targetContractId?: string;
  targetSessionId?: string;
  delivery: AnonymousSchema_1734;
  mode?: AnonymousSchema_1735;
  attachments?: PromptAttachment[];
}

export type AnonymousSchema_1734 = 'prompt' | 'steer' | 'follow_up';

export type AnonymousSchema_1735 = 'chat' | 'company';

export interface CompanyContractDecisionMessage {
  type: 'companyContractDecision';
  requestId: string;
  contractId: string;
  revision: number;
  decision: AnonymousSchema_1742;
  note?: string;
}

export type AnonymousSchema_1742 = 'approve' | 'reject';

export interface CompanyQuestionAnswerMessage {
  type: 'companyQuestionAnswer';
  answer: QuestionAnswerInput;
}

export interface QuestionAnswerInput {
  requestId: string;
  questionId: string;
  runEpoch: number;
  actionDigest?: string;
  answers: Record<string, QuestionAnswer>;
  decision?: AnonymousSchema_1754;
}

export interface QuestionAnswer {
  selectedIndices: number[];
  text?: string;
  isOther: boolean;
}

export type AnonymousSchema_1754 = 'approve_once' | 'reject';

export interface CompanySessionControlMessage {
  type: 'companySessionControl';
  requestId: string;
  sessionId: string;
  runEpoch: number;
  action: AnonymousSchema_1759;
}

export type AnonymousSchema_1759 =
  'pause' | 'resume' | 'kill' | 'restart' | 'archive' | 'interrupt' | 'delete';

export interface CompanyPromptCancelMessage {
  type: 'companyPromptCancel';
  requestId: string;
  promptId: string;
}

export interface CompanyOmpSessionsRequestMessage {
  type: 'companyOmpSessionsRequest';
  requestId: string;
  workspacePath?: string;
}

export interface CompanySessionResumeMessage {
  type: 'companySessionResume';
  requestId: string;
  file: string;
  workspacePath?: string;
}

export interface CompanyWorkspaceOpenMessage {
  type: 'companyWorkspaceOpen';
  requestId: string;
  path: string;
}

export interface CompanySettingsUpdateMessage {
  type: 'companySettingsUpdate';
  requestId: string;
  workspacePath?: string;
  roleProfiles: Record<string, RoleProfile>;
}

export interface CompanyModelCatalogRequestMessage {
  type: 'companyModelCatalogRequest';
  requestId: string;
  workspacePath?: string;
}

export interface CompanyArtifactRequestMessage {
  type: 'companyArtifactRequest';
  requestId: string;
  workspacePath?: string;
  artifactId: string;
  offset: number;
  limit?: number;
}

export interface CompanyFileListRequestMessage {
  type: 'companyFileListRequest';
  requestId: string;
  workspacePath?: string;
  path: string;
}

export interface CompanyFileReadRequestMessage {
  type: 'companyFileReadRequest';
  requestId: string;
  workspacePath?: string;
  path: string;
  offset: number;
  limit?: number;
}

export interface CompanyAttachmentUploadMessage {
  type: 'companyAttachmentUpload';
  requestId: string;
  workspacePath?: string;
  fileName: string;
  mediaType: string;
  dataBase64: string;
}

export interface CompanySessionLogRequestMessage {
  type: 'companySessionLogRequest';
  requestId: string;
  sessionId: string;
  limit?: number;
}

export interface CompanySessionRenameMessage {
  type: 'companySessionRename';
  requestId: string;
  sessionId: string;
  name: string;
}

export interface CompanySessionInfoRequestMessage {
  type: 'companySessionInfoRequest';
  requestId: string;
  sessionId: string;
}

export interface CompanyChatNewMessage {
  type: 'companyChatNew';
  requestId: string;
  workspacePath?: string;
}

export interface CompanyViewModeMessage {
  type: 'companyViewMode';
  requestId: string;
  mode: AnonymousSchema_1818;
}

export type AnonymousSchema_1818 = 'all' | 'folder';

export interface CompanyFolderPickMessage {
  type: 'companyFolderPick';
  requestId: string;
}

export interface CompanyFolderNameMessage {
  type: 'companyFolderName';
  requestId: string;
  path: string;
  name: string;
}

export interface CompanyFolderForgetMessage {
  type: 'companyFolderForget';
  requestId: string;
  path: string;
}

export interface CompanyWorkItemCreateMessage {
  type: 'companyWorkItemCreate';
  requestId: string;
  workspacePath: string;
  text: string;
  assignee: WorkItemAssignee;
  priority?: number;
  acceptance?: string;
  dependsOn?: string[];
  repo?: string;
  role?: CompanyRole;
  areas?: string[];
  agent?: string;
}

export interface CompanyWorkItemAssignMessage {
  type: 'companyWorkItemAssign';
  requestId: string;
  workspacePath: string;
  id: string;
  assignee: WorkItemAssignee;
  repo?: string;
  role?: CompanyRole;
  areas?: string[];
  agent?: string;
}

export interface CompanyWorkItemFollowUpMessage {
  type: 'companyWorkItemFollowUp';
  requestId: string;
  workspacePath: string;
  id: string;
  text: string;
}

export interface CompanyWorkItemMarkMessage {
  type: 'companyWorkItemMark';
  requestId: string;
  workspacePath: string;
  id: string;
  verdict: WorkItemVerdict;
}

export type WorkItemVerdict = 'done' | 'failed';

export interface CompanyWorkItemCloudPushMessage {
  type: 'companyWorkItemCloudPush';
  requestId: string;
  workspacePath: string;
  id: string;
}

export interface CompanyWorkItemCloudPullMessage {
  type: 'companyWorkItemCloudPull';
  requestId: string;
  workspacePath: string;
  id: string;
}

export interface CompanyCloudIssueCloseMessage {
  type: 'companyCloudIssueClose';
  requestId: string;
  workspacePath: string;
  issue: number;
}

export interface CompanyWorkItemCancelMessage {
  type: 'companyWorkItemCancel';
  requestId: string;
  workspacePath: string;
  id: string;
  keepWorktree?: boolean;
}

export interface CompanyWorkItemDependenciesMessage {
  type: 'companyWorkItemDependencies';
  requestId: string;
  workspacePath: string;
  id: string;
  dependsOn: string[];
}

export interface CompanyWorkItemJudgeMessage {
  type: 'companyWorkItemJudge';
  requestId: string;
  workspacePath: string;
  id: string;
}

export interface CompanyWorkItemCleanWorktreeMessage {
  type: 'companyWorkItemCleanWorktree';
  requestId: string;
  workspacePath: string;
  id: string;
}

export interface CompanyAgentRoleSetMessage {
  type: 'companyAgentRoleSet';
  requestId: string;
  workspacePath: string;
  agent: WorkItemAssignee;
  description: string;
}

export interface CompanySquadSettingsSetMessage {
  type: 'companySquadSettingsSet';
  requestId: string;
  workspacePath: string;
  settings: SquadSettings;
}

export interface CompanySquadRequestMessage {
  type: 'companySquadRequest';
  requestId: string;
  workspacePath: string;
  text?: string;
  fromWorkItemId?: string;
}

export interface CompanySquadApproveMessage {
  type: 'companySquadApprove';
  requestId: string;
  workspacePath: string;
  runId: string;
  proposalId: string;
  rows: SquadRowInput[];
}

export interface SquadRowInput {
  text: string;
  assignee: WorkItemAssignee;
  priority?: number;
  acceptance?: string;
  dependsOn?: SquadDependency[];
  repo?: string;
  role?: CompanyRole;
  agent?: string;
  areas?: string[];
}

export interface CompanySquadDismissMessage {
  type: 'companySquadDismiss';
  requestId: string;
  workspacePath: string;
  runId: string;
  proposalId: string;
}

export interface CompanySquadCancelMessage {
  type: 'companySquadCancel';
  requestId: string;
  workspacePath: string;
  runId: string;
}

export interface CompanySquadRemoveMessage {
  type: 'companySquadRemove';
  requestId: string;
  workspacePath: string;
  runId: string;
}

export interface CompanySquadRetryMessage {
  type: 'companySquadRetry';
  requestId: string;
  workspacePath: string;
  runId: string;
}

export interface CompanySquadReplyMessage {
  type: 'companySquadReply';
  requestId: string;
  workspacePath: string;
  runId: string;
  text: string;
}

export interface CompanySquadCloseMessage {
  type: 'companySquadClose';
  requestId: string;
  workspacePath: string;
  runId: string;
}

export interface CompanySquadClaudeCheckMessage {
  type: 'companySquadClaudeCheck';
  requestId: string;
  workspacePath: string;
}

export interface LedgerViewRequestMessage {
  type: 'ledgerViewRequest';
  requestId: string;
}

export interface LedgerOpenSpecRequestMessage {
  type: 'ledgerOpenSpecRequest';
  requestId: string;
}

export interface LedgerOpenSpecFileRequestMessage {
  type: 'ledgerOpenSpecFileRequest';
  requestId: string;
  worktree: string;
  changeId: string;
  file: LedgerOpenSpecFileName;
}

export interface LedgerTimelineRequestMessage {
  type: 'ledgerTimelineRequest';
  requestId: string;
  windowMinutes: AnonymousSchema_1951;
}

export type AnonymousSchema_1951 = 15 | 60 | 360 | 1440;

export interface LedgerFileDiffRequestMessage {
  type: 'ledgerFileDiffRequest';
  requestId: string;
  worktree: string;
  path: string;
}

export interface LedgerFileHistoryRequestMessage {
  type: 'ledgerFileHistoryRequest';
  requestId: string;
  path: string;
}

export interface LedgerCoordinationRequestMessage {
  type: 'ledgerCoordinationRequest';
  requestId: string;
}

export interface LedgerToolUsageRequestMessage {
  type: 'ledgerToolUsageRequest';
  requestId: string;
  refresh: boolean;
}

export interface LedgerSendMessage {
  type: 'ledgerSendMessage';
  requestId: string;
  sessionId: string;
  text: string;
}

export interface FleetRequestMessage {
  type: 'fleetRequest';
  requestId: string;
}

export interface FleetTerminalOpenMessage {
  type: 'fleetTerminalOpen';
  requestId: string;
  machine: string;
  session: string;
}

export interface FleetTaskCreateMessage {
  type: 'fleetTaskCreate';
  requestId: string;
  machine: string;
  repo: AnonymousSchema_1977;
  slug: string;
  prompt: string;
  engine?: AnonymousSchema_1980;
}

export type AnonymousSchema_1977 = 'backend' | 'web' | 'app' | 'all';

export type AnonymousSchema_1980 = 'claude' | 'omp';

export interface FleetTaskCleanMessage {
  type: 'fleetTaskClean';
  requestId: string;
  machine: string;
  session: string;
}

export interface FleetMachineWakeMessage {
  type: 'fleetMachineWake';
  requestId: string;
  machine: string;
}

export interface FleetLavishOpenMessage {
  type: 'fleetLavishOpen';
  requestId: string;
  machine: string;
  key: string;
}

export interface FleetLavishDeleteMessage {
  type: 'fleetLavishDelete';
  requestId: string;
  machine: string;
  key: string;
}

export interface FleetDiffRequestMessage {
  type: 'fleetDiffRequest';
  requestId: string;
  machine: string;
  path: string;
}

export interface FleetCloudCommentSendMessage {
  type: 'fleetCloudCommentSend';
  requestId: string;
  machine: string;
  path: string;
  session: string;
  branch: string;
  file: string;
  line: number;
  snippet: string;
  content: string;
}

export interface FleetBranchActionMessage {
  type: 'fleetBranchAction';
  requestId: string;
  action: AnonymousSchema_2012;
  checkout: string;
  branch: string;
}

export type AnonymousSchema_2012 = 'push' | 'create-draft' | 'ready' | 'delete-remote';

export interface ProjectTreeRequestMessage {
  type: 'projectTreeRequest';
  requestId: string;
}

export interface ProjectNodeCreateMessage {
  type: 'projectNodeCreate';
  requestId: string;
  kind: AnonymousSchema_2019;
  parentId?: string;
  name: string;
  path?: string;
}

export type AnonymousSchema_2019 = 'project' | 'folder' | 'group';

export interface ProjectNodeUpdateMessage {
  type: 'projectNodeUpdate';
  requestId: string;
  nodeId: string;
  name: string;
}

export interface ProjectNodeDeleteMessage {
  type: 'projectNodeDelete';
  requestId: string;
  nodeId: string;
}

export interface ProjectNodeMoveMessage {
  type: 'projectNodeMove';
  requestId: string;
  nodeId: string;
  parentId?: string;
  index?: number;
}

export interface ProjectDiffRequestMessage {
  type: 'projectDiffRequest';
  requestId: string;
  checkout: string;
  scope: AnonymousSchema_2038;
  sha: string;
}

export type AnonymousSchema_2038 = 'uncommitted' | 'branch' | 'commit' | 'compare';

export interface ProjectCommentMessage {
  type: 'projectComment';
  requestId: string;
  checkout: string;
  file: string;
  line: number;
  snippet: string;
  content: string;
  receivingSessionId: string;
}

export interface ProjectSettingsRequestMessage {
  type: 'projectSettingsRequest';
  requestId: string;
  nodeId?: string;
}

export interface ProjectSettingsSetMessage {
  type: 'projectSettingsSet';
  requestId: string;
  scope: AnonymousSchema_2053;
  nodeId: string;
  field: ProjectSettingField;
  value: ProjectEngine | string | number | number | ProjectPrepareScript | number;
}

export type AnonymousSchema_2053 = 'project' | 'folder';

export type ProjectSettingField =
  | 'engineLeader'
  | 'engineJudge'
  | 'engineWorker'
  | 'claudeModelLeader'
  | 'claudeModelJudge'
  | 'maxParallel'
  | 'maxPerRepo'
  | 'minFreeDiskGb'
  | 'maxClaudeRuns'
  | 'maxAgyRuns'
  | 'worktreePrepare';

export type ProjectEngine = 'omp' | 'claude' | 'agy';

export interface ProjectSettingsClearMessage {
  type: 'projectSettingsClear';
  requestId: string;
  scope: AnonymousSchema_2061;
  nodeId: string;
  field: ProjectSettingField;
}

export type AnonymousSchema_2061 = 'project' | 'folder';

export interface ProjectSessionStartMessage {
  type: 'projectSessionStart';
  requestId: string;
  nodeId: string;
  engine: FleetSessionEngine;
  worktree: AnonymousSchema_2066;
  taskName: string;
  initialPrompt: string;
}

export type AnonymousSchema_2066 = 'separate' | 'shared';

export interface ProjectSessionStopMessage {
  type: 'projectSessionStop';
  requestId: string;
  sessionId: string;
}

export interface ProjectSessionWakeMessage {
  type: 'projectSessionWake';
  requestId: string;
  sessionId: string;
  prompt?: string;
}

export interface ProjectImageSaveMessage {
  type: 'projectImageSave';
  requestId: string;
  fileName: string;
  mediaType: AnonymousSchema_2079;
  dataBase64: string;
}

export type AnonymousSchema_2079 = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface ProjectBranchCompareRequestMessage {
  type: 'projectBranchCompareRequest';
  requestId: string;
  repo: string;
  branchA: string;
  branchB: string;
}

export interface ProjectMergePreviewRequestMessage {
  type: 'projectMergePreviewRequest';
  requestId: string;
  repo: string;
  branchA: string;
  branchB: string;
}

export interface LibrarySnapshotRequest {
  type: 'librarySnapshotRequest';
  requestId: string;
  section: AnonymousSchema_2093;
  refresh?: boolean;
}

export type AnonymousSchema_2093 = 'accounts' | 'storage' | 'skills' | 'mcp' | 'claudeRoles';

export interface LibrarySkillPreviewRequest {
  type: 'librarySkillPreviewRequest';
  requestId: string;
  id: string;
  sourceId?: string;
}

export interface LibraryClaudeRoleSet {
  type: 'libraryClaudeRoleSet';
  requestId: string;
  name: string;
  model?: string;
  effort?: string | null;
  enabled?: boolean;
  reset?: boolean;
}

export interface LibrarySkillModeSet {
  type: 'librarySkillModeSet';
  requestId: string;
  names: string[];
  mode: 'name-only';
}

export interface LibraryStorageSearchRequest {
  type: 'libraryStorageSearchRequest';
  requestId: string;
  kind: AnonymousSchema_2113;
  query?: string;
  repo?: string;
  agentType?: AnonymousSchema_2116;
  from?: string;
  to?: string;
  refresh?: boolean;
}

export type AnonymousSchema_2113 = 'workItems' | 'sessions' | 'openViking' | 'proofs';

export type AnonymousSchema_2116 = 'main' | 'sub' | 'claude' | 'agy';

export interface LibraryWorkItemRestore {
  type: 'libraryWorkItemRestore';
  requestId: string;
  workItemId: string;
}

export interface LibraryAccountLogin {
  type: 'libraryAccountLogin';
  requestId: string;
  tool: AnonymousSchema_2125;
  provider?: string;
}

export type AnonymousSchema_2125 = 'claude' | 'agy' | 'omp';

export interface LibraryMcpCheckRequest {
  type: 'libraryMcpCheckRequest';
  requestId: string;
  name: string;
}

export interface HerdrReadMessage {
  type: 'herdrRead';
  requestId: string;
  paneId: string;
  lines?: number;
}

export interface HerdrPromptMessage {
  type: 'herdrPrompt';
  requestId: string;
  paneId: string;
  text: string;
}

export interface HerdrKeysMessage {
  type: 'herdrKeys';
  requestId: string;
  paneId: string;
  keys: HerdrKey[];
}

export type HerdrKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'enter'
  | 'esc'
  | 'tab'
  | 'ctrl+c'
  | '1'
  | '2'
  | '3'
  | 'y'
  | 'n';

export interface HerdrFocusMessage {
  type: 'herdrFocus';
  requestId: string;
  paneId: string;
}

export interface HerdrRenameMessage {
  type: 'herdrRename';
  requestId: string;
  paneId: string;
  name: string;
}

export interface HerdrInfoRequestMessage {
  type: 'herdrInfoRequest';
  requestId: string;
  paneId: string;
}

export interface HerdrCloseMessage {
  type: 'herdrClose';
  requestId: string;
  paneId: string;
}

export interface HerdrWakeMessage {
  type: 'herdrWake';
  requestId: string;
  paneId: string;
  prompt?: string;
}

export interface HerdrWatchMessage {
  type: 'herdrWatch';
  requestId: string;
  paneId: string;
  watching: boolean;
}

export interface BrowserReaperReapNow {
  type: 'browserReaperReapNow';
}

export interface UsageLimitsRequestMessage {
  type: 'usageLimitsRequest';
  requestId: string;
  force?: boolean;
}

export interface UsageHistoryRequestMessage {
  type: 'usageHistoryRequest';
  requestId: string;
  days: AnonymousSchema_2169;
  force?: boolean;
}

export type AnonymousSchema_2169 = 1 | 7 | 30;

export interface UsageStatsRequestMessage {
  type: 'usageStatsRequest';
  requestId: string;
  force?: boolean;
}

export interface TerminalAttachMessage {
  type: 'terminalAttach';
  requestId: string;
  sessionId: string;
  runEpoch: number;
  cols?: number;
  rows?: number;
}

export interface TerminalInputMessage {
  type: 'terminalInput';
  sessionId: string;
  leaseId: string;
  runEpoch: number;
  data: string;
}

export interface TerminalResizeMessage {
  type: 'terminalResize';
  sessionId: string;
  runEpoch: number;
  leaseId: string;
  cols: number;
  rows: number;
}

export interface TerminalDetachMessage {
  type: 'terminalDetach';
  sessionId: string;
  runEpoch: number;
  leaseId: string;
}

export interface CompanyState {
  schemaVersion: 1;
  revision: number;
  counters: CompanyStateCounters;
  settings: CompanyStateSettings;
  prompts: Record<string, CompanyStatePromptsAdditionalProperty>;
  contracts: Record<string, CompanyStateContractsAdditionalProperty>;
  tasks: Record<string, CompanyStateTasksAdditionalProperty>;
  sessions: Record<string, CompanyStateSessionsAdditionalProperty>;
  questions: Record<string, CompanyStateQuestionsAdditionalProperty>;
  attempts: Record<string, CompanyStateAttemptsAdditionalProperty>;
  reports: Record<string, CompanyStateReportsAdditionalProperty>;
  evidence: Record<string, CompanyStateEvidenceAdditionalProperty>;
  usageIndex: Record<string, CompanyStateUsageIndexAdditionalPropertyItem[]>;
  quotas: Record<string, CompanyStateQuotasAdditionalProperty>;
}

export interface CompanyStateCounters {
  session: number;
  task: number;
  contract: number;
}

export interface CompanyStateSettings {
  workspacePath: string;
  maxRetainedSessions: 10;
  maxLiveRunners: 4;
  maxConcurrentModelCalls: 4;
  maxWorkers: 4;
  idleParkSeconds: 120;
  roleProfiles: Record<string, CompanyStateSettingsRoleProfilesAdditionalProperty>;
  verificationProfiles: Record<string, CompanyStateSettingsVerificationProfilesAdditionalProperty>;
}

export interface CompanyStateSettingsRoleProfilesAdditionalProperty {
  role: CompanyStateSettingsRoleProfilesAdditionalPropertyRole;
  requestedModel: string;
  thinking: string;
  workflowFingerprint: string;
  toolsPolicy: CompanyStateSettingsRoleProfilesAdditionalPropertyToolsPolicy;
}

export type CompanyStateSettingsRoleProfilesAdditionalPropertyRole =
  'director' | 'advisor' | 'worker' | 'qa' | 'judge' | 'chat';

export type CompanyStateSettingsRoleProfilesAdditionalPropertyToolsPolicy =
  'read-only' | 'scoped-write' | 'verification-only' | 'omp';

export interface CompanyStateSettingsVerificationProfilesAdditionalProperty {
  id: string;
  criterionIds: string[];
  commands: CompanyStateSettingsVerificationProfilesAdditionalPropertyCommandsItem[];
  prerequisites: string[];
  outputScopes: string[];
}

export interface CompanyStateSettingsVerificationProfilesAdditionalPropertyCommandsItem {
  id: string;
  executable: string;
  argv: string[];
  cwd: string;
  timeoutSeconds: number;
}

export interface CompanyStatePromptsAdditionalProperty {
  id: string;
  rawTextArtifactId: string;
  preview: string;
  createdAt: string;
  fragments: CompanyStatePromptsAdditionalPropertyFragmentsItem[];
  attachments?: CompanyStatePromptsAdditionalPropertyAttachmentsItem[];
  targetContractId?: string;
  targetSessionId?: string;
  routingReason?: string;
}

export interface CompanyStatePromptsAdditionalPropertyFragmentsItem {
  id: string;
  start: number;
  end: number;
  ordinal: number;
}

export interface CompanyStatePromptsAdditionalPropertyAttachmentsItem {
  artifactId: string;
  fileName: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
}

export interface CompanyStateContractsAdditionalProperty {
  id: string;
  code: string;
  revision: number;
  title?: string;
  summary?: string;
  promptIds: string[];
  requirements: CompanyStateContractsAdditionalPropertyRequirementsItem[];
  phases: CompanyStateContractsAdditionalPropertyPhasesItem[];
  tasks: CompanyStateContractsAdditionalPropertyTasksItem[];
  assumptions: string[];
  decisions: string[];
  risks?: string[];
  acceptance: CompanyStateContractsAdditionalPropertyAcceptanceItem[];
  architectureReviews?: CompanyStateContractsAdditionalPropertyArchitectureReviewsItem[];
  relatedFiles?: CompanyStateContractsAdditionalPropertyRelatedFilesItem[];
  status: CompanyStateContractsAdditionalPropertyStatus;
}

export interface CompanyStateContractsAdditionalPropertyRequirementsItem {
  id: string;
  promptId: string;
  fragmentIds: string[];
  text: string;
  kind: CompanyStateContractsAdditionalPropertyRequirementsItemKind;
  status: CompanyStateContractsAdditionalPropertyRequirementsItemStatus;
}

export type CompanyStateContractsAdditionalPropertyRequirementsItemKind =
  'goal' | 'constraint' | 'context';

export type CompanyStateContractsAdditionalPropertyRequirementsItemStatus =
  'open' | 'clarification' | 'planned' | 'satisfied' | 'blocked';

export interface CompanyStateContractsAdditionalPropertyPhasesItem {
  id: string;
  title: string;
  ordinal: number;
  taskIds: string[];
  acceptanceIds: string[];
}

export interface CompanyStateContractsAdditionalPropertyTasksItem {
  id: string;
  code: string;
  contractId: string;
  phaseId: string;
  title: string;
  requirementIds: string[];
  dependsOn: string[];
  workstreamId: string;
  readScopes: CompanyStateContractsAdditionalPropertyTasksItemReadScopesItem[];
  writeScopes: CompanyStateContractsAdditionalPropertyTasksItemWriteScopesItem[];
  sharedResources: string[];
  acceptance: string[];
  executionMode: CompanyStateContractsAdditionalPropertyTasksItemExecutionMode;
  sessionId?: string;
  status: CompanyStateContractsAdditionalPropertyTasksItemStatus;
  attemptIds: string[];
  routeReason: string;
  relatedFiles?: CompanyStateContractsAdditionalPropertyTasksItemRelatedFilesItem[];
}

export interface CompanyStateContractsAdditionalPropertyTasksItemReadScopesItem {
  path: string;
  kind: CompanyStateContractsAdditionalPropertyTasksItemReadScopesItemKind;
  operations: CompanyStateContractsAdditionalPropertyTasksItemReadScopesItemOperationsItem[];
}

export type CompanyStateContractsAdditionalPropertyTasksItemReadScopesItemKind =
  'file' | 'directory';

export type CompanyStateContractsAdditionalPropertyTasksItemReadScopesItemOperationsItem =
  'read' | 'list' | 'search';

export interface CompanyStateContractsAdditionalPropertyTasksItemWriteScopesItem {
  path: string;
  kind: CompanyStateContractsAdditionalPropertyTasksItemWriteScopesItemKind;
  operations: CompanyStateContractsAdditionalPropertyTasksItemWriteScopesItemOperationsItem[];
}

export type CompanyStateContractsAdditionalPropertyTasksItemWriteScopesItemKind =
  'file' | 'directory';

export type CompanyStateContractsAdditionalPropertyTasksItemWriteScopesItemOperationsItem =
  'create' | 'modify';

export type CompanyStateContractsAdditionalPropertyTasksItemExecutionMode =
  'inline' | 'subagent' | 'session';

export type CompanyStateContractsAdditionalPropertyTasksItemStatus =
  | 'planned'
  | 'ready'
  | 'running'
  | 'waiting_input'
  | 'paused'
  | 'verifying'
  | 'changes_requested'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface CompanyStateContractsAdditionalPropertyTasksItemRelatedFilesItem {
  path: string;
  relation: CompanyStateContractsAdditionalPropertyTasksItemRelatedFilesItemRelation;
  reason?: string;
  artifactId?: string;
}

export type CompanyStateContractsAdditionalPropertyTasksItemRelatedFilesItemRelation =
  'source' | 'changed' | 'test' | 'config' | 'evidence';

export interface CompanyStateContractsAdditionalPropertyAcceptanceItem {
  id: string;
  requirementIds: string[];
  description: string;
  kind: CompanyStateContractsAdditionalPropertyAcceptanceItemKind;
  required: boolean;
}

export type CompanyStateContractsAdditionalPropertyAcceptanceItemKind =
  'command' | 'surface' | 'review';

export interface CompanyStateContractsAdditionalPropertyArchitectureReviewsItem {
  revision: number;
  verdict: CompanyStateContractsAdditionalPropertyArchitectureReviewsItemVerdict;
  issues: CompanyStateContractsAdditionalPropertyArchitectureReviewsItemIssuesItem[];
  advisorNotes: string[];
  reviewedAt: string;
}

export type CompanyStateContractsAdditionalPropertyArchitectureReviewsItemVerdict =
  'approve' | 'changes_requested';

export interface CompanyStateContractsAdditionalPropertyArchitectureReviewsItemIssuesItem {
  severity: CompanyStateContractsAdditionalPropertyArchitectureReviewsItemIssuesItemSeverity;
  requirementIds: string[];
  evidence: string[];
  fix: string;
}

export type CompanyStateContractsAdditionalPropertyArchitectureReviewsItemIssuesItemSeverity =
  'P0' | 'P1' | 'P2' | 'P3';

export interface CompanyStateContractsAdditionalPropertyRelatedFilesItem {
  path: string;
  relation: CompanyStateContractsAdditionalPropertyRelatedFilesItemRelation;
  reason?: string;
  artifactId?: string;
}

export type CompanyStateContractsAdditionalPropertyRelatedFilesItemRelation =
  'source' | 'changed' | 'test' | 'config' | 'evidence';

export type CompanyStateContractsAdditionalPropertyStatus =
  | 'draft'
  | 'clarifying'
  | 'architecture_review'
  | 'awaiting_approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'cancelled';

export interface CompanyStateTasksAdditionalProperty {
  id: string;
  code: string;
  contractId: string;
  phaseId: string;
  title: string;
  requirementIds: string[];
  dependsOn: string[];
  workstreamId: string;
  readScopes: CompanyStateTasksAdditionalPropertyReadScopesItem[];
  writeScopes: CompanyStateTasksAdditionalPropertyWriteScopesItem[];
  sharedResources: string[];
  acceptance: string[];
  executionMode: CompanyStateTasksAdditionalPropertyExecutionMode;
  sessionId?: string;
  status: CompanyStateTasksAdditionalPropertyStatus;
  attemptIds: string[];
  routeReason: string;
  relatedFiles?: CompanyStateTasksAdditionalPropertyRelatedFilesItem[];
}

export interface CompanyStateTasksAdditionalPropertyReadScopesItem {
  path: string;
  kind: CompanyStateTasksAdditionalPropertyReadScopesItemKind;
  operations: CompanyStateTasksAdditionalPropertyReadScopesItemOperationsItem[];
}

export type CompanyStateTasksAdditionalPropertyReadScopesItemKind = 'file' | 'directory';

export type CompanyStateTasksAdditionalPropertyReadScopesItemOperationsItem =
  'read' | 'list' | 'search';

export interface CompanyStateTasksAdditionalPropertyWriteScopesItem {
  path: string;
  kind: CompanyStateTasksAdditionalPropertyWriteScopesItemKind;
  operations: CompanyStateTasksAdditionalPropertyWriteScopesItemOperationsItem[];
}

export type CompanyStateTasksAdditionalPropertyWriteScopesItemKind = 'file' | 'directory';

export type CompanyStateTasksAdditionalPropertyWriteScopesItemOperationsItem = 'create' | 'modify';

export type CompanyStateTasksAdditionalPropertyExecutionMode = 'inline' | 'subagent' | 'session';

export type CompanyStateTasksAdditionalPropertyStatus =
  | 'planned'
  | 'ready'
  | 'running'
  | 'waiting_input'
  | 'paused'
  | 'verifying'
  | 'changes_requested'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface CompanyStateTasksAdditionalPropertyRelatedFilesItem {
  path: string;
  relation: CompanyStateTasksAdditionalPropertyRelatedFilesItemRelation;
  reason?: string;
  artifactId?: string;
}

export type CompanyStateTasksAdditionalPropertyRelatedFilesItemRelation =
  'source' | 'changed' | 'test' | 'config' | 'evidence';

export interface CompanyStateSessionsAdditionalProperty {
  id: string;
  code: string;
  name: string;
  role: CompanyStateSessionsAdditionalPropertyRole;
  workstreamId: string;
  workspaceKey: string;
  cwd?: string;
  requestedModel: string;
  effectiveModel?: string;
  nativeSessionId?: string;
  nativeSessionPath?: string;
  agentId?: number;
  runEpoch: number;
  status: CompanyStateSessionsAdditionalPropertyStatus;
  activeTaskId?: string;
  lastUsedAt: string;
  contextSnapshot?: Record<string, any>;
  handoffArtifactId?: string;
  insight?: CompanyStateSessionsAdditionalPropertyInsight;
}

export type CompanyStateSessionsAdditionalPropertyRole =
  'director' | 'advisor' | 'worker' | 'qa' | 'judge' | 'chat';

export type CompanyStateSessionsAdditionalPropertyStatus =
  | 'parked'
  | 'starting'
  | 'idle'
  | 'busy'
  | 'waiting_input'
  | 'pausing'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'crashed'
  | 'archived';

export interface CompanyStateSessionsAdditionalPropertyInsight {
  observedAt: string;
  todo?: CompanyStateSessionsAdditionalPropertyInsightTodo;
  planMode: string;
  subagents: CompanyStateSessionsAdditionalPropertyInsightSubagentsItem[];
}

export interface CompanyStateSessionsAdditionalPropertyInsightTodo {
  phases: CompanyStateSessionsAdditionalPropertyInsightTodoPhasesItem[];
}

export interface CompanyStateSessionsAdditionalPropertyInsightTodoPhasesItem {
  name: string;
  tasks: CompanyStateSessionsAdditionalPropertyInsightTodoPhasesItemTasksItem[];
}

export interface CompanyStateSessionsAdditionalPropertyInsightTodoPhasesItemTasksItem {
  content: string;
  status: CompanyStateSessionsAdditionalPropertyInsightTodoPhasesItemTasksItemStatus;
  blocker?: string;
}

export type CompanyStateSessionsAdditionalPropertyInsightTodoPhasesItemTasksItemStatus =
  'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';

export interface CompanyStateSessionsAdditionalPropertyInsightSubagentsItem {
  id: string;
  agent: string;
  status: CompanyStateSessionsAdditionalPropertyInsightSubagentsItemStatus;
  task?: string;
  currentTool?: string;
  tokens: number;
  contextTokens?: number;
  contextWindow?: number;
  costUsd?: number;
  durationMs: number;
  completionPercent?: number;
}

export type CompanyStateSessionsAdditionalPropertyInsightSubagentsItemStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'aborted';

export interface CompanyStateQuestionsAdditionalProperty {
  id: string;
  sessionId: string;
  taskId?: string;
  runEpoch: number;
  nativeToolCallId?: string;
  kind: CompanyStateQuestionsAdditionalPropertyKind;
  title: string;
  questions: CompanyStateQuestionsAdditionalPropertyQuestionsItem[];
  actionDigest?: string;
  status: CompanyStateQuestionsAdditionalPropertyStatus;
  answer?: Record<string, any>;
  createdAt: string;
  resolvedAt?: string;
}

export type CompanyStateQuestionsAdditionalPropertyKind =
  'clarification' | 'technical_choice' | 'approval';

export interface CompanyStateQuestionsAdditionalPropertyQuestionsItem {
  id: string;
  question: string;
  options: CompanyStateQuestionsAdditionalPropertyQuestionsItemOptionsItem[];
  recommended?: number;
  multi?: boolean;
}

export interface CompanyStateQuestionsAdditionalPropertyQuestionsItemOptionsItem {
  label: string;
  description?: string;
}

export type CompanyStateQuestionsAdditionalPropertyStatus =
  'pending' | 'answered' | 'rejected' | 'cancelled' | 'expired';

export interface CompanyStateAttemptsAdditionalProperty {
  id: string;
  taskId: string;
  sessionId: string;
  runEpoch: number;
  startedAt: string;
  endedAt?: string;
  status: CompanyStateAttemptsAdditionalPropertyStatus;
  changes: CompanyStateAttemptsAdditionalPropertyChangesItem[];
  evidenceIds: string[];
  qaVerdict?: Record<string, any>;
  judgeVerdict?: Record<string, any>;
  error?: string;
}

export type CompanyStateAttemptsAdditionalPropertyStatus =
  'running' | 'passed' | 'failed' | 'interrupted' | 'blocked';

export interface CompanyStateAttemptsAdditionalPropertyChangesItem {
  path: string;
  kind: CompanyStateAttemptsAdditionalPropertyChangesItemKind;
  summary: string;
  diffArtifactId?: string;
}

export type CompanyStateAttemptsAdditionalPropertyChangesItemKind = 'create' | 'modify' | 'delete';

export interface CompanyStateReportsAdditionalProperty {
  contractId: string;
  revision: number;
  requirements: CompanyStateReportsAdditionalPropertyRequirementsItem[];
  relatedChanges: CompanyStateReportsAdditionalPropertyRelatedChangesItem[];
  verificationEvidenceIds: string[];
  advisorNotes: string[];
  usage: CompanyStateReportsAdditionalPropertyUsageItem[];
  sessions: CompanyStateReportsAdditionalPropertySessionsItem[];
}

export interface CompanyStateReportsAdditionalPropertyRequirementsItem {
  requirementId: string;
  taskIds: string[];
  attemptIds: string[];
  evidenceIds: string[];
  result: string;
}

export interface CompanyStateReportsAdditionalPropertyRelatedChangesItem {
  path: string;
  kind: CompanyStateReportsAdditionalPropertyRelatedChangesItemKind;
  summary: string;
  diffArtifactId?: string;
}

export type CompanyStateReportsAdditionalPropertyRelatedChangesItemKind =
  'create' | 'modify' | 'delete';

export interface CompanyStateReportsAdditionalPropertyUsageItem {
  sessionId: string;
  nativeSessionId: string;
  nativeEntryId: string;
  role: CompanyStateReportsAdditionalPropertyUsageItemRole;
  model: string;
  provider: string;
  purpose: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd?: number;
  timestamp: string;
  source: CompanyStateReportsAdditionalPropertyUsageItemSource;
  availability: string;
  provenance: CompanyStateReportsAdditionalPropertyUsageItemProvenance;
  toolCallId?: string;
  runEpoch: number;
  taskId?: string;
  contractId?: string;
  totalTokens?: number;
}

export type CompanyStateReportsAdditionalPropertyUsageItemRole =
  'director' | 'advisor' | 'worker' | 'qa' | 'judge' | 'chat';

export type CompanyStateReportsAdditionalPropertyUsageItemSource = 'provider' | 'native_session';

export type CompanyStateReportsAdditionalPropertyUsageItemProvenance =
  'own_turn' | 'native_child' | 'child_aggregate';

export interface CompanyStateReportsAdditionalPropertySessionsItem {
  sessionId: string;
  role: CompanyStateReportsAdditionalPropertySessionsItemRole;
  requestedModel: string;
  effectiveModel?: string;
  runEpoch: number;
  status: string;
}

export type CompanyStateReportsAdditionalPropertySessionsItemRole =
  'director' | 'advisor' | 'worker' | 'qa' | 'judge' | 'chat';

export interface CompanyStateEvidenceAdditionalProperty {
  id: string;
  command: CompanyStateEvidenceAdditionalPropertyCommand;
  startedAt: string;
  endedAt: string;
  exitCode?: number;
  signal?: string;
  stdoutArtifactId?: string;
  stderrArtifactId?: string;
  prerequisites?: string[];
  criterionIds: string[];
}

export interface CompanyStateEvidenceAdditionalPropertyCommand {
  id: string;
  executable: string;
  argv: string[];
  cwd: string;
  timeoutSeconds: number;
}

export interface CompanyStateUsageIndexAdditionalPropertyItem {
  sessionId: string;
  nativeSessionId: string;
  nativeEntryId: string;
  role: CompanyStateUsageIndexAdditionalPropertyItemRole;
  model: string;
  provider: string;
  purpose: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd?: number;
  timestamp: string;
  source: CompanyStateUsageIndexAdditionalPropertyItemSource;
  availability: string;
  provenance: CompanyStateUsageIndexAdditionalPropertyItemProvenance;
  toolCallId?: string;
  runEpoch: number;
  taskId?: string;
  contractId?: string;
  totalTokens?: number;
}

export type CompanyStateUsageIndexAdditionalPropertyItemRole =
  'director' | 'advisor' | 'worker' | 'qa' | 'judge' | 'chat';

export type CompanyStateUsageIndexAdditionalPropertyItemSource = 'provider' | 'native_session';

export type CompanyStateUsageIndexAdditionalPropertyItemProvenance =
  'own_turn' | 'native_child' | 'child_aggregate';

export interface CompanyStateQuotasAdditionalProperty {
  provider: string;
  accountId?: string;
  accountLabel?: string;
  note?: string;
  windows: CompanyStateQuotasAdditionalPropertyWindowsItem[];
  fetchedAt: string;
  status: CompanyStateQuotasAdditionalPropertyStatus;
}

export interface CompanyStateQuotasAdditionalPropertyWindowsItem {
  id: string;
  label: string;
  windowLabel?: string;
  durationMs?: number;
  shared?: boolean;
  tier?: string;
  used?: number;
  limit?: number;
  remaining?: number;
  usedFraction?: number;
  resetAt?: string;
  reportedUnit: string;
  status?: string;
}

export type CompanyStateQuotasAdditionalPropertyStatus =
  'available' | 'unsupported' | 'unauthenticated' | 'error' | 'stale';

export interface CompanyEvent {
  id: string;
  sequence: number;
  at: string;
  baseRevision: number;
  changes: (
    | CompanyEventChangesItemOneOf_0
    | CompanyEventChangesItemOneOf_1
    | CompanyEventChangesItemOneOf_2
    | CompanyEventChangesItemOneOf_3
    | CompanyEventChangesItemOneOf_4
    | CompanyEventChangesItemOneOf_5
    | CompanyEventChangesItemOneOf_6
    | CompanyEventChangesItemOneOf_7
    | CompanyEventChangesItemOneOf_8
    | CompanyEventChangesItemOneOf_9
    | CompanyEventChangesItemOneOf_10
    | CompanyEventChangesItemOneOf_11
    | CompanyEventChangesItemOneOf_12
  )[];
}

export interface CompanyEventChangesItemOneOf_0 {
  entity: 'prompt';
  op: 'put';
  id: string;
  value: CompanyEventChangesItemOneOf_0Value;
}

export interface CompanyEventChangesItemOneOf_0Value {
  id: string;
  rawTextArtifactId: string;
  preview: string;
  createdAt: string;
  fragments: CompanyEventChangesItemOneOf_0ValueFragmentsItem[];
  attachments?: CompanyEventChangesItemOneOf_0ValueAttachmentsItem[];
  targetContractId?: string;
  targetSessionId?: string;
  routingReason?: string;
}

export interface CompanyEventChangesItemOneOf_0ValueFragmentsItem {
  id: string;
  start: number;
  end: number;
  ordinal: number;
}

export interface CompanyEventChangesItemOneOf_0ValueAttachmentsItem {
  artifactId: string;
  fileName: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
}

export interface CompanyEventChangesItemOneOf_1 {
  entity: 'contract';
  op: 'put';
  id: string;
  value: CompanyEventChangesItemOneOf_1Value;
}

export interface CompanyEventChangesItemOneOf_1Value {
  id: string;
  code: string;
  revision: number;
  title?: string;
  summary?: string;
  promptIds: string[];
  requirements: CompanyEventChangesItemOneOf_1ValueRequirementsItem[];
  phases: CompanyEventChangesItemOneOf_1ValuePhasesItem[];
  tasks: CompanyEventChangesItemOneOf_1ValueTasksItem[];
  assumptions: string[];
  decisions: string[];
  risks?: string[];
  acceptance: CompanyEventChangesItemOneOf_1ValueAcceptanceItem[];
  architectureReviews?: CompanyEventChangesItemOneOf_1ValueArchitectureReviewsItem[];
  relatedFiles?: CompanyEventChangesItemOneOf_1ValueRelatedFilesItem[];
  status: CompanyEventChangesItemOneOf_1ValueStatus;
}

export interface CompanyEventChangesItemOneOf_1ValueRequirementsItem {
  id: string;
  promptId: string;
  fragmentIds: string[];
  text: string;
  kind: CompanyEventChangesItemOneOf_1ValueRequirementsItemKind;
  status: CompanyEventChangesItemOneOf_1ValueRequirementsItemStatus;
}

export type CompanyEventChangesItemOneOf_1ValueRequirementsItemKind =
  'goal' | 'constraint' | 'context';

export type CompanyEventChangesItemOneOf_1ValueRequirementsItemStatus =
  'open' | 'clarification' | 'planned' | 'satisfied' | 'blocked';

export interface CompanyEventChangesItemOneOf_1ValuePhasesItem {
  id: string;
  title: string;
  ordinal: number;
  taskIds: string[];
  acceptanceIds: string[];
}

export interface CompanyEventChangesItemOneOf_1ValueTasksItem {
  id: string;
  code: string;
  contractId: string;
  phaseId: string;
  title: string;
  requirementIds: string[];
  dependsOn: string[];
  workstreamId: string;
  readScopes: CompanyEventChangesItemOneOf_1ValueTasksItemReadScopesItem[];
  writeScopes: CompanyEventChangesItemOneOf_1ValueTasksItemWriteScopesItem[];
  sharedResources: string[];
  acceptance: string[];
  executionMode: CompanyEventChangesItemOneOf_1ValueTasksItemExecutionMode;
  sessionId?: string;
  status: CompanyEventChangesItemOneOf_1ValueTasksItemStatus;
  attemptIds: string[];
  routeReason: string;
  relatedFiles?: CompanyEventChangesItemOneOf_1ValueTasksItemRelatedFilesItem[];
}

export interface CompanyEventChangesItemOneOf_1ValueTasksItemReadScopesItem {
  path: string;
  kind: CompanyEventChangesItemOneOf_1ValueTasksItemReadScopesItemKind;
  operations: CompanyEventChangesItemOneOf_1ValueTasksItemReadScopesItemOperationsItem[];
}

export type CompanyEventChangesItemOneOf_1ValueTasksItemReadScopesItemKind = 'file' | 'directory';

export type CompanyEventChangesItemOneOf_1ValueTasksItemReadScopesItemOperationsItem =
  'read' | 'list' | 'search';

export interface CompanyEventChangesItemOneOf_1ValueTasksItemWriteScopesItem {
  path: string;
  kind: CompanyEventChangesItemOneOf_1ValueTasksItemWriteScopesItemKind;
  operations: CompanyEventChangesItemOneOf_1ValueTasksItemWriteScopesItemOperationsItem[];
}

export type CompanyEventChangesItemOneOf_1ValueTasksItemWriteScopesItemKind = 'file' | 'directory';

export type CompanyEventChangesItemOneOf_1ValueTasksItemWriteScopesItemOperationsItem =
  'create' | 'modify';

export type CompanyEventChangesItemOneOf_1ValueTasksItemExecutionMode =
  'inline' | 'subagent' | 'session';

export type CompanyEventChangesItemOneOf_1ValueTasksItemStatus =
  | 'planned'
  | 'ready'
  | 'running'
  | 'waiting_input'
  | 'paused'
  | 'verifying'
  | 'changes_requested'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface CompanyEventChangesItemOneOf_1ValueTasksItemRelatedFilesItem {
  path: string;
  relation: CompanyEventChangesItemOneOf_1ValueTasksItemRelatedFilesItemRelation;
  reason?: string;
  artifactId?: string;
}

export type CompanyEventChangesItemOneOf_1ValueTasksItemRelatedFilesItemRelation =
  'source' | 'changed' | 'test' | 'config' | 'evidence';

export interface CompanyEventChangesItemOneOf_1ValueAcceptanceItem {
  id: string;
  requirementIds: string[];
  description: string;
  kind: CompanyEventChangesItemOneOf_1ValueAcceptanceItemKind;
  required: boolean;
}

export type CompanyEventChangesItemOneOf_1ValueAcceptanceItemKind =
  'command' | 'surface' | 'review';

export interface CompanyEventChangesItemOneOf_1ValueArchitectureReviewsItem {
  revision: number;
  verdict: CompanyEventChangesItemOneOf_1ValueArchitectureReviewsItemVerdict;
  issues: CompanyEventChangesItemOneOf_1ValueArchitectureReviewsItemIssuesItem[];
  advisorNotes: string[];
  reviewedAt: string;
}

export type CompanyEventChangesItemOneOf_1ValueArchitectureReviewsItemVerdict =
  'approve' | 'changes_requested';

export interface CompanyEventChangesItemOneOf_1ValueArchitectureReviewsItemIssuesItem {
  severity: CompanyEventChangesItemOneOf_1ValueArchitectureReviewsItemIssuesItemSeverity;
  requirementIds: string[];
  evidence: string[];
  fix: string;
}

export type CompanyEventChangesItemOneOf_1ValueArchitectureReviewsItemIssuesItemSeverity =
  'P0' | 'P1' | 'P2' | 'P3';

export interface CompanyEventChangesItemOneOf_1ValueRelatedFilesItem {
  path: string;
  relation: CompanyEventChangesItemOneOf_1ValueRelatedFilesItemRelation;
  reason?: string;
  artifactId?: string;
}

export type CompanyEventChangesItemOneOf_1ValueRelatedFilesItemRelation =
  'source' | 'changed' | 'test' | 'config' | 'evidence';

export type CompanyEventChangesItemOneOf_1ValueStatus =
  | 'draft'
  | 'clarifying'
  | 'architecture_review'
  | 'awaiting_approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'cancelled';

export interface CompanyEventChangesItemOneOf_2 {
  entity: 'task';
  op: 'put';
  id: string;
  value: CompanyEventChangesItemOneOf_2Value;
}

export interface CompanyEventChangesItemOneOf_2Value {
  id: string;
  code: string;
  contractId: string;
  phaseId: string;
  title: string;
  requirementIds: string[];
  dependsOn: string[];
  workstreamId: string;
  readScopes: CompanyEventChangesItemOneOf_2ValueReadScopesItem[];
  writeScopes: CompanyEventChangesItemOneOf_2ValueWriteScopesItem[];
  sharedResources: string[];
  acceptance: string[];
  executionMode: CompanyEventChangesItemOneOf_2ValueExecutionMode;
  sessionId?: string;
  status: CompanyEventChangesItemOneOf_2ValueStatus;
  attemptIds: string[];
  routeReason: string;
  relatedFiles?: CompanyEventChangesItemOneOf_2ValueRelatedFilesItem[];
}

export interface CompanyEventChangesItemOneOf_2ValueReadScopesItem {
  path: string;
  kind: CompanyEventChangesItemOneOf_2ValueReadScopesItemKind;
  operations: CompanyEventChangesItemOneOf_2ValueReadScopesItemOperationsItem[];
}

export type CompanyEventChangesItemOneOf_2ValueReadScopesItemKind = 'file' | 'directory';

export type CompanyEventChangesItemOneOf_2ValueReadScopesItemOperationsItem =
  'read' | 'list' | 'search';

export interface CompanyEventChangesItemOneOf_2ValueWriteScopesItem {
  path: string;
  kind: CompanyEventChangesItemOneOf_2ValueWriteScopesItemKind;
  operations: CompanyEventChangesItemOneOf_2ValueWriteScopesItemOperationsItem[];
}

export type CompanyEventChangesItemOneOf_2ValueWriteScopesItemKind = 'file' | 'directory';

export type CompanyEventChangesItemOneOf_2ValueWriteScopesItemOperationsItem = 'create' | 'modify';

export type CompanyEventChangesItemOneOf_2ValueExecutionMode = 'inline' | 'subagent' | 'session';

export type CompanyEventChangesItemOneOf_2ValueStatus =
  | 'planned'
  | 'ready'
  | 'running'
  | 'waiting_input'
  | 'paused'
  | 'verifying'
  | 'changes_requested'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface CompanyEventChangesItemOneOf_2ValueRelatedFilesItem {
  path: string;
  relation: CompanyEventChangesItemOneOf_2ValueRelatedFilesItemRelation;
  reason?: string;
  artifactId?: string;
}

export type CompanyEventChangesItemOneOf_2ValueRelatedFilesItemRelation =
  'source' | 'changed' | 'test' | 'config' | 'evidence';

export interface CompanyEventChangesItemOneOf_3 {
  entity: 'session';
  op: 'put';
  id: string;
  value: CompanyEventChangesItemOneOf_3Value;
}

export interface CompanyEventChangesItemOneOf_3Value {
  id: string;
  code: string;
  name: string;
  role: CompanyEventChangesItemOneOf_3ValueRole;
  workstreamId: string;
  workspaceKey: string;
  cwd?: string;
  requestedModel: string;
  effectiveModel?: string;
  nativeSessionId?: string;
  nativeSessionPath?: string;
  agentId?: number;
  runEpoch: number;
  status: CompanyEventChangesItemOneOf_3ValueStatus;
  activeTaskId?: string;
  lastUsedAt: string;
  contextSnapshot?: Record<string, any>;
  handoffArtifactId?: string;
  insight?: CompanyEventChangesItemOneOf_3ValueInsight;
}

export type CompanyEventChangesItemOneOf_3ValueRole =
  'director' | 'advisor' | 'worker' | 'qa' | 'judge' | 'chat';

export type CompanyEventChangesItemOneOf_3ValueStatus =
  | 'parked'
  | 'starting'
  | 'idle'
  | 'busy'
  | 'waiting_input'
  | 'pausing'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'crashed'
  | 'archived';

export interface CompanyEventChangesItemOneOf_3ValueInsight {
  observedAt: string;
  todo?: CompanyEventChangesItemOneOf_3ValueInsightTodo;
  planMode: string;
  subagents: CompanyEventChangesItemOneOf_3ValueInsightSubagentsItem[];
}

export interface CompanyEventChangesItemOneOf_3ValueInsightTodo {
  phases: CompanyEventChangesItemOneOf_3ValueInsightTodoPhasesItem[];
}

export interface CompanyEventChangesItemOneOf_3ValueInsightTodoPhasesItem {
  name: string;
  tasks: CompanyEventChangesItemOneOf_3ValueInsightTodoPhasesItemTasksItem[];
}

export interface CompanyEventChangesItemOneOf_3ValueInsightTodoPhasesItemTasksItem {
  content: string;
  status: CompanyEventChangesItemOneOf_3ValueInsightTodoPhasesItemTasksItemStatus;
  blocker?: string;
}

export type CompanyEventChangesItemOneOf_3ValueInsightTodoPhasesItemTasksItemStatus =
  'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';

export interface CompanyEventChangesItemOneOf_3ValueInsightSubagentsItem {
  id: string;
  agent: string;
  status: CompanyEventChangesItemOneOf_3ValueInsightSubagentsItemStatus;
  task?: string;
  currentTool?: string;
  tokens: number;
  contextTokens?: number;
  contextWindow?: number;
  costUsd?: number;
  durationMs: number;
  completionPercent?: number;
}

export type CompanyEventChangesItemOneOf_3ValueInsightSubagentsItemStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'aborted';

export interface CompanyEventChangesItemOneOf_4 {
  entity: 'question';
  op: 'put';
  id: string;
  value: CompanyEventChangesItemOneOf_4Value;
}

export interface CompanyEventChangesItemOneOf_4Value {
  id: string;
  sessionId: string;
  taskId?: string;
  runEpoch: number;
  nativeToolCallId?: string;
  kind: CompanyEventChangesItemOneOf_4ValueKind;
  title: string;
  questions: CompanyEventChangesItemOneOf_4ValueQuestionsItem[];
  actionDigest?: string;
  status: CompanyEventChangesItemOneOf_4ValueStatus;
  answer?: Record<string, any>;
  createdAt: string;
  resolvedAt?: string;
}

export type CompanyEventChangesItemOneOf_4ValueKind =
  'clarification' | 'technical_choice' | 'approval';

export interface CompanyEventChangesItemOneOf_4ValueQuestionsItem {
  id: string;
  question: string;
  options: CompanyEventChangesItemOneOf_4ValueQuestionsItemOptionsItem[];
  recommended?: number;
  multi?: boolean;
}

export interface CompanyEventChangesItemOneOf_4ValueQuestionsItemOptionsItem {
  label: string;
  description?: string;
}

export type CompanyEventChangesItemOneOf_4ValueStatus =
  'pending' | 'answered' | 'rejected' | 'cancelled' | 'expired';

export interface CompanyEventChangesItemOneOf_5 {
  entity: 'attempt';
  op: 'put';
  id: string;
  value: CompanyEventChangesItemOneOf_5Value;
}

export interface CompanyEventChangesItemOneOf_5Value {
  id: string;
  taskId: string;
  sessionId: string;
  runEpoch: number;
  startedAt: string;
  endedAt?: string;
  status: CompanyEventChangesItemOneOf_5ValueStatus;
  changes: CompanyEventChangesItemOneOf_5ValueChangesItem[];
  evidenceIds: string[];
  qaVerdict?: Record<string, any>;
  judgeVerdict?: Record<string, any>;
  error?: string;
}

export type CompanyEventChangesItemOneOf_5ValueStatus =
  'running' | 'passed' | 'failed' | 'interrupted' | 'blocked';

export interface CompanyEventChangesItemOneOf_5ValueChangesItem {
  path: string;
  kind: CompanyEventChangesItemOneOf_5ValueChangesItemKind;
  summary: string;
  diffArtifactId?: string;
}

export type CompanyEventChangesItemOneOf_5ValueChangesItemKind = 'create' | 'modify' | 'delete';

export interface CompanyEventChangesItemOneOf_6 {
  entity: 'report';
  op: 'put';
  id: string;
  value: CompanyEventChangesItemOneOf_6Value;
}

export interface CompanyEventChangesItemOneOf_6Value {
  contractId: string;
  revision: number;
  requirements: CompanyEventChangesItemOneOf_6ValueRequirementsItem[];
  relatedChanges: CompanyEventChangesItemOneOf_6ValueRelatedChangesItem[];
  verificationEvidenceIds: string[];
  advisorNotes: string[];
  usage: CompanyEventChangesItemOneOf_6ValueUsageItem[];
  sessions: CompanyEventChangesItemOneOf_6ValueSessionsItem[];
}

export interface CompanyEventChangesItemOneOf_6ValueRequirementsItem {
  requirementId: string;
  taskIds: string[];
  attemptIds: string[];
  evidenceIds: string[];
  result: string;
}

export interface CompanyEventChangesItemOneOf_6ValueRelatedChangesItem {
  path: string;
  kind: CompanyEventChangesItemOneOf_6ValueRelatedChangesItemKind;
  summary: string;
  diffArtifactId?: string;
}

export type CompanyEventChangesItemOneOf_6ValueRelatedChangesItemKind =
  'create' | 'modify' | 'delete';

export interface CompanyEventChangesItemOneOf_6ValueUsageItem {
  sessionId: string;
  nativeSessionId: string;
  nativeEntryId: string;
  role: CompanyEventChangesItemOneOf_6ValueUsageItemRole;
  model: string;
  provider: string;
  purpose: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd?: number;
  timestamp: string;
  source: CompanyEventChangesItemOneOf_6ValueUsageItemSource;
  availability: string;
  provenance: CompanyEventChangesItemOneOf_6ValueUsageItemProvenance;
  toolCallId?: string;
  runEpoch: number;
  taskId?: string;
  contractId?: string;
  totalTokens?: number;
}

export type CompanyEventChangesItemOneOf_6ValueUsageItemRole =
  'director' | 'advisor' | 'worker' | 'qa' | 'judge' | 'chat';

export type CompanyEventChangesItemOneOf_6ValueUsageItemSource = 'provider' | 'native_session';

export type CompanyEventChangesItemOneOf_6ValueUsageItemProvenance =
  'own_turn' | 'native_child' | 'child_aggregate';

export interface CompanyEventChangesItemOneOf_6ValueSessionsItem {
  sessionId: string;
  role: CompanyEventChangesItemOneOf_6ValueSessionsItemRole;
  requestedModel: string;
  effectiveModel?: string;
  runEpoch: number;
  status: string;
}

export type CompanyEventChangesItemOneOf_6ValueSessionsItemRole =
  'director' | 'advisor' | 'worker' | 'qa' | 'judge' | 'chat';

export interface CompanyEventChangesItemOneOf_7 {
  entity: 'evidence';
  op: 'put';
  id: string;
  value: CompanyEventChangesItemOneOf_7Value;
}

export interface CompanyEventChangesItemOneOf_7Value {
  id: string;
  command: CompanyEventChangesItemOneOf_7ValueCommand;
  startedAt: string;
  endedAt: string;
  exitCode?: number;
  signal?: string;
  stdoutArtifactId?: string;
  stderrArtifactId?: string;
  prerequisites?: string[];
  criterionIds: string[];
}

export interface CompanyEventChangesItemOneOf_7ValueCommand {
  id: string;
  executable: string;
  argv: string[];
  cwd: string;
  timeoutSeconds: number;
}

export interface CompanyEventChangesItemOneOf_8 {
  entity: 'settings';
  op: 'put';
  id: 'settings';
  value: CompanyEventChangesItemOneOf_8Value;
}

export interface CompanyEventChangesItemOneOf_8Value {
  workspacePath: string;
  maxRetainedSessions: 10;
  maxLiveRunners: 4;
  maxConcurrentModelCalls: 4;
  maxWorkers: 4;
  idleParkSeconds: 120;
  roleProfiles: Record<string, CompanyEventChangesItemOneOf_8ValueRoleProfilesAdditionalProperty>;
  verificationProfiles: Record<
    string,
    CompanyEventChangesItemOneOf_8ValueVerificationProfilesAdditionalProperty
  >;
}

export interface CompanyEventChangesItemOneOf_8ValueRoleProfilesAdditionalProperty {
  role: CompanyEventChangesItemOneOf_8ValueRoleProfilesAdditionalPropertyRole;
  requestedModel: string;
  thinking: string;
  workflowFingerprint: string;
  toolsPolicy: CompanyEventChangesItemOneOf_8ValueRoleProfilesAdditionalPropertyToolsPolicy;
}

export type CompanyEventChangesItemOneOf_8ValueRoleProfilesAdditionalPropertyRole =
  'director' | 'advisor' | 'worker' | 'qa' | 'judge' | 'chat';

export type CompanyEventChangesItemOneOf_8ValueRoleProfilesAdditionalPropertyToolsPolicy =
  'read-only' | 'scoped-write' | 'verification-only' | 'omp';

export interface CompanyEventChangesItemOneOf_8ValueVerificationProfilesAdditionalProperty {
  id: string;
  criterionIds: string[];
  commands: CompanyEventChangesItemOneOf_8ValueVerificationProfilesAdditionalPropertyCommandsItem[];
  prerequisites: string[];
  outputScopes: string[];
}

export interface CompanyEventChangesItemOneOf_8ValueVerificationProfilesAdditionalPropertyCommandsItem {
  id: string;
  executable: string;
  argv: string[];
  cwd: string;
  timeoutSeconds: number;
}

export interface CompanyEventChangesItemOneOf_9 {
  entity: 'usage';
  op: 'put';
  id: string;
  value: CompanyEventChangesItemOneOf_9Value;
}

export interface CompanyEventChangesItemOneOf_9Value {
  sessionId: string;
  nativeSessionId: string;
  nativeEntryId: string;
  role: CompanyEventChangesItemOneOf_9ValueRole;
  model: string;
  provider: string;
  purpose: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd?: number;
  timestamp: string;
  source: CompanyEventChangesItemOneOf_9ValueSource;
  availability: string;
  provenance: CompanyEventChangesItemOneOf_9ValueProvenance;
  toolCallId?: string;
  runEpoch: number;
  taskId?: string;
  contractId?: string;
  totalTokens?: number;
}

export type CompanyEventChangesItemOneOf_9ValueRole =
  'director' | 'advisor' | 'worker' | 'qa' | 'judge' | 'chat';

export type CompanyEventChangesItemOneOf_9ValueSource = 'provider' | 'native_session';

export type CompanyEventChangesItemOneOf_9ValueProvenance =
  'own_turn' | 'native_child' | 'child_aggregate';

export interface CompanyEventChangesItemOneOf_10 {
  entity: 'quota';
  op: 'put';
  id: string;
  value: CompanyEventChangesItemOneOf_10Value;
}

export interface CompanyEventChangesItemOneOf_10Value {
  provider: string;
  accountId?: string;
  accountLabel?: string;
  note?: string;
  windows: CompanyEventChangesItemOneOf_10ValueWindowsItem[];
  fetchedAt: string;
  status: CompanyEventChangesItemOneOf_10ValueStatus;
}

export interface CompanyEventChangesItemOneOf_10ValueWindowsItem {
  id: string;
  label: string;
  windowLabel?: string;
  durationMs?: number;
  shared?: boolean;
  tier?: string;
  used?: number;
  limit?: number;
  remaining?: number;
  usedFraction?: number;
  resetAt?: string;
  reportedUnit: string;
  status?: string;
}

export type CompanyEventChangesItemOneOf_10ValueStatus =
  'available' | 'unsupported' | 'unauthenticated' | 'error' | 'stale';

export interface CompanyEventChangesItemOneOf_11 {
  entity: 'counters';
  op: 'put';
  id: 'counters';
  value: CompanyEventChangesItemOneOf_11Value;
}

export interface CompanyEventChangesItemOneOf_11Value {
  session: number;
  task: number;
  contract: number;
}

export interface CompanyEventChangesItemOneOf_12 {
  entity: CompanyEventChangesItemOneOf_12Entity;
  op: 'remove';
  id: string;
}

export type CompanyEventChangesItemOneOf_12Entity =
  | 'prompt'
  | 'contract'
  | 'task'
  | 'session'
  | 'question'
  | 'attempt'
  | 'report'
  | 'evidence'
  | 'usage'
  | 'quota';
