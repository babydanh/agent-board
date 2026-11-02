# Pixel Agents — Compressed Reference

Full-screen board for Company runs on OMP: a Director plans a Contract, the user approves it, Workers execute, QA and a Judge verify, all on a seven-lane board. Ships as a **VS Code extension** and an **`npx pixel-agents` standalone CLI** from the same source tree; the browser CLI is the supported surface. The server still carries the legacy Claude Code tracking runtime and office assets; the webview no longer renders the pixel office.

`CONTEXT.md` is the canonical glossary — read it for what terms like Agent, Sub-agent, Teammate, Lead, Adopt, or Headless agent mean here, and use its vocabulary in code, comments, and docs.

## Architecture

Strict layering: `core/` depends on nothing; `server/` depends only on `core/`; `webview-ui/` depends only on `core/`; `adapters/vscode/` depends on `core/` and `server/`. The standalone CLI never imports `adapters/vscode/` and vice versa.

```
core/                                Protocol + interface definitions (zero runtime side effects)
  asyncapi.yaml                      AsyncAPI 3.0 contract — single source of truth
  src/
    messages.ts                      AUTO-GENERATED discriminated unions (do not edit)
    schemas.ts                       AgentMeta, SpriteData, FurnitureCatalogEntry
    provider.ts                      HookProvider, AgentEvent (the integration boundary)
    teamProvider.ts                  Optional TeamProvider (semantic queries for Lead + Teammates)
    transport.ts                     MessageTransport interface, TransportState
    adapter.ts                       StateAdapter, AssetCache, PersistedAgent, AgentSeat
    terminalAdapter.ts               TerminalAdapter (editor-driven terminal management)
    normalizeProjectPath.ts
    constants.ts

server/                              Lifecycle runtime + Fastify HTTP/WS server
  src/
    providers/hook/claude/           Reference HookProvider — only place that knows Claude specifics
      claude.ts                      normalizeHookEvent for 11 Claude events, formatToolStatus, file fallback
      claudeTeamProvider.ts          TeamProvider: reads ~/.claude/teams/<name>/config.json
      claudeHookInstaller.ts         Consent-gated install/uninstall in ~/.claude/settings.json (abort on unparseable file or non-array hooks.<Event>; one-time .pixel-agents.backup, exclusive-create, no backup ⇒ no write — but skipped when the replaced content is entirely our own install's output, since backing up our own file masquerades as the user's original (`settingsHoldOnlyOurHooks`, compared against makeHookEntry — the WRITER — so a field added to what we write can't silently revive the bug; only `command`/`timeout` may differ, they vary across installs); every write failure THROWS; mode preserved, 0600 on create; re-read verify immediately before rename + retry; hook identity = `/.pixel-agents/hooks/claude-hook.js` suffix anchored at both ends of the command's first token, case-insensitive; `areHooksInstalled` = ANY of our commands on ANY event)
      consentCopy.ts                 Claude's first-run consent disclosure text (scope/data/undo), served through consentDisclosure()
      constants.ts                   Claude hook event names, script path
      hooks/claude-hook.ts           Hook script (CJS+shebang, bundled to dist/hooks/claude-hook.js)
    providers/hook/consentGate.ts    Provider-agnostic consent POLICY: when to ask (hooksConsentRequest per provider) and what an answer means (consentActionFor(choice, {installed, consent}) — see docs/adr/0001)
    providers/hook/consentExecutor.ts Provider-agnostic consent EXECUTION: applyConsentChoice(providerId, choice, ConsentEffects) runs the six actions in one order for both surfaces, and SERIALIZES answers per process across ALL providers
    providers/index.ts               Provider registry (claudeProvider + the hookProviders list the consent gate loops over)
    agentRuntime.ts                  Lifecycle core: timers, scanners, HookEventHandler, SessionRouter, DismissalTracker
    agentStateStore.ts               EventEmitter-backed single source of truth (typed mutations + events)
    sessionRouter.ts                 session_id → agent_id mapping, event buffering, pending external sessions
    dismissalTracker.ts              Unified dismissal state (replaces four legacy globals)
    hookEventHandler.ts              Dispatches normalized AgentEvent into runtime
    httpServer.ts                    Fastify: POST /api/hooks/:providerId, GET /api/health, GET /ws, SPA (standalone)
    clientMessageHandler.ts          Single dispatch point for ClientMessage from webview
    server.ts                        Top-level composition
    cli.ts                           npx pixel-agents entry (npm bin)
    fileStateAdapter.ts              Namespaced ~/.pixel-agents/ persistence
    configPersistence.ts             { vscode, standalone, externalAssetDirectories, hooksConsent: {providerId: granted|declined}, hooksEnabled: {providerId: boolean} }
    layoutPersistence.ts             ~/.pixel-agents/layout.json with atomic tmp+rename
    fileWatcher.ts                   Hybrid fs.watch + 500ms polling, JSONL line buffering, /clear detection
    transcriptParser.ts              JSONL parsing for heuristic / file-fallback mode
    timerManager.ts                  Waiting / permission timers
    assetLoader.ts                   PNG → SpriteData via pngjs
    teamUtils.ts                     isInlineTeammateOf, getInlineTeammates, hasInlineTeammates
    types.ts                         ServerAgentState
    constants.ts                     All timing/scanning constants
  __tests__/                         28 Vitest files
  manual-hook-events.http            Manual hook testing helper (REST-Client format)

adapters/vscode/                     VS Code surface — composes core + server
  extension.ts                       activate() / deactivate()
  PixelAgentsViewProvider.ts         WebviewViewProvider, thin bridge to AgentRuntime
  agentManager.ts                    Terminal lifecycle (claude --session-id <uuid>), restore, persist
  vscodeTerminalAdapter.ts           TerminalAdapter implementation
  uninstall.ts                       vscode:uninstall hook — removes hook entries + factory-resets hooks config after extension removal
  migrateVsCodeState.ts              One-time legacy state migration (verify-before-clear)
  constants.ts                       VS Code IDs, command names, key names

webview-ui/                          React 19 board UI (depends only on core/)
  src/
    transport/
      index.ts                       createTransport() — single runtime branching point
      postMessageTransport.ts        VS Code mode (acquireVsCodeApi)
      webSocketTransport.ts          Standalone mode (exponential backoff, send queue)
      types.ts                       Re-exports MessageTransport from core
    runtime.ts                       isBrowserRuntime detection
    main.tsx                         React entry (StrictMode + createRoot)
    App.tsx                          Composition root: CompanyClient + BoardShell + ConnectionIndicator
    constants.ts                     xterm theme and terminal sizes
    components/                      ConnectionIndicator.tsx, ui/Button.tsx
    company/
      companyClient.ts               The one place company messages are sent and received
      useCompanyTransport.ts         The app's ONE transport subscription; company messages → client
      companyState.ts                Pure reducer for snapshots, changes, streams, terminals
      boardView.ts                   Tasks → seven lanes + flow counts + wait reasons
      roleProfiles.ts                Role labels, role colours, role → model edits
      components/
        BoardShell.tsx               Top bar, attention bar, sidebar, lanes, detail drawer, palette, shortcuts sheet
        CompanyBoard.tsx             The seven lanes and task cards
        CardDetail.tsx               Right pane: contract, question, sessions, files, or the selection
        DetailDrawer.tsx             Board subject drawer; a session opens SessionBody (Terminal, Hoạt động, Việc, Chi tiết)

e2e/                                 Playwright suite
  playwright.config.ts
  global-setup.ts
  fixtures/
    company-host.ts                  Real Company owner process for the board spec
    mock-omp-company.cjs             Scripted OMP that plans, asks, writes and verifies
    mock-claude, mock-claude.cmd     Legacy Claude mock (still used by server/__tests__/mockClaudeRunner)
    mock-claude-runner.cjs           Legacy Claude scenario runner
  helpers/
    company.ts                       startCompanySmokeHost()
  tests/
    standalone/                      company.spec.ts
  README.md                          Auto-generated test inventory (regen via npm run e2e:inventory)

scripts/
  generate-messages.ts               AsyncAPI → core/src/messages.ts via Modelina (with CI drift check)
  run-e2e.mjs                        Playwright wrapper (run-id namespacing, video attach flags)
  generate-e2e-inventory.mjs         Splices test list into e2e/README.md (CI drift check)
  build-allure-report.mjs            Combine e2e+server+webview Allure results
  assemble-vercel-output.mjs         Stage /reports/allure/ for Vercel deploy
  asset-manager.html                 Unified furniture editor (positions + metadata)
  jsonl-viewer.html                  Standalone JSONL transcript inspector
  wall-tile-editor.html              Wall sprite editor

core/                                npm workspace (no separate package; root manages)
server/                              npm workspace
webview-ui/                          npm workspace
```

## Distribution

Two artifacts from one source tree:

- **VS Code extension** (`.vsix`) — `pablodelucca.pixel-agents` on VS Code Marketplace and Open VSX. Bundles VS Code adapter + webview SPA + assets + hook scripts.
- **npm package** (`pixel-agents`) — `npx pixel-agents [--port 3100]` runs the Fastify server and serves the SPA on the same port. Bundles CLI + webview SPA + assets + hook scripts + `core/asyncapi.yaml` (so third-party clients can regenerate from it).

`package.json:files` allowlist controls the npm tarball: `dist/cli.js{,.map}`, `dist/webview/`, `dist/assets/`, `dist/hooks/`, `core/asyncapi.yaml`, `icon.png`. `dist/extension.js` is intentionally excluded since the VS Code entry ships through the `.vsix`.

## Communication Flow

Hub-and-spoke. The server is the single aggregation point for all agent activity, regardless of source.

```
Hook scripts ─POST /api/hooks/:providerId─┐
                                          ├─→ HookProvider.normalizeHookEvent()
JSONL transcripts ─FileWatcher─→ TranscriptParser ┤
                                                   ↓
                                              AgentEvent (canonical)
                                                   ↓
                                              AgentRuntime (dispatch on .kind)
                                                   ↓
                                           AgentStateStore (mutate)
                                                   ↓
                                              StoreEvents → broadcast
                                                   ↓
                          PostMessageTransport ──┤├── WebSocketTransport
                                 (VS Code)      (standalone browser)
```

