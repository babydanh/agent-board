import { createReadStream } from 'node:fs';
import { extname } from 'node:path';

import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import type { GitGuardReport } from '../../core/src/messages.js';
import {
  type AgentFolder,
  type AgentSessionRow,
  registerAgentRoutes,
  sessionRows,
} from './agentApi/agentApi.js';
import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import {
  type AssetCache,
  handleClientMessage,
  type ReloadAssetsSideEffect,
  type SetHooksEnabledSideEffect,
} from './clientMessageHandler.js';
import type { BrowserReaperControl } from './company/browserReaper.js';
import type { CompanyCommandServices, CompanyWorkspaceControl } from './company/clientCommands.js';
import { CompanyClientGate } from './company/egress.js';
import type { UsageControl } from './company/usagePage.js';
import {
  HOOK_API_PREFIX,
  LIBRARY_ACCESS_DENIED_REASON,
  LIBRARY_PROOF_DEFAULT_MEDIA_TYPE,
  LIBRARY_PROOF_MEDIA_TYPE_BY_EXTENSION,
  LIBRARY_PROOF_NOT_FOUND_REASON,
  LIBRARY_PROOF_ROUTE,
  MAX_HOOK_BODY_SIZE,
  PROJECT_TREE_POLL_MS,
  WS_CLOSE_FORBIDDEN_ORIGIN,
  WS_CLOSE_UNAUTHORIZED,
} from './constants.js';
import { getFleetBranchCollisionStatus, getFleetGuardRiskCounts } from './fleet/handler.js';
import { transcriptFile } from './herdr/agentReply.js';
import type { HerdrLink } from './herdr/herdrLink.js';
import type { LedgerService } from './ledger/ledgerService.js';
import { resolveProofPath } from './library/storage.js';
import { handleProjectMessage, type ProjectCommandContext } from './projects/handler.js';
import { buildProjectTreeSnapshot, herdrProjectSessions } from './projects/projectTree.js';
import { createTranscriptProgress, type TranscriptFacts } from './projects/sessionProgress.js';
import { processAlive } from './projects/sessionStop.js';
import { registerShareRoutes } from './share/shareRoutes.js';
import { ShareStore } from './share/shareStore.js';
import { createShareTargets, type ShareTargets } from './share/targets.js';
import type { PtySessionManager } from './terminal/ptySessionManager.js';
import { registerTerminalRoutes } from './terminal/terminalRoutes.js';
import type { AgentState } from './types.js';
import { registerVoiceRoutes } from './voice/voiceRoutes.js';
import {
  bearerTokenValid,
  isAllowedWebSocketOrigin,
  privilegedHostnames,
  redactTokenQuery,
  standaloneHandshakeVerdict,
} from './wsAuth.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** true = VS Code embedded mode (ephemeral port, no static, quiet logging) */
  embedded: boolean;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for hook and WebSocket endpoints */
  token: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Shared agent lifecycle core (for toggle side effects + standalone restore). Optional in embedded mode. */
  runtime?: AgentRuntime;
  /** Path to SPA dist directory for static serving (standalone only) */
  staticDir?: string;
  /** Cached assets loaded at startup (standalone only) */
  assetCache?: AssetCache;
  /** Callback when a hook event is received */
  onHookEvent?: (providerId: string, event: Record<string, unknown>) => void;
  /** Invoked when setHooksEnabled is toggled via WebSocket. Standalone installs/uninstalls hooks here. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** Invoked when an external asset directory is added/removed. Standalone reloads + re-broadcasts assets here. */
  onReloadAssets?: ReloadAssetsSideEffect;
  /** Company command surface; absent until a company workspace is open. */
  company?: CompanyCommandServices | null;
  /** Resolves an asynchronously opened workspace without capturing a stale null. */
  getCompany?: () => CompanyCommandServices | null;
  /** Execution trust decision supplied by embedded hosts, independent of the bearer token. */
  isCompanyExecutionAllowed?: () => boolean;
  /** Server-level herdr link; absent when this process does not link herdr. */
  herdr?: HerdrLink | null;
  /** Browser reaper control; absent when this process runs none. */
  browserReaper?: BrowserReaperControl | null;
  /** Usage page reader; absent when this process runs none. */
  usage?: UsageControl | null;
  /** Company folder list and switching; absent when the process holds one fixed workspace. */
  workspaces?: CompanyWorkspaceControl | null;
  /** Ledger board service. Live snapshots reach privileged sockets only; absent or null = no ledger. */
  ledger?: LedgerService | null;
  getLocalGuard?: () => GitGuardReport | null;
  /** PTY terminals for standalone-launched agents. Absent = terminal feature off
   *  (VS Code embedded mode, where the editor owns terminals). */
  ptyManager?: PtySessionManager;
  /** View-only share links. Standalone with a terminal manager gets a fresh store when absent. */
  shares?: ShareStore;
  /** What a share link may point at; derived from this server's terminals, herdr link and company folders when absent. */
  shareTargets?: ShareTargets;
  /** Project persistence and checkout discovery, supplied by the host composition root. */
  projects?: Omit<ProjectCommandContext, 'privileged' | 'agents' | 'herdrSessions'>;
  /** Extra Host names (beyond loopback and a specific bind address) a
   *  privileged standalone handshake may arrive under -- e.g. a reverse proxy's
   *  public name. See wsAuth.privilegedHostnames. */
  allowedHosts?: readonly string[];
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

