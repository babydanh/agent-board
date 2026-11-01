import { randomUUID } from 'node:crypto';

import type { ProjectPrepareScript } from '../../../core/src/messages.js';
import type { CompanyWorkspaceRegistry } from '../company/workspaceRegistry.js';
import { sharedCloudControl } from '../fleet/handler.js';
import type { HerdrLink } from '../herdr/herdrLink.js';
import { ledgerPathKey } from '../ledger/ledgerPath.js';
import type { LedgerService } from '../ledger/ledgerService.js';
import type { ProcessRunner } from '../ledger/processRunner.js';
import { LibraryUserError } from '../library/libraryError.js';
import { createProjectBranchCompareServices } from './branchCompare.js';
import { createProjectCommentServices } from './comments.js';
import { createProjectDiffServices } from './diff.js';
import { createProjectMergePreviewServices } from './mergePreview.js';
import { createPrepareWorktree, createProjectSessionRuntime } from './newSessionRuntime.js';
import { ProjectStore } from './projectStore.js';
import { buildProjectTreeSnapshot, type ProjectTreeSnapshot } from './projectTree.js';
import type { ProjectModuleDeps, ProjectServices } from './services.js';
import { processAlive } from './sessionStop.js';
import {
  createProjectSettingsServices,
  type ProjectSettingsServices,
  refreshProjectSettings,
  resolveProjectSettings,
} from './settingsLayers.js';

type ProjectFolders = Pick<CompanyWorkspaceRegistry, 'entries' | 'servicesFor' | 'servicesHolding' | 'ensure'>;

export interface ProjectRuntimeInput {
  readonly company: ProjectFolders;
  readonly ledger: LedgerService;
  readonly runProcess: ProcessRunner;
  /** Opens native and lane-wrapped interactive CLI sessions in Herdr tabs, and finds agents already running. */
  readonly herdr: Pick<HerdrLink, 'startAgent' | 'startCli' | 'snapshot'>;
}

export interface ProjectRuntime {
  readonly store: ProjectStore;
  readonly services: ProjectServices;
  /** WorkItemService hook: runs the folder's effective worktree setup before a run starts. */
  readonly prepareWorktree: ReturnType<typeof createPrepareWorktree>;
  /** Reapplies inherited settings to every open folder's scheduler. */
  refreshSettings(): Promise<void>;
  /** Reads every folder's repos once so the first board open finds git scans cached. */
  warm(): Promise<void>;
  /** The board session an open folder runs for an omp (native) session id. */
  boardSessionFor(nativeSessionId: string): string | undefined;
}

/** Composition root of the Project tree: one store, one tree loader, every service wired to the real runtime. */
export function createProjectRuntime(input: ProjectRuntimeInput): ProjectRuntime {
  const { company, ledger, runProcess, herdr } = input;
  const store = new ProjectStore();
  // Settings and worktree setup only need Project/group/folder nodes: skip the git scan.
  const loadTree = (): Promise<ProjectTreeSnapshot> =>
    buildProjectTreeSnapshot(store, {
      ledger: ledger.projectTreeSource,
      git: ledger.projectTreeGit,
      sessionsOnly: true,
    });

  const settings = createProjectSettingsServices({
    globalSettings: async () => ({}),
    workItemServices: () =>
      company.entries().flatMap((entry) => {
        if (!entry.open) return [];
        const service = company.servicesFor(entry.path)?.workItems;
        return service === undefined ? [] : [{ folder: entry.path, service }];
      }),
  });
  const settingsDeps: ProjectModuleDeps<ProjectSettingsServices> = { store, loadTree, services: settings };

  const effectivePrepareFor = async (folder: string): Promise<ProjectPrepareScript | undefined> => {
    const key = ledgerPathKey(folder);
    const { nodes } = await loadTree();
    const node = nodes.find((candidate) => candidate.kind === 'folder' && candidate.path !== undefined && ledgerPathKey(candidate.path) === key);
    if (node === undefined) return undefined;
    return (await resolveProjectSettings(node.id, settingsDeps)).worktreePrepare;
  };

  return {
    store,
    prepareWorktree: createPrepareWorktree({ effectivePrepareFor, runProcess }),
    refreshSettings: () => refreshProjectSettings(settingsDeps),
    boardSessionFor: (nativeSessionId) => {
      for (const entry of company.entries()) {
        if (!entry.open) continue;
        const found = company.servicesFor(entry.path)?.coordinator.sessionForNative?.(nativeSessionId);
        if (found !== null && found !== undefined) return found;
      }
      return undefined;
    },
    warm: async () => {
      await buildProjectTreeSnapshot(store, {
        ledger: ledger.projectTreeSource,
        git: ledger.projectTreeGit,
        isAlive: processAlive,
        readRepo: (repo) => ledger.repoScan(repo),
        overlapScans: () => ledger.currentOverlapScans(),
      });
    },
    services: {
      settings,
      diff: createProjectDiffServices({ runProcess, ledger: ledger.projectTreeSource }),
      cloudImage: (machine, fileName, dataBase64) => sharedCloudControl().uploadImage(machine, fileName, dataBase64),
      mergePreview: createProjectMergePreviewServices({ runProcess }),
      branchCompare: createProjectBranchCompareServices({ runProcess }),
      comments: createProjectCommentServices({
        ledger,
        sendBoardPrompt: async (sessionId, text) => {
          const services = company.servicesHolding(sessionId);
          if (services === null) throw new LibraryUserError('Phiên này không còn trên board.');
          await services.coordinator.submitPrompt({ requestId: randomUUID(), text, targetSessionId: sessionId, delivery: 'prompt' });
        },
      }),
      session: createProjectSessionRuntime({
        coordinatorFor: async (folder) => (await company.ensure(folder)).coordinator,
        boardFolders: () => company.entries().map((entry) => entry.path),
        herdr,
        runProcess,
        effectiveSettings: (nodeId) => resolveProjectSettings(nodeId, settingsDeps),
      }),
    },
  };
}