The VS Code adapter wires `PostMessageTransport` against `acquireVsCodeApi()`. The standalone CLI exposes the same protocol over WebSocket at `/ws` with the webview SPA served from the same Fastify instance. **The protocol shape is identical; only the wire differs.**

Adding a new CLI integration is one subdirectory under `server/src/providers/hook/<id>/`: provider, optional `TeamProvider`, installer, hook scripts. Zero changes to the runtime, the UI, or any existing provider.

## AsyncAPI Protocol Contract

`core/asyncapi.yaml` is the contract. Pinned to **3.0.0** because `@asyncapi/modelina@5.10.1` declares `supportedVersions: ['3.0.0']` only; bumping to 3.1.0 produces `export type Root = any`. Revisit when Modelina ships 3.1.0 support.

- **39 ServerMessage variants** (server → client): agent lifecycle, agent activity, sub-agent activity, team + context usage, assets, access (`officeAccess` — sent first on `webviewReady`; `readOnly` hides every control a read-only office would only have refused), settings (`bypassPermissionsUpdated` — the skip-permissions posture, broadcast to every office on change because every launch reads it) + directories (`directoriesLoaded`, `directorySaved` — a save's ack to its sender, carrying the entry as stored, whose name keys the Area mapping; `directoryRejected`, `directorySuggestions`), terminal, diagnostics.
- **27 ClientMessage variants** (client → server): lifecycle (`webviewReady`, `launchAgent`, `focusAgent`, `closeAgent`), layout (`saveAgentSeats`, `saveLayout`, `exportLayout`, `importLayout`), settings (`setSoundEnabled`, `setHooksEnabled`, `setWatchAllSessions`, `setAlwaysShowLabels`, `setHooksInfoShown`, `setLastSeenVersion`, `setBypassPermissions`, `setShowHostDirectories` — whether the host's own Directories are listed, off by default; only the list is gated, launches still name agents after them), directories (`saveDirectory`, `removeDirectory`, `requestDirectorySuggestions`), terminal, discovery + assets, diagnostics.

Both unions use `oneOf` with `discriminator: type`. Every concrete message sets `additionalProperties: false`.

`core/src/messages.ts` is generated by `scripts/generate-messages.ts` invoking `@asyncapi/modelina` with custom constraints (`propertyKey` preserves `type`/`status` field names; `constant` inlines `const` literals). The file has an auto-generation banner. **CI runs `asyncapi:generate` then `git diff --exit-code core/src/messages.ts` — any non-empty diff fails the build.**

## Transport Abstraction

```typescript
export interface MessageTransport {
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: ServerMessage) => void): () => void;
  readonly ready: Promise<void>;
  readonly state: TransportState;
  onStateChange(handler: (state: TransportState) => void): () => void;
  dispose(): void;
}
export type TransportState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
```

`PostMessageTransport` reports `connected` for its entire lifetime. `WebSocketTransport` reconnects with exponential backoff (250 ms, 500 ms, 1 s, 2 s, 4 s, capped) and queues sends while disconnected.

`createTransport()` in `webview-ui/src/transport/index.ts` is the **only branching point** in the UI codebase. Everything downstream uses the `MessageTransport` interface and never knows which transport is active.

## Provider Abstraction

`HookProvider` (`core/src/provider.ts`) is the integration boundary. Today only Claude Code is implemented; the Claude provider supports every transcript/hook format up to **Claude Code v2.1.220** (current as of 2026-07-30 — Task-era `agent_progress` records, explicit and implicit teams, background-by-default Agent spawns, sidecar-backed background agents). Newer CLI releases may add formats that need provider updates. The interface:

- **Required**: `normalizeHookEvent(raw)` → `{ sessionId, event: AgentEvent } | null`; `installHooks` / `uninstallHooks` / `areHooksInstalled`; `formatToolStatus`; `permissionExemptTools`, `subagentToolNames`, `readingTools` sets.
- **Optional file fallback**: `getSessionDirs(workspace)`, `getAllSessionRoots()`, `sessionFilePattern`, `parseTranscriptLine(line)`, `buildLaunchCommand(sessionId, cwd, opts)`. Used when hooks aren't installed.
- **Optional team extension**: `team?: TeamProvider` for Lead + Teammates support.

`AgentEvent.kind` values: `toolStart`, `toolEnd`, `turnEnd`, `subagentStart`, `subagentEnd`, `subagentTurnEnd`, `progress`, `permissionRequest`, `sessionStart`, `sessionEnd`. The runtime dispatches on `kind`, never on CLI-specific tool names.

### TeamProvider (Lead + Teammates)

Optional extension for CLIs that support team workflows (Claude Agent Teams today). Semantic queries (`discoverTeammates`, `getTeamMembers`, `getTeamMetadataForSession`, `extractTeammateNameFromEvent`, `isTeammateSpawnCall`) — providers choose their own storage strategy.

Four teammate modes:

| Mode                            | Trigger                                          | Detection                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic subagent (teams OFF)      | `Task(...)` or `Agent(run_in_background: false)` | `subagentStart` with team gate not matched, or JSONL `agent_progress`                                                                                                                                                                                                                                                                                                                   |
| Inline teammate (teams ON)      | `Agent(run_in_background: true)` in-process      | `onTeammateDetected` → `discoverTeammates(projectDir, leadSessionId)`                                                                                                                                                                                                                                                                                                                   |
| Session teammate (teams + tmux) | `Agent(run_in_background: true)` in tmux pane    | Own session, own hooks, routes through normal flow                                                                                                                                                                                                                                                                                                                                      |
| Implicit-team agent (Claude 5)  | `Agent(...)` — background by default, NO flag    | Lead-side: spawn tool_result `agent_id: <name>@<team>` → `extractTeammateSpawnFromToolResult` sets lead `teamName`; teammate = own top-level UUID session tagged `teamName`/`agentName` on every record, discovered by `discoverTeammates(projectDir, leadSessionId, teamName)` and fast-attached in `onExternalSessionDetected` (bypasses the Watch All gate when the lead is tracked) |

Newer harnesses (Claude 5) never tag the LEAD's records with team metadata and never write `agent_progress`/`queue-operation` records for these spawns — the spawn tool_result and the teammate's own session (own JSONL, own hooks) are the only signals. The implicit team writes `~/.claude/teams/session-<8hex>/config.json` (its `leadSessionId` matches no transcript on disk — don't link by it). Own-session teammates are registered with the SessionRouter (`setTeammateRegisterCallback`) so their hooks route directly to them.

**Team generations on resume (last-wins latch)**: every CLI run of a session mints a FRESH implicit team, so a resumed lead's transcript carries spawn tool_results from several `session-<8hex>` generations. A tag-less lead re-latches to the newest spawn's team (`setTeamSwitchCallback` removes the defunct team's teammates); tag-derived identity (`teamNameFromTags`, set by the record-tags branch) is authoritative and never overwritten by spawn results. `linkTeammates` never badges a named teammate as LEAD — if only teammates are tracked, linking waits until the real lead is detected (prevents a phantom LEAD character when a teammate session is adopted before/without its lead). Restore drops `isTeamLead` from persisted agents that carry an `agentName`.

**Background spawns without a CLI team (sidecar-backed)**: `Agent(...)` spawns that never register a team take the async path — result "Async agent launched successfully. agentId: \<hex>" (no team anywhere), transcript + sidecar under `<projectDir>/<leadSessionId>/subagents/` (sidecar carries `agentType`/`description`/`toolUseId`, plus `name` when the spawn was named), completion via `queue-operation`. `scanForBackgroundAgentFiles` classifies them by the sidecar `name` — the domain model's sole Sub-agent vs Teammate distinction (see CONTEXT.md):

- **Named → Teammate**: its own seated character, `agentName` from the sidecar `name`; the spawner gets `isTeamLead` + an `agentTeamInfo` broadcast (derived team — NO `teamName`, so config polling stays away) and the transient Subtask is ghost-killed via `subagentClear`. The child has `leadAgentId` + `spawnToolUseId`; it's removed on the completion queue-operation or lead sessionEnd (`removeTeammate` must NOT unregister its session — it shares the lead's).
- **Unnamed → Sub-agent**: the Subtask sub-character stays; the spawn's transcript is watched in a **shadow `AgentStateStore`** (`server/src/subagentWatch.ts`, owned by `AgentRuntime`, ids from 1 000 000 up) whose broadcasts are translated onto the main store as `subagentToolStart/Done/Permission` keyed `(leadId, spawnToolUseId)` — live activity on the sub-character, no protocol change. `agentToolsClear` on the shadow agent synthesizes `subagentToolDone` for still-live tools so the sub idles between turns. Never persisted, never announced.

The gate for both: the sidecar `toolUseId` must match a LIVE entry in the lead's `backgroundAgentToolIds` (anti-spurious; no teamName involved). `scanForTeammateFiles` skips sidecars carrying a live `toolUseId` so it can't race the classification. The lead's `backgroundAgentToolIds` are persisted (children never are — they're derived state the 1 s scan re-materializes after a reload; restore skips stale entries with `leadAgentId` but no `teamName`). The turn-end background-tool re-sends (transcriptParser, hookEventHandler, timerManager's `clearAgentActivity`) must include `toolName` + `runInBackground` (or the webview can't recreate the Subtask after `agentToolsClear`) and must skip tools whose spawn became a teammate character (`hasPromotedBackgroundAgent`, or a ghost Subtask appears next to it).

Teammate dismissal is driven by team config polling (`getTeamMembers(teamName)` is authoritative; members with `isActive: false` are treated as departed), by the teammate's own `sessionEnd` (own-session teammates), and by `sessionEnd` on the lead.

**Subtle gate (the one that bit us recently)**: in `webview-ui/src/hooks/useExtensionMessages.ts`, `agentToolStart` with `runInBackground=true` only creates a Subtask sub-character when the **parent has no `teamName`**. With a team, `onTeammateDetected` creates the teammate instead (and the gate prevents a ghost sub-agent). Without a team, the teammate path never fires and the basic Subtask sub-character is the only visible representation. The gate's blind spot — a TEAMED lead's unnamed background spawn — is covered by `subagentToolStart` creating the sub-character lazily when it's missing (`addSubagent` is idempotent); the same lazy path recreates subs after a panel reload.

## Server Runtime

`AgentRuntime` (`server/src/agentRuntime.ts`) is the shared lifecycle core. Both surfaces (`adapters/vscode/PixelAgentsViewProvider.ts` and `server/src/cli.ts`) compose the same runtime; only the `StateAdapter` namespace, `MessageTransport`, and `TerminalAdapter` differ.

```typescript
export class AgentRuntime {
  constructor(opts: {
    store: AgentStateStore;
    providerRegistry: ProviderRegistry;
    layoutPersistence: LayoutPersistence;
    assetCache: AssetCache;
    config: Pick<AdapterSettings, 'hooksEnabled' | 'watchAllSessions'>;
    terminalAdapter?: TerminalAdapter;
    callbacks: RuntimeLifecycleCallbacks;
  });
  registerAgent / unregisterAgent / removeAgent / removeTeammate / removeTeammates
  restoreExternalAgents / handleHookEvent
  startProjectScan / startExternalScanning / startStaleCheck
  dispose();
}
```

Owns timer Maps (waiting, permission, text-idle, stale), scanners (project-dir 1 s, external 3 s, stale 30 s), `HookEventHandler`, `SessionRouter`, `DismissalTracker`. Scanners are skipped entirely while hooks are flowing (`hookDelivered` is set on every agent). `RuntimeLifecycleCallbacks` is the only seam between runtime and host.

### AgentStateStore

EventEmitter-backed container in `server/src/agentStateStore.ts`. Typed mutations, typed events (`agentAdded`, `agentRemoved`, `agentUpdated`, `broadcast`). The broadcast layer subscribes once at boot and translates `StoreEvents` into `ServerMessage` over the active transport. **No module under `server/` calls a transport method directly.**

### SessionRouter and DismissalTracker

Two extracted classes that replaced ad-hoc module state. `SessionRouter` owns `session_id → agent_id` mapping, pre-registration event buffering, and pending external sessions. `DismissalTracker` unifies four legacy globals (`dismissedJsonlFiles`, `clearDismissedFiles`, `seededMtimes`, `pendingClearFiles`) into one class with typed reasons.

### HTTP + WebSocket Server

Fastify v5 with `@fastify/cors`, `@fastify/websocket`, and (in standalone) `@fastify/static`:

| Method | Path                     | Purpose                                 |
| ------ | ------------------------ | --------------------------------------- |
| POST   | `/api/hooks/:providerId` | Bearer-authenticated hook event ingress |
| GET    | `/api/health`            | Liveness: `{ ok, version, port, pid }`  |
| GET    | `/ws`                    | Bidirectional protocol channel          |
| GET    | `/*` (standalone only)   | Webview SPA via `@fastify/static`       |

`/ws` is gated in **two tiers**, because messages over this socket launch shells, grant durable machine-wide hook consent, and rewrite persisted state.

1. **Connection** (`isAllowedWebSocketOrigin`): embedded requires the Bearer token; standalone requires a same-origin handshake. A missing Origin still connects (non-browser clients send none). This tier is weak by design — a DNS-rebound page sends `Origin` and `Host` as the same attacker-chosen name and IS accepted (`httpServerWs.test.ts` pins that).
2. **Privileged messages** (`standaloneTokenValid`, `ClientMessageContext.privileged`): proved by an out-of-band secret — embedded via its Bearer token, standalone via the server token in the `/ws` `?token=` query, which the CLI prints in the local URL and the SPA forwards (`webview-ui/src/transport/index.ts`). **Never a network position**: peer address, `Host` and `Origin` all ride the channel a proxy speaks, so a LAN-bound forwarder piping bytes to 127.0.0.1 satisfies all three. The token is a replayable bearer capability, not evidence of locality — it reaches browser history (Fastify's request log redacts it, `wsAuth.redactTokenQuery`), so the printed URL is documented to the user as a secret. Standalone persists it in `~/.pixel-agents/standalone-token` (0600) so a bookmarked URL survives restarts; `--rotate-token` replaces it (revoking every device at once; refused while another standalone server is running, since it would keep honouring the old one). The terminal socket (`/terminal/:agentId`) carries it the same way and both sockets decide privilege with ONE predicate, `wsAuth.standaloneHandshakeVerdict`: the token AND an allowed `Host` — loopback, a specific `--host`, or a name passed with `--allowed-host` (anti-DNS-rebinding defence in depth). The allowlist is explicit rather than "loopback when loopback-bound" because a reverse proxy (Tailscale Serve) forwards to 127.0.0.1 under its public name; a loopback-only rule forced `--host 0.0.0.0`, exposing the port and the token in transit to the LAN. **An unprivileged client is read-only**: it may load and watch the office (`webviewReady`) and NOTHING else — every other message is refused by one gate at the top of `handleClientMessage` (`refuseReadOnly`), so a new message type is privileged by default. Where the UI updates optimistically (settings toggles, hooks toggle, asset directories, area mappings), the refused client is re-sent the real state. A tokened connection under an unlisted Host is read-only too and logs the `--allowed-host` hint. A second standalone launch reuses a running server only when its access matches (`ServerConfig.standalone`: terminal on/off, bind host, allowed hosts) — otherwise `--no-terminal` would silently attach to a server with a shell.

The **hooks preference is persisted only after the install/uninstall settled and the on-disk result agrees** — writing it first strands the user when an uninstall fails: entries still firing, but a persisted hooks-off makes the next startup skip the consent/install path entirely.

Server discovery written to `~/.pixel-agents/server.json` with `{ port, pid, authToken }`. Multi-window safe: a second server detects an existing `server.json` and reuses or replaces it based on PID liveness.

### ClientMessageHandler

Single dispatch point for `ClientMessage`. Each variant calls into `AgentRuntime`, `AgentStateStore`, `LayoutPersistence`, or `FileStateAdapter`, or delegates to host-specific callbacks (`onLaunchAgent`, `onOpenSessionsFolder`, `onExportLayout`, `onImportLayout`, `onSetHooksEnabled`). Both surfaces wire the same handler.

### ServerAgentState (server/src/types.ts)

Per-agent runtime data: provider reference, session key, transcript-fallback fields (`jsonlFile`, `fileOffset`, `lineBuffer`), tool state Maps and Sets, team fields (`teamName`, `agentName`, `isTeamLead`, `leadAgentId`, `teamUsesTmux`), context usage (`contextTokens`, `maxContextTokens`, `sawMainChainUsage`), and the **`hookDelivered`** flag that suppresses heuristic timers when hooks are flowing.

## Persistence

```
~/.pixel-agents/
  config.json              { vscode, standalone, externalAssetDirectories, hooksConsent, hooksEnabled (both per-provider) }
  vscode-state.json        { agents, seats }
  standalone-state.json    { agents, seats }
  layout.json              OfficeLayout (shared across surfaces)
  server.json              { port, pid, authToken }
  hooks/claude-hook.js     Bundled hook script (CJS, shebang)
```

`FileStateAdapter({ namespace })` backs both runtimes. Per-namespace settings: `soundEnabled`, `lastSeenVersion`, `alwaysShowLabels`, `watchAllSessions`, `hooksInfoShown` (the hooks preference is per-provider and machine-global, at the config top level). Running both surfaces in parallel never clobbers either.

`migrateVsCodeState` (VS Code adapter only) walks each known legacy key once with **verify-before-clear** semantics: write to file, read back, only then clear the legacy key. While anything remains unmigrated, activation shows a non-blocking warning.

Layout writes are atomic via tmp + rename. Cross-window watching is hybrid (`fs.watch` + 2 s polling). `markOwnWrite()` prevents the watcher from re-reading our own write.

## Agent Status Tracking

JSONL transcripts at `~/.claude/projects/<project-hash>/<session-id>.jsonl`. Project hash = workspace path with `:`/`\`/`/` → `-`.

**JSONL record types**: `assistant` (tool_use or thinking), `user` (tool_result or text prompt), `system` with `subtype: "turn_duration"` (reliable turn-end signal), `progress` with `data.type`: `agent_progress` (sub-agent tool_use/tool_result, non-exempt tools trigger permission timers), `bash_progress` (Bash output — restarts permission timer), `mcp_progress` (MCP tool — same timer restart). Also observed but not tracked: `file-history-snapshot`, `queue-operation`.

**File watching**: 500 ms polling with partial-line buffering for mid-write reads. Tool-done messages delayed 300 ms to prevent React batching from hiding brief active states.

### Dual-mode detection

| Mode                     | Source                                                 | Detection                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hooks** (preferred)    | Claude Code Hooks API → HTTP POST → `HookEventHandler` | Instant, reliable. Installed events are `CLAUDE_HOOK_EVENTS`. `UserPromptSubmit`/`TaskCreated` are deliberately NOT installed — they normalize to null, so installing them only forwarded prompt text to be dropped; `normalizeHookEvent` still tolerates them for stale installs |
| **Heuristic** (fallback) | Polling JSONL files                                    | Per-agent 500 ms JSONL polling for /clear detection; 1 s main scanner for terminal adoption; 3 s external scanner; 30 s stale check. Content-based /clear detection (`/clear</command-name>` in first 8 KB)                                                                       |

The `hookDelivered` flag (per agent) and `hooksEnabled` (global) gate timer logic. JSONL polling always runs in both modes for tool content (status text, animations); only permission (7 s) and text-idle (5 s) timers are suppressed by `hookDelivered`.

### Sub-agent permission detection (heuristic)

When a sub-agent runs a non-exempt tool, `startPermissionTimer` fires on the parent agent. If `PERMISSION_TIMER_DELAY_MS` (7 s) elapses with no data, permission bubbles appear on both parent and sub-agent characters via `agentToolPermission` + `subagentToolPermission` broadcasts.

`activeSubagentToolNames: Map<parentToolId, Map<subToolId, toolName>>` tracks which sub-tools are active for the exempt check. Cleared when data resumes, Task completes, or `turn_duration` arrives.

### Context usage (server/src/contextUsage.ts)

Every agent's context gauge. Fed from `message.usage` on assistant records by `processTranscriptLine`, broadcast as `agentContextUsage` and rendered by `ToolOverlay`.

- **Snapshot, not a total.** Context = the newest turn's `input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens`. Summing turns measures spend, not occupancy, and misses the cached tokens that ARE the context (`input_tokens` is single digits once caching kicks in). Falls on compaction and `/clear` for free.
- **All-zero usage means "no news"** — synthetic records (API errors, interrupts) report zeros and must not blank the gauge.
- **Sidechain rule**: a lead's sidechain records are its sub-agents' turns and must not move its gauge; a teammate's own transcript is sidechain top to bottom and would otherwise never report. Positional latch (`sawMainChainUsage`): once a file produces a main-chain turn, later sidechain records belong to someone else.
- **The window comes from the provider**, not from the runtime: `HookProvider.contextWindowForModel(model)` (Claude: 1M for the current line, 200k for Haiku and the older models, `undefined` for ids it can't place). Transcripts state usage but never the limit, and guessing 200k for a 1M model reads five times too full. `widenContextWindow` is the backstop for unrecognized models and unknown-larger windows — it only ever widens, since a context that doesn't fit disproves the assumption while a shrinking one proves nothing.
- **`seedContextUsage` runs once per agent in `startFileWatching`** — the single seam every watched agent passes through. Agents adopted or restored mid-session start at end-of-file, so without a tail read they'd have no gauge until their next turn.
- Sub-agents get no gauge: no session of their own, and the shadow store never forwards `agentContextUsage`.

## Board UI

The webview is one full-screen board (`webview-ui/src/company/components/BoardShell.tsx`). Top to bottom: `BoardTopBar`, one row: the title, the workspace switcher (its menu lists the folders and ends with "Mở thư mục…"), `ChatNewButton` ("+ Phiên mới"; a bare plus on a phone), one `StatusPill` whose summary is one word (Sẵn sàng, Cần chú ý, Đang kết nối…, Mất kết nối) and whose popover lists the connection, revision, model catalog, the omp runner and provider quota windows, the palette search, and a "⋯" menu with Đàn agent, Vai trò & model, Tệp, Cây git and Phím tắt, each labelled and showing its shortcut; a refused folder or chat command shows in a `FloatingNotice` under the control that caused it. Then `AttentionBar` (Contract awaiting approval, pending questions), then a row of `AgentSidebar` (each folder's sessions as one list in role order, each row edged in its role's colour, parked sessions under one "Tạm trữ" toggle, one-line activity summary and progress per session, herdr agents grouped by repo/branch; the gear beside its heading and the "⋯" menu open the "Vai trò & model" dialog (`RolesDialog.tsx`), which lists each role's host `modelRoles` key from `COMPANY_HOST_ROLE_BY_ROLE`, its model and thinking level, and a "Đổi" control that opens `ModelPicker` in place) — or `AgentRail` (56px, one badge per session) when collapsed with Ctrl+B —, the seven lanes (`CompanyBoard`) and the `DetailDrawer` (a task or session opens its four tabs: **Terminal**, **Hoạt động**, **Việc**, **Chi tiết**; screen, keys and prompt for a herdr agent; Contract, question, files), and the always-mounted `PromptComposer`. An empty lane folds to a 40px strip until its reader opens it (`laneLayout.ts`); scroll areas draw no scrollbar and fade an edge that has more content beyond it (`scrollFades.ts`).

**Server owns status.** Lanes are `planned / ready / running / needs_input / review / done / failed`, mapped from task status in `boardView.ts`. Cards are buttons, never draggable; clicking selects. Each stalled card states why (dependency, awaiting answer, paused, queued behind full running lane). A card's left edge carries its session's role colour (`ROLE_EDGE_CLASS`).

**One selection.** `CompanySelection` (task + session + drawer tab) is shared by the board and the drawer. An explicitly opened subject (`DrawerSubject`: Contract, question, herdr agent, files) takes the drawer until closed; otherwise it shows the selected task or session (`drawerSubjectFor`). Session logs come from the server's durable `companySessionLog`, replayed when a session is opened.

**One subscription.** `useCompanyTransport` is the app's only `transport.onMessage`; it hands company messages to `CompanyClient` and drops the legacy office/Claude messages the server still sends. A connect (first or reconnect) asks for a fresh snapshot.

**Manual work items.** A work item is one piece of work given to one agent: a herdr pane, an omp session, or a new chat. Each folder's items and role notes travel in one `companyWorkItems` message and persist in `work-items.json` in the folder's namespace. The server owns the queue and the status: a free agent takes its highest-priority ready queued item (`priority` P0–P3, default P2; ties go to the older item), an item holds its agent while `running` or `needs_input`, and it moves to `review` when the agent stops (the last screen lines become its result). An item may wait on up to 10 others (`dependsOn`; loops are refused by `core/src/workItemGraph.ts`). It is sent only once every wait is done; a failed or cancelled wait leaves it queued with the reason, and the server states each queued item's `blocker` in Vietnamese. Dispatch skips a blocked item rather than waiting behind it. `acceptance` is sent after the text as `Xong khi: …`; the item's own text stays unchanged. Lanes are `queued` (ready), `running`, `needs_input`, `review`, `done`, `failed`; the board only asks (`companyWorkItem*`, `companyAgentRoleSet`) and never decides status. `WorkItemService.createWorkItems(drafts, { squadRunId })` (`server/src/company/workItems/workItemService.ts`) is the entry point the squad leader uses.

**Squad leader.** "Đội" in the composer's send menu (`Ctrl+Alt+Enter`, `shortcuts.ts` `composer.squad`; folder-level, works with nothing selected) sends the request to the folder's team. The server runs one leader turn with the Director model: `omp -p --no-session --no-tools --no-extensions --no-skills --no-rules --no-title --mode json`, prompt in a 0600 temp file passed as `@path`, no shell, 240 s timeout (`server/src/company/squad/squadRunner.ts`). The reply must be one JSON object `{assignments:[{assignee,text,reason?}],note,done}`; `parseLeaderReply` (`squadModel.ts`) refuses anything else with a Vietnamese error, and nothing is assigned. Limits: 8 rows per proposal, 10 turns per run (then `stopped`). The proposal shows in Kế hoạch as "Đội trưởng đề xuất": Duyệt creates its rows as work items with `squadRunId` = the proposal id (idempotent), Bỏ dismisses. A reviewed item starts the next turn with its clipped result. Runs persist in `squad-runs.json` in the folder's namespace (`squadStore.ts`); a turn in flight at shutdown is marked failed with "Thử lại". Wire: private `companySquad` (`egress.ts`); commands `companySquadRequest|Approve|Dismiss|Retry` (`core/asyncapi.yaml`). Items of a run carry a "Đội" chip; the run card shows "Đội: n/m xong".

**Squad leader fields.** The leader's rows may carry `priority` (0–3, default 2), `acceptance` (up to 1000 characters, sent after the text as `Xong khi: …`) and `dependsOn` (`#n` of open items the leader was shown). `parseLeaderReply` refuses the whole reply on an out-of-range priority, an over-long acceptance, or a wait on anything other than an open item in the context. `companySquadRequest` takes `text` or `fromWorkItemId` (a manual review item behind "Hỏi đội trưởng bước tiếp"), never both. A run started from an item keeps it as `fromWorkItemId` on the stored run: while that run is open (not done, dismissed or stopped) a second press answers with the same `squadRunId` and starts nothing new; a closed run lets the item start a new one.

An unfinished run can be cancelled with `companySquadCancel`: only that run's leader turn is aborted, pending proposals are dismissed, and work items from approved proposals continue independently. A finished run can be removed with `companySquadRemove`; it is removed from that folder's squad file and snapshot without deleting its work items. Both commands require a writable office.

**Squad scheduler (G1).** A work item may name a `repo` (a canonical path under the folder, from `listFolderRepos`), a `role` (a CompanyRole: used when a session opens and as a matching hint), up to 8 lowercase code `areas` (locks), and an `agent` (an omp subagent from `loadAgentCatalog`). `assignee: 'auto'` is resolved at dispatch by the pure `server/src/company/workItems/workItemScheduler.ts` `decideStart`: an idle member serving the repo (a role note first, then a squad-opened session with the same role, then the rest), or, while `maxSquadSessions` and `maxParallel` allow and free RAM is at least `minFreeRamGb`, a new session opened in the repo with `role`. Explicit assignees face the same caps and area locks. A member busy with work the board did not send (a herdr pane working on its own, an omp session mid-turn) locks its checkout for editing items; read-only agents (`scout`, `reviewer`, `security-reviewer`, or any agent without mutating tools) take no locks. A new session for an editing item runs in its own worktree (`server/src/company/workItems/squadWorktree.ts`: `git-wt switch -c squad-<id> --base origin/main --no-cd -y` when `git-wt` is on PATH, else `git fetch origin` and `git worktree add`, argv only, no shell); if creation fails the item waits with the reason and opens no session. A non-`task` agent never goes to a herdr pane on `auto`: `auto` prefers omp sessions in the repo, and the dispatch asks the session to call its `task` tool with that agent. A full pool waits with a `capacity` blocker and never fails. Every dispatched prompt carries the safe-work block from `dispatchPrompt.ts`. Folder settings (`SquadSettings`: `maxParallel` 1–8, `maxSquadSessions` 0–6, `minFreeRamGb`, `autoJudge`, `autoApproveNext`) persist in `work-items.json` and change through `companySquadSettingsSet`. A session opened with a `cwd` is canonicalised and must lie inside the folder (`resolveFolderCwd`, `folderScope.ts`), else the open is refused; tool authorization uses that cwd. A follower host forwards `cwd`/`role` for `company.chat.new`.

**Squad leader v2 (G2).** A leader row carries `repo` (a folder repo, validated), `role`, `agent` (a catalog name, default `task`), `areas` (at most 8 lowercase strings), `assignee` (default `auto`), plus `text`, `acceptance`, `priority` and `dependsOn`; `parseLeaderReply` refuses unknown values with a Vietnamese error. The leader prompt lists the folder's repos, the agent catalog (read-only marked), and the team with each member's repo, checkout, status, role note and current item, and asks for the full pipeline: `scout` when information is missing, `task` for code changes, `reviewer` after each code-changing row (skipped only for `sonic`), `security-reviewer` for auth, user input, SQL, tokens, file paths or shell, and an acceptance on every row. `planCompleteness` (`core/src/squadCompleteness.ts`) turns the rows into warnings stored on the proposal and re-checked live in the webview; warnings never block Duyệt, and a herdr assignee with a non-`task` agent shows "Agent herdr: subagent chỉ là gợi ý". `SquadService.onItemSettled(item)` (`server/src/company/squad/squadService.ts`) is the re-trigger for the next leader turn: an item that reaches review (when `autoJudge` is off), fails, or finishes with the plan done ("Đội đã xong"); the work-items port subscription feeds it. With `autoApproveNext` on, a next-step proposal with no warnings is approved automatically and recorded in history (default off).

**Squad judge, conflicts and parking (G3).** With `autoJudge` on, a review item gets one judge turn on the judge role model (`server/src/company/workItems/judgeModel.ts`, reply `{"verdict","reason","followUp"}`). A pass with no open conflict marks the item done. `fail` sends its follow-up, at most 2 judge follow-ups, then `needs_input` with `Giám khảo chưa thấy đạt: …`. `need_evidence` asks for evidence once. A judge error leaves the item in review as `Giám khảo lỗi` with `Chấm lại` (`companyWorkItemJudge`). `conflictModel.ts` takes the ledger's `overlapScans()` for an item's repo and marks overlaps with another open squad checkout or the main checkout; the check runs every 2 min only while the ledger is watched (`boardWatching()`). A conflict blocks a pass and reaches the leader as `conflicts` on the review. Squad sessions idle 15 min with no queued, running or waiting item are parked by the 60 s maintenance tick, and a parked squad session is woken for the same repo, role and worktree. `companyWorkItemCleanWorktree` removes a done item's clean worktree (`git-wt remove <branch> -y`, or `git worktree remove` without `--force`); it refuses a dirty tree and never runs automatically.

**Per-role squad CLI settings.** `engineLeader`, `engineJudge` and `engineWorker` each select `omp`, `claude` or `agy`; `agy` uses its configured default model and permissions. Claude leader/judge turns run `claude -p --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --disallowedTools 'mcp__*' --no-session-persistence --disable-slash-commands --output-format json --json-schema <schema> --model <claudeModelLeader|claudeModelJudge> --max-turns 2`, prompt on stdin, cwd the folder, argv only (`server/src/company/claudeCode/claudeTurnRunner.ts`). `--bare` is not used because it skips subscription login; `--max-turns 2` lets structured output retry. An auto-assigned worker uses the chosen CLI when available: Claude is capped by `maxClaudeRuns`, agy by `maxAgyRuns`, and either falls back to an omp session when its slot limit is full. A `claude` assignee remains a direct Claude Code run. Claude worker runs use `claude -p --output-format stream-json --verbose --permission-prompts none`; editing uses its worktree, `--permission-mode <claudePermission>`, optional `--allowedTools`, `--max-turns <claudeMaxTurns> --max-budget-usd <claudeMaxBudgetUsd>` and a temporary `--strict-mcp-config --mcp-config <path>` assembled from selected `claudeWorkerMcp` servers. Read-only work uses `--permission-mode plan` with no allowlist. MCP entries are copied verbatim from `~/.claude.json` at run start; entries with `headers` or credential-like env names are excluded, and the temp file is removed when the run ends. Claude runs count toward `maxParallel` and `maxClaudeRuns`; cancelling or failing kills the process tree, and a board restart marks a run interrupted and resumable. `claude auth status` is read for `loggedIn` and `authMethod` only, never credentials or emails.

**UI styling**: Ink + Amber palette scoped to `.company-ui` in `index.css` (office tokens untouched), Inter for UI text, 1px borders and rounded corners on company chrome, matching the board mockup the user reviewed and called OK (`.lavish/plan.html`, section 2); the repo's older 2px pixel style still applies outside `.company-ui`. Status colours: amber working, red needs-you/error, green done, blue tool, grey idle. Card flights use FLIP (`flip.ts`) and stop under `prefers-reduced-motion`. Custom ESLint rules (`eslint-rules/pixel-agents-rules.mjs`) still enforce `no-inline-colors` (hex/rgb/rgba/hsl/hsla literals only in `constants.ts`), `pixel-shadow`, and `pixel-font` (Inter / FS Pixel Sans / `var(--font-ui)` only). All `error`-level.

**Herdr.** `server/src/herdr/herdrLink.ts` talks to the user's herdr server over its socket (`HERDR_SOCKET_PATH`, else `%APPDATA%\herdr\herdr.sock` on Windows): roster from `agent.list` + `workspace.list`, live via `events.subscribe`, git repo/branch per cwd. The board reads screens, prompts, sends the allowed keys and focuses panes; it never answers a blocked agent on its own. Company OMP sessions get no `HERDR_*` env (`ompRunner.ts`).

**Browser reaper.** `server/src/company/browserReaper.ts` stops idle omp headless browsers, which otherwise keep a Chrome (~300 MB) alive for hours after their last page closes. Every 2 minutes it runs `omp ps --all --json` and, for each `omp.browser.headless` daemon that is `ready`, not `persist` and not `detached`, counts the `page` targets on its loopback DevTools `/json/list` (`browserReaperProbes.ts` refuses any host but 127.0.0.1). A browser is stopped with `omp ps stop omp.browser.headless --dir <project>` only after zero pages on every check for 10 minutes. Before each stop request, including the timeout retry, the daemon is read again with `omp ps info omp.browser.headless --dir <project> --json` and its pages counted again: it must still have the tracked `id`, `pid` and `startedAt`, be `ready`, and hold zero pages. Otherwise that reap ends; a page resets its zero-page run, and a replaced daemon is forgotten and gets a fresh grace period. The stop is confirmed on the next listing, retried once on timeout, and given up for another grace period. The window between that last re-read and omp acting on the stop is a few milliseconds; a run that hits it fails once while omp relaunches the browser on its next use. The server sends the privileged board `browserReaperStatus` (`enabled`, `browsers`, `reapedCount`, `freedMb`), shown as the "Trình duyệt ẩn của omp" section of the status pill popover. "Dọn ngay" (`browserReaperReapNow`) stops every zero-page browser at once through the same re-read, so it still never stops one with pages. Off with `--no-browser-reaper` or `PIXEL_AGENTS_BROWSER_REAPER=0`.

**Agent menu and info.** Right-click (or Shift+F10) on a sidebar row, rail badge, task card or herdr agent opens `AgentContextMenu` (`agentMenu.ts` decides the items): info, rename, copy folder/id, open Terminal/Hoạt động/Việc/Chi tiết, and the session controls valid for its status. The drawer's Chi tiết tab shows `AgentInfo`: a live company session answers from inside OMP (`describe` over the bridge: active tools by source, skills, cwd, model), a session without a run falls back to its record and log; a herdr omp agent is read from `pane.process_info` plus the last 4 MB of its transcript (`server/src/herdr/ompTranscript.ts`). MCP server names are inferred from the tools' shared `mcp__<server>_` prefix (`agentInfoView.ts`), since OMP does not report them.

**Prompts like omp.** The composer's Gửi button sends to the selected target; its chevron opens the send menu (`ComposerSendMenu.tsx`, entries and off-reasons in `composerSendMenu.ts`) with "Một agent…", "Đội" and "Công ty". Enter sends `mode:'chat'` to the selected session (or the selected herdr agent's pane); with nothing selected nothing is sent and the composer says to pick an agent or press Phiên mới. A new chat ("+ Phiên mới" or `/new`) is a plain OMP session (role `chat`, `toolsPolicy:'omp'`, user's own tools and approvals, no company tools or briefs, its transcript under omp's own per-folder sessions dir). The Company workflow (Director → Advisor → approval → Worker → QA → Judge) runs only on the send menu's "Công ty" entry / Ctrl+Shift+Enter (`mode:'company'`, routed by `contextRouter.ts`). `/new` clears the current session; `/resume` lists the folder's saved omp sessions (`ompSessionFiles.ts`) and reopens one as a chat session. Session actions: `interrupt` (stop the turn), `kill`, `delete` (removes the session, its omp session file and board log; refused while it holds work), and `companyPromptCancel` withdraws a prompt still being planned. The model catalog comes from `omp models --json` (`ompModelsCatalog.ts`), so no session is started just to read it.

**Folders.** `CompanyWorkspaceRegistry` (`workspaceRegistry.ts`) keeps one Company per folder open in the server. The board has two view modes. `all` (the default) sends every open folder's messages, each tagged with `workspacePath`, and cards, lanes and the rail carry the folder's label and tone. `folder` sends only the active folder's messages, as before. Each socket sets its mode with `companyViewMode`; the server keeps it per socket (`CompanyClientGate`, default `folder`). Command routing: an explicit `workspacePath` first (opened without activation when needed), then the id lookup across open folders, then the active folder. Creation with no folder is refused with `workspace_required`; the client waits with "Đang tải thư mục…" until the folder list arrives. The client keeps the mode and the focus folder (where new work goes) in localStorage under `omp.company.folders`. Every control that asks for a folder (the folder menu's and the palette's "Mở thư mục…", "+ Phiên mới" when no folder is open, the sidebar's "Tạo project" ➕, and "Duyệt…" in a Project's "Thêm thư mục") goes through `webview-ui/src/company/folderPick.ts`, which sends `companyFolderPick`: the server (`server/src/company/folderPicker.ts`) opens Windows' own folder dialog (PowerShell 7's `FolderBrowserDialog`, Windows PowerShell as the fallback; privileged only, one at a time, refused off Windows) and answers with the canonical folder in `workspacePath`, or none on cancel. "Tạo project" sends `projectNodeCreate` with that `path`, so the new Project, named after the folder, holds it at once. `companyFolderName` sets a display name. Display names live in config.json as `companyFolderNames`, keyed by canonical path, next to `recentCompanyWorkspaces`. They show in the switcher, tree, rail, cards and palette; right-click a folder to rename it.
The herdr sidebar, rail, board cards, sleeping groups and Cây git follow the same rule: `folder` mode shows a herdr agent, sleeping pane, or ledger repo or checkout only when the server tagged it with the active folder's canonical `workspacePath` (`company/folderScope.ts`, the deepest open folder holding its cwd), and an untagged item appears only in `all` mode.
Sidebar session rows carry `stoppedAt` (a sleeping pane's sleep, an exited session's end). The server keeps main sessions that exited within a day (newest 20, `withRecentlyEnded` in `projectTree.ts`) as `ended` rows; the tree hides them unless "Làm dở" is on, and "Vừa ngủ / tắt" (`recentlyStoppedSessions`) lists the latest stopped ones. `isUnfinishedNode` marks a stopped session whose last turn was cut off (`interrupted`) or whose todo list has tasks left; a working one never counts.

**Missing folders.** `CompanyWorkspaceRegistry` checks each folder's directory every `COMPANY_WORKSPACE_PRESENCE_CHECK_MS` (5 s) and republishes only when the list changes. Recent folders whose directory is gone are dropped from the list (`recentCompanyWorkspaces` in config.json keeps the display names). An open folder whose directory is gone is listed once with `missing: true`, and the tree says "Thư mục không còn" with "Gỡ khỏi danh sách". `companyFolderForget` takes a folder off the list: it drops the recent entry and, for an open folder, closes it only when no session there is working or waiting (`workspace_busy` otherwise). The palette's "Mở thư mục…" and the folder menu's "Mở thư mục…" row both open Windows' folder dialog through `companyFolderPick`; the only typed-path field is the one in a Project's "Thêm thư mục".

**Terminal previews.** Hovering (or focusing) a sidebar row, rail badge or task card with a session opens one floating preview of its terminal tail after ~350 ms (`terminalPreview.ts` decides open/close: Escape, leave, scroll and a click on the row close it, and the drawer's own subject never gets one); clicking opens the drawer on that terminal. herdr screens are read with ANSI kept and rendered by one SGR→spans renderer (`terminalScreen.ts`, `ScreenView.tsx`) in both places; company sessions with a live run mirror their xterm terminal, others show their log tail. Clicking a command in the Hoạt động tab (Lệnh filter) jumps to it in the terminal (`commandLine.ts`).

**Session insight (read-only).** The bridge extension (`ompBridgeExtension.ts`) pushes OMP's own todo list, plan mode and subagent rows as `k:'insight'` frames, read from `sessionManager.getBranch()`; pushes are throttled to 1 s, with a 2 s refresh that catches edits made in the terminal. `sessionInsight.ts` validates each frame into `CompanySession.insight`. A crash clears it, and the webview shows it only while the OMP process is running (`liveSessionInsight` in `sessionInsightView.ts`). The Việc tab (`SessionInsightTab` in `SessionInsightPanels.tsx`) lists it, and each agent row in the sidebar carries a one-line `SessionProgressLabel`. Approvals and plan review stay in the terminal, and context % is the existing `contextSnapshot` gauge.

**Palette, shortcuts and tab memory.** Ctrl+K opens the command palette (`commandPalette.ts`: pure ranking over sessions, agents, folders and files, plus new chat, sidebar, roles and model, git tree, files, folder and shortcuts actions; rendered by `CommandPalette.tsx`). Shortcuts live in one registry (`shortcuts.ts`, shown by `ShortcutsSheet.tsx`); the board ignores them inside a terminal so readline keys (Ctrl+K, Ctrl+B) reach the shell. A session the reader last left on a tab reopens there when it is not live (`drawerTabPrefs.ts`, session only); a live chat always opens on Terminal, at the widest drawer the board leaves room for until the reader drags it (`rememberedOrChatWidth`). Escape closes the palette, the shortcuts sheet, the roles dialog and the phone sheet, not the drawer.

**Remote access.** The server only binds `127.0.0.1`. `scripts/board-tailscale.ps1 -Port <port> -Token <token>` installs Tailscale if needed and runs `tailscale serve --bg --https=443 http://127.0.0.1:<port>`, which terminates HTTPS inside the user's tailnet and forwards to the loopback port with the `*.ts.net` name as Host. The board must then be started with `--allowed-host <machine>.<tailnet>.ts.net`: a tokened handshake is privileged only when its Host is loopback, the bind host or an `--allowed-host` (`standaloneHandshakeVerdict` in `wsAuth.ts`), so without it the remote page is read-only and company commands answer `forbidden`. The token is persisted (`serverToken.ts`) and changes only with `--rotate-token`. `-Off` removes only the HTTPS:443 Serve mapping. Never expose the tokened URL publicly (Funnel/public tunnels) without an auth layer in front.

**Fleet (cloud machines).** The "Cloud" page shows what every machine (local board plus cloud hosts) has checked out, from one hub (`fleet/hub.mjs`, also shipped as the Botkeep zip). Each machine runs a reporter (`fleet/agent.mjs` on cloud, `fleet/local-agent.mjs` on the board's machine) that signs a JWT with its own key (`fleet/jwt.mjs`, roles `report`, `read`, `command`) and posts its checkouts; the hub keeps state in a 0600 file and never accepts a role the key was not registered for. A light lane scan (`fleet/laneScan.mjs`) lists worktrees without walking the tree. A silent machine is shown as "Im lặng N …" in the warning colour (`machineSilence.ts`), never as an error; a hub that cannot be reached answers `fleetCommandResult failed` instead of an empty fleet. Everything below is opt-in per machine, off by default:
- **Snapshots** (`FLEET_SNAPSHOT=1` on cloud, `"snapshots": true` in the local config): uncommitted work is pushed to `refs/wip/<machine>/…` on the `mine` remote only, never to a branch (`fleet/snapshot.mjs`, `assertWipRef`); refs older than 14 days are pruned from the same namespace.
- **Verdicts**: `fleet/judge.mjs` and the hub's `verdicts` tell, per pair of checkouts on one repo, whether they merge cleanly (`auto`), conflict, or could not be checked (`incomplete`); the board shows them in the Cloud page.
- **Remote commands** (`FLEET_COMMANDS=1`, `"commands": true`): the board queues a verb through `server/src/fleet/commandQueue.ts` (its own key `~/.pixel-agents/fleet-command-key.pem`, created once with mode 0600; the first time it only prints the PUBLIC key to register in the hub's `keys.json` as `board-command`, role `command`). The hub queues per machine (one at a time, 10 min TTL, audit log `<state>.audit.jsonl`); verbs live in `fleet/commandSpec.mjs`; protected branches (main, master, prod, production, staging) are refused. Only `snapshot-push` and `clean-worktree` have executors (`fleet/commands.mjs`); `run-tests` and `staging-sync` answer `refused` until a machine supplies one. Results wait in a local file until the hub confirms them.
- **"Dọn & lên staging"** (`server/src/fleet/cleanupPlan.ts`, `core/src/cleanupRunner.ts`, `CleanupDialog.tsx`): the board plans which checkouts are leftover work (staging) or junk, the user ticks items (nothing starts ticked), and a run does backup → tests → staging → read-back → clean, one branch at a time, stopping at the first failure. It never touches `main` or production and refuses a protected, detached or `local-…` branch and any pair whose verdict is conflict or incomplete.

**Cây git (ledger view).** The ⋯ menu's "Cây git" item (hidden when the office is read-only) replaces the lanes area with two tabs: **Đồ thị nhánh** (per repo, a column of cards: the origin/main trunk first, then one full-width card per checkout, ordered conflict, attention, ok, merged; a vertical trunk line forks into each card; every card names its state in words plus icon and colour (Ổn, Cần chú ý, Xung đột, Đã gộp) and lists its reasons from `ledgerHealth.ts`; conflicts are red dashed runs in the right gutter, labelled per pair; cleanable merged branches are folded behind a "Hiện N nhánh đã gộp" toggle; each card shows who manages it as chips from `ledgerManagers.ts`: ledger sessions and herdr panes, each with a dot and a word, and a "Chú giải" legend explains the marks; herdr panes and ledger sessions stay separate chips because no shared id proves they are the same agent) and **Dòng thời gian** (one swimlane per session grouped by repo, window 15 phút / 1 giờ / 6 giờ / 24 giờ in 60 buckets, colour by tool kind, shared-file connectors). A side column holds the detail panel (conflict hunks, dirty files with diff, session intents with "Nhắn tin") plus read-only notices and pending items. Server code lives in `server/src/ledger/`; the wire types are in `core/asyncapi.yaml` (`ledger*` messages, privileged only).

Data sources, all read-only except the one message command: `~/.omp/agent/activity.db` (tables `sessions`, `events`, `pending`, `notices`) opened with `node:sqlite` `readOnly`; git per repo (`worktree list`, `rev-list --left-right --count origin/main...HEAD`, `status --porcelain -z`, `merge-base --is-ancestor`, `log -1`, and `rev-list --count @{u}..HEAD` per checkout that has an upstream, which feeds `unpushed`, null when unknown), cached 60 s so the 10 s poll never waits on git; `~/.omp/scripts/overlap.py <repo> --json --base origin/main --budget 60` run one scan at a time in the background (repos with at least two checkouts, every 5 min). A `partial` scan shows "chưa quét hết", never "sạch".

**Spam rule** (thresholds in `server/src/ledger/constants.ts`, echoed in `view.spamRule`): a session is flagged when, within its lookback (30 min in the graph's view, the window in the timeline), any 5-minute window holds at least 60 tool calls or the same intent label at least 12 times. Calls are events other than session-start markers.

**Safety rules.** `ledgerSendMessage` runs `who.py send <sessionId> <text>` with an argv array and no shell; who.py itself requires a live session, and the server never writes the DB. `ledgerFileDiff` runs read-only `git diff`: the worktree must be one in the latest view and the path must be relative with no `..`. No ledger command removes worktrees or branches, dismisses notices, edits `activity.db`, or changes any checkout. Every refusal carries a Vietnamese reason and is returned as a correlated `ledgerCommandResult`.

## Asset System

**Loading**: `esbuild.js` copies `webview-ui/public/assets/` → `dist/assets/`. Loader checks bundled path first, falls back to workspace root. PNG → pngjs → SpriteData (2D hex array, alpha≥2 = visible, `#RRGGBBAA` for semi-transparent). `loadDefaultLayout()` reads `assets/default-layout.json` as fallback for new workspaces.

**Catalog**: `furniture-catalog.json` with `id, name, label, category, footprint, isDesk, canPlaceOnWalls, groupId?, orientation?, state?, canPlaceOnSurfaces?, backgroundTiles?`. String-based type system. Categories: desks, chairs, storage, electronics, decor, wall, misc. Wall-placeable items use the `wall` category and appear in a dedicated "Wall" tab. Asset naming convention: `{BASE}[_{ORIENTATION}][_{STATE}]` (e.g., `MONITOR_FRONT_OFF`).

**Per-furniture manifests**: Each furniture item lives in its own folder under `assets/furniture/` with a `manifest.json` that declares its sprites, rotation groups, state groups (on/off), and animation frames. Floor tiles are individual PNGs in `assets/floors/`; wall tile sets in `assets/walls/`.

**Rotation groups**: `buildDynamicCatalog()` builds `rotationGroups` Map from assets sharing a `groupId`. Supports 2+ orientations (e.g., front/back only). Editor palette shows 1 item per group (front orientation preferred). `getRotatedType()` cycles through available orientations.

**State groups**: Items with `state: "on"` / `"off"` sharing the same `groupId` + `orientation` form toggle pairs. `stateGroups` Map enables `getToggledType()` lookup. Editor palette hides on-state variants. State groups are mirrored across orientations.

**Auto-state**: `officeState.rebuildFurnitureInstances()` swaps electronics to ON sprites when an active agent faces a desk with that item nearby (3 tiles deep in facing direction, 1 tile to each side). Operates at render time without modifying the saved layout.

**Background tiles**: `backgroundTiles?: number` — top N footprint rows allow other furniture to be placed on them AND characters to walk through. Z-sort places bg-row items behind the host furniture.

**Surface placement**: `canPlaceOnSurfaces?: boolean` — items like laptops, monitors, mugs can overlap with all tiles of `isDesk` furniture. `canPlaceFurniture()` builds a desk-tile set and excludes it from collision checks. Z-sort: surface items get `zY = max(spriteBottom, deskZY + 0.5)`.

**Wall placement**: `canPlaceOnWalls?: boolean` — items like paintings, windows, clocks can only be placed on wall tiles. `canPlaceFurniture()` requires the bottom row of the footprint to be on wall tiles; upper rows may extend above the map. `getWallPlacementRow()` offsets placement so the bottom row aligns with the hovered tile.

**Colorize module**: `colorize.ts` with two modes selected by `ColorValue.colorize?` flag. **Colorize mode** (Photoshop-style): grayscale → luminance → contrast → brightness → fixed HSL; always used for floor tiles. **Adjust mode** (default for furniture and character hue shifts): shifts original pixel HSL. `adjustSprite()` exported for character hue shifts. Cache keyed by arbitrary string (includes colorize flag).

**Floor tiles**: `floors.png` (112×16, 7 patterns). Cached by (pattern, h, s, b, c).

**Wall tiles**: `walls.png` (64×128, 4×4 grid of 16×32 pieces). 4-bit auto-tile bitmask (N=1, E=2, S=4, W=8). Sprites extend 16 px above tile (3D face). `wallTiles.ts` computes bitmask at render time. Colorizable via HSBC sliders. Wall sprites z-sorted with furniture/characters (`getWallInstances()` builds `FurnitureInstance[]`).

**Character sprites**: 6 pre-colored PNGs (`assets/characters/char_0.png`–`char_5.png`), one per palette. Each 112×96: 7 frames × 16 px wide, 3 direction rows × 32 px tall. Row 0 = down, Row 1 = up, Row 2 = right. Frame order: walk1, walk2, walk3, type1, type2, read1, read2. Left = flipped right at runtime. When `hueShift !== 0`, `hueShiftSprites()` applies `adjustSprite()` to all frames before caching.

**Load order**: `characterSpritesLoaded` → `floorTilesLoaded` → `wallTilesLoaded` → `furnitureAssetsLoaded` → `layoutLoaded`.

## Testing

Three tiers, each with its own framework.

### Server unit/integration (Vitest)

`server/__tests__/` covers the shared runtime, persistence, providers, HTTP/WebSocket server, CLI, diagnostics, asset reloads, and the e2e scenario runner. Representative suites include:

| File                           | Coverage                                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentStateStore.test.ts`      | Mutations, EventEmitter events, snapshot                                                                                                       |
| `hookEventHandler.test.ts`     | Routing, buffering, normalized dispatch, team gating                                                                                           |
| `sessionRouter.test.ts`        | session_id mapping, pending sessions, buffer flush                                                                                             |
| `fileWatcherDismissal.test.ts` | DismissalTracker integration                                                                                                                   |
| `fileStateAdapter.test.ts`     | Namespaced persistence, allowlist, settings round-trip                                                                                         |
| `migrateVsCodeState.test.ts`   | Verify-before-clear, partial migration                                                                                                         |
| `teamUtils.test.ts`            | Inline-teammate helpers                                                                                                                        |
| `claudeTeamProvider.test.ts`   | Discovery, membership, metadata extraction                                                                                                     |
| `claude.test.ts`               | `normalizeHookEvent` per Claude event, file fallback                                                                                           |
| `claudeHookInstaller.test.ts`  | Atomic install/uninstall, unparseable-file + non-array abort, throwing writes, mode preservation, backup, hook identity, event-scope migration |
| `consentFlow.test.ts`          | In-app consent over the wire: who is asked, what each answer writes, Back-and-revise semantics, answer serialization                           |
| `claude-hook.test.ts`          | Spawned hook script integration (needs `dist/hooks/claude-hook.js`)                                                                            |
| `server.test.ts`               | HTTP lifecycle, auth, `/ws`, broadcast                                                                                                         |
| `httpServerWs.test.ts`         | `/ws` gate: standalone same-origin, embedded Bearer                                                                                            |
| `mockClaudeRunner.test.ts`     | E2E scenario runner sanity                                                                                                                     |

Run: `npm run test:server` (or `npm test` for all).

### Webview unit (Vitest, Node runner)

`webview-ui/test/` covers the company reducer, board lanes, composer, slash commands, usage view, contract plan view, OMP session view, transport replay, and Vite/browser wiring.

Run: `npm run test:webview`.

### End-to-end (Playwright)

`e2e/` contains the Playwright suite. Today it holds one spec, `tests/standalone/company.spec.ts`, which drives the Company board against a real owner process (`fixtures/company-host.ts`) and a scripted OMP (`fixtures/mock-omp-company.cjs`). CI runs the suite on Linux, macOS, and Windows in three shards at `--workers=1`. The generated [e2e inventory](e2e/README.md) is the source of truth for current specs and `@area:` coverage.

**Isolation**: each test gets its own temporary HOME and workspace directory (`helpers/company.ts`). No state leaks between tests.

**Single source of truth for test inventory**: `e2e/README.md` contains an auto-generated section spliced between `<!-- BEGIN:E2E-INVENTORY -->` and `<!-- END:E2E-INVENTORY -->` markers. CI regenerates via `npm run e2e:inventory` and fails on `git diff --exit-code e2e/README.md`.

Run:

```bash
npm run e2e                                    # all tests
npm run e2e -- --workers=1                     # single worker (matches CI sharding)
npm run e2e -- --grep "company"              # filter by name
npm run e2e:debug                              # step-through
npm run e2e -- --attach-videos-on-success      # keep videos for passes too
npm run e2e:inventory                          # regen e2e/README.md inventory
npm run test:report                            # build combined Allure report
npm run test:report:open                       # serve Allure locally (file:// can't fetch)
```

**Reproducing CI failures locally**: CI uses `--workers=1` because the runners can't handle more. Reproduce locally with `npm run e2e -- --workers=1 --grep "<test>"`. For full Linux fidelity, `act -j linux-e2e --matrix shard:1 -P ubuntu-latest=catthehacker/ubuntu:full-22.04 --container-architecture linux/amd64` or run inside `mcr.microsoft.com/playwright:v1.58.2-noble` Docker with `--cpus=2 --memory=4g` to simulate runner throttling.

## Build & Dev

**npm workspaces monorepo** (`server`, `webview-ui`). A single `npm install` at the root installs deps for all workspaces; `cd webview-ui && npm install` is redundant.

```bash
npm install                # installs root + workspaces in one shot
npm run compile            # asyncapi:generate, check-types, lint, esbuild, vite
npm run build              # alias for compile
npm run package            # production build (esbuild --production)
npm test                   # webview + server vitest
npm run e2e                # Playwright
```

`esbuild.js` runs three bundles:

1. **Extension** (`dist/extension.js`) from `adapters/vscode/extension.ts`. External: `vscode`.
2. **CLI** (`dist/cli.js`) from `server/src/cli.ts`. Externals pulled at install time (`fastify`, `@fastify/*`).
3. **Hook scripts** (`dist/hooks/claude-hook.js`) from `server/src/providers/hook/claude/hooks/claude-hook.ts`. CJS, shebang.

`define: { 'process.env.PIXEL_AGENTS_VERSION': JSON.stringify(version) }` stamps the package version into all bundles.

**Watch mode**:

```bash
npm run watch                       # parallel esbuild watch + tsc --noEmit watch
cd webview-ui && npm run dev        # Vite dev server (separate terminal)
```

The webview Vite dev server is **not** included in `npm run watch` — it has to be run separately.

**F5 in VS Code** launches the Extension Development Host with the local extension loaded.

### CI

Single workflow runs (in order): install, lint, `asyncapi:validate`, `asyncapi:generate` + drift check, `e2e:inventory` + drift check, `check-types`, `test:server`, `test:webview`, `e2e` (3-OS x 3-shard matrix: Linux, macOS, Windows), `package`, then a PR-only Vercel preview deploy of the combined Allure report (gated on secrets; gracefully skips on forks, non-blocking on failure). Pushes to `main` run the checks but never deploy to Vercel.

The drift checks are the central guarantees: `core/asyncapi.yaml` ↔ `core/src/messages.ts` stay in lockstep; `e2e/README.md` stays in sync with the spec list.

## TypeScript Constraints

- **No `enum`** (`erasableSyntaxOnly` in webview) — use `as const` objects.
- **`import type`** required for type-only imports (`verbatimModuleSyntax` in webview; convention in extension).
- **`noUnusedLocals` / `noUnusedParameters`** — strict everywhere.
- **`.js` extensions** on all relative imports in extension + server (Node16 module resolution).
- **Module Node16, target ES2022** in the extension/server. **`erasableSyntaxOnly`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`** in the webview.

## Constants Policy

All magic numbers and strings are centralized — never inline:

| Where                              | What lives there                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/constants.ts`          | All timing/scanning constants (`PERMISSION_TIMER_DELAY_MS`, `TEXT_IDLE_DELAY_MS`, scanner intervals) shared by extension and standalone |
| `adapters/vscode/constants.ts`     | VS Code-only IDs, command names, workspace state keys                                                                                   |
| `core/src/constants.ts`            | Protocol-level constants (e.g., transport state names)                                                                                  |
| `webview-ui/src/constants.ts`      | xterm theme and terminal sizes (concrete colour strings xterm needs)                                                                    |
| `webview-ui/src/company/constants.ts` | Board lane order/labels, batching and paging sizes mirrored from the server                                                          |
| `webview-ui/src/index.css` `:root` | CSS custom properties (`--pixel-bg`, `--pixel-border`, `--pixel-accent`, ...) for React inline styles and CSS                           |

## Error Handling

- **Try-catch with graceful degradation** — errors logged but never crash the extension.
- **Malformed JSONL lines** silently ignored (catch block in `processTranscriptLine`).
- **Missing assets** logged with warning, operation continues with null/fallback.
- No centralized error reporting or telemetry.

## Logging

Use `console.log`/`error`/`warn` with prefixed context:

- Extension: `[Pixel Agents]`, `[Extension]`
- Asset loading: `[AssetLoader]`
- Webview: `[Webview]`

## Condensed Lessons

- `fs.watch` unreliable on Windows — always pair with polling backup.
- Partial line buffering essential for append-only file reads (carry unterminated lines).
- Delay `agentToolDone` 300 ms to prevent React batching from hiding brief active states.
- **Idle detection** has two signals: (1) `system` + `subtype: "turn_duration"` — reliable for tool-using turns (~98%), emitted once per completed turn. (2) Text-idle timer (`TEXT_IDLE_DELAY_MS = 5 s`) — for text-only turns. Only starts when `hadToolsInTurn` is false; suppressed once `hadToolsInTurn` becomes true. Reset on new user prompt or `turn_duration`. Cancelled by ANY new JSONL data.
- User prompt `content` can be string (text) or array (tool_results) — handle both.
- `/clear` creates a NEW JSONL file (old file just stops).
- `--output-format stream-json` needs non-TTY stdin — can't use with VS Code terminals.
- Hook-based IPC failed in early prototypes (hooks captured at startup, env vars don't propagate). HTTP `/api/hooks/:providerId` with `~/.pixel-agents/server.json` discovery works.
- PNG→SpriteData: pngjs for RGBA buffer, alpha threshold 2 (`PNG_ALPHA_THRESHOLD`), supports `#RRGGBBAA` semi-transparent pixels.
- **Heuristic sub-agent permission bubble timing**: the bubble lands 7 s after the SUB-TOOL is registered, not 7 s after the parent Task tool appears. Tests waiting on it from the "Subtask:" overlay need at least `1 s (Task→Bash gap) + 7 s timer + ~300 ms IPC/render = 9–10 s` budget.
- **runInBackground sub-character gate**: in webview `agentToolStart`, `runInBackground=true` Agent tools are gated out of sub-character creation when the parent has a `teamName` (teammate path handles it). With no `teamName`, the gate must be bypassed so the basic Subtask sub-character still renders. `addSubagent` dedups via `subagentIdMap`, so the bypass is safe even if a teammate is detected later. `subagentToolStart` creates the sub lazily when it's missing — covering teamed leads' unnamed background spawns and post-reload recreation.
- **Allure HTML report**: viewing via `file://` fails (browsers block `fetch()` from local files). Use `npx allure open allure-report/allure` or `npm run test:report:open`.
- **Context usage is a snapshot against a provider-declared window**, and both halves are easy to get wrong: cumulative sums measure spend rather than occupancy, `input_tokens` without the cache counters measures almost nothing, and a 200k window assumed for a 1M model reads five times too full (the number to check it against is Claude Code's own statusline `context_window.used_percentage`).

## Manual Hook Testing

`server/manual-hook-events.http` (REST-Client format) drives the local hook server while the extension is running. Copy `port` and `token` from `~/.pixel-agents/server.json`, set `cwd` to a workspace folder opened in the Extension Development Host. Covers `SessionStart` → `PreToolUse` → `PermissionRequest`/`Notification`/`Stop` → `SessionEnd`.

If `cwd` is outside the current workspace, enable **Watch All Sessions** first.

## Asset Pipeline (legacy tileset import)

7-stage pipeline in `scripts/` for importing third-party tilesets (the bundled assets don't need this):

1. `0-import-tileset.ts` — Interactive CLI wrapper
2. `1-detect-assets.ts` — Flood-fill asset detection
3. `2-asset-editor.html` — Browser UI for position/bounds editing
4. `3-vision-inspect.ts` — Claude vision auto-metadata
5. `4-review-metadata.html` — Browser UI for metadata review
6. `5-export-assets.ts` — Export PNGs + `furniture-catalog.json`
7. `asset-manager.html` — Unified editor (stages 2+4 combined), Save/Save As via File System Access API

Supporting: `wall-tile-editor.html` (wall sprite editing), `jsonl-viewer.html` (transcript inspector).

## Key Decisions

- **Layered codebase** (core → server → adapters; core → webview-ui). Standalone CLI never imports `adapters/vscode/` and vice versa.
- **AsyncAPI 3.0 contract**, generated TS bindings, CI drift check. Single source of truth for the wire protocol.
- **AgentRuntime** shared lifecycle core, composed by both surfaces.
- **AgentStateStore** as single source of truth with typed mutations and typed events. No transport calls outside the broadcast layer.
- **Transport abstraction**: `MessageTransport` interface, `PostMessageTransport` + `WebSocketTransport`. One branching point in the entire UI.
- **HookProvider** as the integration boundary, with optional file fallback. New CLIs are a single subdirectory under `server/src/providers/hook/<id>/`.
- **TeamProvider** as optional extension. Claude Agent Teams is the only implementation.
- **Per-adapter namespaced persistence** under `~/.pixel-agents/`. VS Code and standalone never clobber each other.
- **Verify-before-clear migration** for legacy VS Code state.
- **Single `WebviewViewProvider`** (panel area, not editor area).
- **Inline esbuild problem matcher** (no extra extension needed).
- **`erasableSyntaxOnly`** in webview forbids `enum` — use `as const` objects.
- **Server always starts** regardless of hooks toggle. Only hook installation is gated by the setting.
- **Consent before any FIRST settings-file write**, per provider (`hooksConsent: {providerId: 'granted'|'declined'}`, absent = unanswered; the `hooksEnabled` preference beside it is per-provider and machine-global). **Exactly one population is asked: the one with nothing of ours installed** — hooks already on disk are granted silently at startup, since that install only ever removes events. The ask is one step of the Intro, the four-step first-run tour a greeter character speaks in-app on both surfaces (`IntroBubble.tsx`); the server sends `hooksConsentRequest` during the `webviewReady` handshake, one per provider, privileged connections only, carrying the provider's own `consentDisclosure()` so no client-side copy can drift. The ask-or-not predicate, the choice→action rule, and the execution live ONCE in `server/src/providers/hook/` (`consentGate.ts` decides, `consentExecutor.ts` performs); surfaces supply only their effects. **A choice is an absolute state command, not an event** — Back re-opens the ask, so a revision undoes whatever the earlier answer left: hooks on disk, a grant a failed install recorded, or a decline's own persisted hooks-off. That is why the consent record is a tri-state and each answer commits in ONE config write; the full rule and its rejected alternatives are `docs/adr/0001`. An abort (close x, Escape) sends nothing and the whole Intro returns next open; the closing step reports the install OUTCOME, not the click.
- **`hooksStatus` is install state, `hooksEnabled` is preference.** The Settings checkbox binds to `hooksInstalled` and toggles the _displayed_ state with no optimistic local update, so it can't read "on" over an untouched settings.json and lands correct rather than flickering when an install fails. Every failure path re-derives and broadcasts the truth (standalone via `clientMessageHandler`, VS Code via `reportHooksStatus`). The hook script is copied BEFORE the entries are written; a failed copy aborts the install (entries pointing at a missing script spawn a dead `node` per event). **Hooks-off is persisted only AFTER a successful uninstall** — flipping it first strands the user: the entries keep firing while the persisted preference makes the next start skip the gate entirely.
- **Never rewrite a shape we did not author.** The unparseable-file abort generalizes: a non-object `hooks`, a non-array `hooks.<Event>`, and junk entries inside an event array are all refused or passed through, never replaced. An array `hooks` was the sharp case — string keys assigned onto it vanish from `JSON.stringify`, so the write committed and reported `installed: true` over a file with no hooks in it. Emptied event keys are deleted only when _our_ removal emptied them. **Internal sentinels must not be values user JSON can hold**: `null` marked "this entry is now empty", so a user-authored `null` inside a hooks array was silently deleted (a file with no Pixel Agents command anywhere came back rewritten and logged as "Hooks removed") — it is a `Symbol` now.
- **Hook identity is anchored at both ends, not a substring.** `includes('claude-hook.js') && includes('.pixel-agents')` claimed — and `uninstallHooks` then DELETED — a `.backup` copy of our script, a shell comment naming our path, a wrapper passing it as an argument, `/opt/evil.pixel-agents/hooks/claude-hook.js`, and `my-pixel-agents-hook.js`. Ours = the `/.pixel-agents/hooks/claude-hook.js` suffix, ending the command's FIRST token, matched **case-insensitively** (the token is normalized to lower case). Case-sensitive matching is what shipped, and on the case-insensitive volumes this runs on (macOS, Windows) a differently-cased path is the SAME INODE as our script and genuinely firing: reinstall appended a duplicate and uninstall left the cased entry as an orphan our own `areHooksInstalled` could no longer see — a live hook with no removal route. The folding is unconditional (no filesystem case-sensitivity probe), so the accepted trade is a Linux-only false positive that is **not** a mere dedup: on a case-sensitive volume `~/.Pixel-Agents/hooks/claude-hook.js` is a genuinely DIFFERENT file, we classify it as ours, and uninstall **deletes** it (`claudeHookInstaller.test.ts` pins that removal). Nothing creates that path, and the trade is deliberate — the alternative is a guaranteed unremovable live hook on the two platforms this actually ships to. A symlink alias to our script is deliberately _not_ recognized — the cost is one duplicate entry, versus deleting a stranger's hook if we resolved paths.
- **E2E over webview unit tests** for OSS friction. Community PRs change webview internals constantly; unit tests would force contributors to update internals tests on top of feature work. E2E pins user-facing behavior, which is stable across internal refactors.

## Project Identity

- Extension ID: `pablodelucca.pixel-agents` (VS Code Marketplace + Open VSX)
- npm package: `pixel-agents` (CLI bin: `pixel-agents`)
- GitHub: `https://github.com/pixel-agents-hq/pixel-agents`
- License: MIT