/**
 * Create a Fastify server with hook endpoint, health check, and WebSocket support.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({
    // Standalone logs every request. The privilege token rides `/ws?token=`
    // and `/terminal/:id?token=` handshakes, so the url is redacted before it
    // is written -- otherwise every (re)connect would put the secret in stdout
    // and any log file (see wsAuth.redactTokenQuery).
    logger: options.embedded ? false : { serializers: { req: serializeRequestForLog } },
    bodyLimit: MAX_HOOK_BODY_SIZE,
  });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Static SPA serving (standalone mode only)
  if (!options.embedded && options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  const host = options.host ?? '127.0.0.1';
  const allowedHostnames = privilegedHostnames(host, options.allowedHosts ?? []);

  // Share links show screens to people without the board token, so they exist only in standalone.
  // Resolved first so every route and every socket sees the same store.
  if (!options.embedded) {
    const shares = options.shares ?? new ShareStore();
    const shareTargets = options.shareTargets ?? createShareTargets({
      ...(options.ptyManager === undefined ? {} : { ptyManager: options.ptyManager }),
      herdr: options.herdr ?? null,
      companyPeek: (sessionId) => {
        const services = options.workspaces?.servicesHolding(sessionId) ?? options.getCompany?.() ?? options.company ?? null;
        return services?.terminal?.peek?.(sessionId);
      },
    });
    registerShareRoutes(app, { shares, feedFor: (target) => shareTargets.feedFor(target) });
    options = { ...options, shares, shareTargets };
  }

  registerHealthRoute(app);
  registerHookRoute(app, options);
  registerWebSocketRoute(app, options, allowedHostnames);
  registerLibraryProofRoute(app, options.token);
  registerTerminalRoutes(app, {
    token: options.token,
    allowedHostnames,
    ptyManager: options.ptyManager,
  });
  registerAgentRoutes(app, {
    token: options.token,
    sessions: () => agentSessions(options),
    folders: () => agentFolders(options),
    guardRiskCounts: () => getFleetGuardRiskCounts(options.getLocalGuard),
    branchCollisions: () => getFleetBranchCollisionStatus(options.ledger ?? null),
  });
  registerVoiceRoutes(app, { token: options.token });

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host, port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));
}

function registerLibraryProofRoute(app: FastifyInstance, token: string): void {
  app.get<{ Params: { proofId: string } }>(LIBRARY_PROOF_ROUTE, async (request, reply) => {
    if (!bearerTokenValid(request.headers.authorization, token)) {
      return reply.code(401).send({ error: LIBRARY_ACCESS_DENIED_REASON });
    }

    try {
      const proofPath = await resolveProofPath(request.params.proofId);
      return reply.type(
        LIBRARY_PROOF_MEDIA_TYPE_BY_EXTENSION[extname(proofPath).toLowerCase()] ??
        LIBRARY_PROOF_DEFAULT_MEDIA_TYPE,
      ).send(createReadStream(proofPath));
    } catch {
      return reply.code(404).send({ error: LIBRARY_PROOF_NOT_FOUND_REASON });
    }
  });
}

/** One transcript reader for the process: it remembers how far each transcript was read. */
const transcriptProgress = createTranscriptProgress();

/** What a session's transcript says; a Claude session asleep or in a herdr pane is named by its id, not its file. */
async function sessionFacts(fileOrId: string): Promise<TranscriptFacts> {
  const file = await transcriptFile(fileOrId);
  return file === undefined ? {} : transcriptProgress(file);
}

