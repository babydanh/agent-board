import type { ProjectBranchCompareServices } from './branchCompare.js';
import type { ProjectCommentServices } from './comments.js';
import type { ProjectDiffServices } from './diff.js';
import type { ProjectMergePreviewServices } from './mergePreview.js';
import type { ProjectSessionServices } from './newSession.js';
import type { ProjectStore } from './projectStore.js';
import type { ProjectTreeSnapshot } from './projectTree.js';
import type { ProjectSettingsServices } from './settingsLayers.js';

/** Dependencies every phase-two project module receives from the dispatcher. */
export interface ProjectModuleDeps<S> {
  readonly store: ProjectStore;
  /** Current tree snapshot; the allowlist for nodes, checkouts, repos and sessions. */
  loadTree(): Promise<ProjectTreeSnapshot>;
  readonly services: S;
}

/** Runtime services the composition root wires; a missing one disables that command. */
export interface ProjectServices {
  readonly diff?: ProjectDiffServices;
  readonly mergePreview?: ProjectMergePreviewServices;
  readonly branchCompare?: ProjectBranchCompareServices;
  readonly comments?: ProjectCommentServices;
  readonly settings?: ProjectSettingsServices;
  readonly session?: ProjectSessionServices;
  /** Keeps a prompt image on a cloud machine and returns its path there. */
  readonly cloudImage?: (machine: string, fileName: string, dataBase64: string) => Promise<string>;
}