/** Project tree inputs from the ledger's caches, unless the caller supplied its own. */
function projectTreeFromLedger(options: HttpServerOptions): Pick<ProjectCommandContext, 'tree'> {
  const ledger = options.ledger;
  if (options.projects?.tree !== undefined || ledger === undefined || ledger === null) return {};
  return {
    tree: {
      ledger: ledger.projectTreeSource,
      git: ledger.projectTreeGit,
      isAlive: processAlive,
      readRepo: (repo) => ledger.repoScan(repo),
      overlapScans: () => ledger.currentOverlapScans(),
      sessionFacts,
    },
  };
}

// ── Agent CLI (`board`) ────────────────────────────────────────

/** Live sessions for `board status`: the Project tree without its git scan, and without the ended sessions the sidebar keeps for a day. */
async function agentSessions(options: HttpServerOptions): Promise<AgentSessionRow[]> {
  const store = options.projects?.store;
  const tree = options.projects?.tree ?? projectTreeFromLedger(options).tree;
  if (store === undefined || tree === undefined) return [];
  const { nodes } = await buildProjectTreeSnapshot(store, {
    ...tree,
    sessionsOnly: true,
    agents: options.store.values(),
    herdrSessions: () => herdrProjectSessions(options.herdr?.snapshot()),
  });
  return sessionRows(nodes).filter((row) => row.state !== 'ended');
}

/** The work item boards of the open folders. */
function agentFolders(options: HttpServerOptions): AgentFolder[] {
  const workspaces = options.workspaces;
  if (workspaces === null || workspaces === undefined) return [];
  return workspaces.entries().flatMap((entry) => {
    const service = entry.open ? workspaces.servicesFor(entry.path)?.workItems : undefined;
    return service === undefined ? [] : [{ path: entry.path, service }];
  });
}

// ── Hook Events ────────────────────────────────────────────────

function registerHookRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{
    Params: { providerId: string };
    Body: Record<string, unknown>;
  }>(
    `${HOOK_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token),
      schema: {
        params: {
          type: 'object',
          properties: {
            providerId: { type: 'string', pattern: '^[a-z0-9-]+$' },
          },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const event = request.body;

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
      }

      reply.send('ok');
    },
  );
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(
  app: FastifyInstance,
  options: HttpServerOptions,
  allowedHostnames: ReadonlySet<string>,
): void {
  const currentTerminalLeases = new Map<string, string>();
  app.get('/ws', { websocket: true }, (socket, request) => {
    // CONNECTION gate. Embedded (VS Code) requires the Bearer token. Standalone
    // requires a same-origin handshake instead (isAllowedWebSocketOrigin), so a
    // non-browser local client with no Origin can still watch the office. What
    // may be DONE over an accepted connection is a separate question, decided
    // below.
    if (options.embedded) {
      if (!bearerTokenValid(request.headers.authorization, options.token)) {
        socket.close(WS_CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }
    } else if (!isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)) {
      socket.close(WS_CLOSE_FORBIDDEN_ORIGIN, 'forbidden origin');
      return;
    }

    // Both modes prove privilege with the SAME out-of-band secret, differently
    // carried: embedded sends the Bearer token it was handed in-process;
    // standalone sends the `?token=` the CLI printed in the local URL and the
    // SPA forwarded on this handshake, and it must arrive under an allowed Host
    // -- the same verdict the terminal socket applies. A network POSITION
    // never grants privilege, because every position is reproducible by a
    // forwarder; the Host allowlist can only take it away.
    let privileged = options.embedded;
    if (!options.embedded) {
      const verdict = standaloneHandshakeVerdict(
        request.url,
        request.headers.host,
        options.token,
        allowedHostnames,
      );
      privileged = verdict === 'privileged';
      if (verdict === 'untrusted-host') {
        // The operator has the right URL but reached us under a name they never
        // listed (typically a reverse proxy). Say how to fix it, or the session
        // silently stays watch-only.
        console.warn(
          `[Pixel Agents] Tokened connection via Host "${request.headers.host ?? ''}" is read-only: restart with --allowed-host <that name> to allow changes from it.`,
        );
      }
    }

    const { store } = options;
    let projectTreeRequested = false;
    let projectTreeTimer: NodeJS.Timeout | undefined;
    // Sessions change state (working → idle) without any event the server hears: poll while the tree is shown.
    let projectTreePoll: NodeJS.Timeout | undefined;
    const projectContext = (): ProjectCommandContext => ({
      ...options.projects,
      ...projectTreeFromLedger(options),
      privileged,
      agents: store.values(),
      herdrSessions: () => herdrProjectSessions(options.herdr?.snapshot()),
    });
    const scheduleProjectTree = () => {
      if (!projectTreeRequested || !privileged || projectTreeTimer !== undefined) return;
      projectTreeTimer = setTimeout(() => {
        projectTreeTimer = undefined;
        handleProjectMessage(
          { type: 'projectTreeRequest', requestId: 'project-tree-refresh' },
          (message) => {
            gate.observeOutbound(message as unknown as Record<string, unknown>);
            safeSend(socket, message as unknown as Record<string, unknown>);
          },
          projectContext(),
        );
      }, 250);
      projectTreeTimer.unref?.();
    };

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      safeSend(socket, {
        type: 'agentCreated',
        id,
        directoryName: agent.directoryName,
        isExternal: agent.isExternal || undefined,
        isTeammate: agent.leadAgentId !== undefined || undefined,
        teammateName: agent.agentName,
        parentAgentId: agent.leadAgentId,
        teamName: agent.teamName,
        hooksOnly: agent.hooksOnly || undefined,
        palette: agent.palette,
        hueShift: agent.hueShift,
      });
      scheduleProjectTree();
    };

    const onAgentRemoved = (id: number) => {
      safeSend(socket, { type: 'agentClosed', id });
      scheduleProjectTree();
    };

    // Per-socket egress gate. Ingress is checked in the dispatcher; this is the
    // other half, so an observer socket cannot read company state out of the
    // store broadcast path.
    // Folder-tagged state follows the registry's active folder unless this socket chose `all`.
    const gate = new CompanyClientGate(privileged, currentTerminalLeases, {
      activePath: () => options.workspaces?.activePath() ?? null,
    });

    const onBroadcast = (message: Record<string, unknown>) => {
      if (!gate.allowsDelivery(message)) return;
      safeSend(socket, message);
      if (message.type === 'companyWorkspaces') scheduleProjectTree();
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);
    // Ledger snapshots reach privileged sockets only: the board shows session intents and file paths.
    const unsubscribeLedger =
      privileged && options.ledger
        ? options.ledger.subscribe((message) => {
            safeSend(socket, message as unknown as Record<string, unknown>);
            scheduleProjectTree();
          })
        : null;
    const unsubscribeHerdr =
      privileged && options.herdr ? options.herdr.onAgents(() => scheduleProjectTree()) : null;

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === 'projectTreeRequest' && !projectTreeRequested) {
          projectTreeRequested = true;
          projectTreePoll = setInterval(() => scheduleProjectTree(), PROJECT_TREE_POLL_MS);
          projectTreePoll.unref?.();
        }
        if (!options.embedded && msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(
          msg,
          (m) => {
            gate.observeOutbound(m);
            safeSend(socket, m);
          },
          {
            store,
            runtime: options.runtime,
            cache: options.assetCache ?? null,
            onSetHooksEnabled: options.onSetHooksEnabled,
            onReloadAssets: options.onReloadAssets,
            company: options.getCompany?.() ?? options.company ?? null,
            workspaces: options.workspaces ?? null,
            ledger: options.ledger ?? null,
            privileged,
            companyExecutionAllowed: options.isCompanyExecutionAllowed?.() ?? !options.embedded,
            onTerminalAttached: (sessionId, leaseId) => gate.grant(sessionId, leaseId),
            onTerminalDetached: (sessionId, leaseId) => gate.release(sessionId, leaseId),
            onCompanyViewMode: (mode) => gate.setCompanyView(mode),
            companyViewMode: () => gate.companyViewMode,
            herdr: options.herdr ?? null,
            browserReaper: options.browserReaper ?? null,
            usage: options.usage ?? null,
            getLocalGuard: options.getLocalGuard,
            ptyManager: options.ptyManager,
            shares: options.shares,
            shareTargets: options.shareTargets,
            projects: {
              ...options.projects,
              ...projectTreeFromLedger(options),
            },
          },
        );
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      clearTimeout(projectTreeTimer);
      clearInterval(projectTreePoll);
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
      unsubscribeLedger?.();
      unsubscribeHerdr?.();
      gate.dispose();
    });
  });
}

// ── Auth Helper ────────────────────────────────────────────────

function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!bearerTokenValid(request.headers.authorization, expectedToken)) {
      reply.code(401).send('unauthorized');
    }
  };
}

// ── Logging ────────────────────────────────────────────────────

/** Fastify's default request serializer, minus the token query. Exported so a
 *  test can pin that the secret never reaches the log line. */
export function serializeRequestForLog(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: redactTokenQuery(request.url),
    hostname: request.hostname,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort,
  };
}

// ── Utilities ──────────────────────────────────────────────────

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
