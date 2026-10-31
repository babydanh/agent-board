/** Which Project-tree node (folder) started each cloud session, kept in this browser: the hub only knows machines. */
export type CloudFolders = Readonly<Record<string, string>>;

export const CLOUD_FOLDERS_KEY = 'omp.company.cloudFolders';

export function cloudFolderKey(machine: string, session: string): string {
  return `${machine}/${session}`;
}

export function parseCloudFolders(raw: string | null): CloudFolders {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

export function readCloudFolders(): CloudFolders {
  try {
    return parseCloudFolders(window.localStorage.getItem(CLOUD_FOLDERS_KEY));
  } catch {
    return {};
  }
}

export function writeCloudFolders(folders: CloudFolders): void {
  try {
    window.localStorage.setItem(CLOUD_FOLDERS_KEY, JSON.stringify(folders));
  } catch {
    // Storage is optional in embedded and restricted browser contexts.
  }
}

/** The part of a tree node placement reads: its id, its place in the tree and the folder it points at. */
export interface CloudPlaceNode {
  readonly id: string;
  readonly parentId?: string;
  readonly kind: string;
  readonly path?: string;
}

function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean).map((part) => part.toLowerCase());
}

interface FolderEntry {
  readonly node: CloudPlaceNode;
  readonly own: readonly string[];
  readonly names: Set<string>;
}

/** The directory names inside a folder's own path that a path sits below; none for a path elsewhere. */
function below(path: readonly string[], own: readonly string[]): readonly string[] {
  return own.every((part, index) => path[index] === part) ? path.slice(own.length) : [];
}

/** Each folder's own name plus every directory its sessions work in below it: a repo checked out inside counts as its repo. */
function folderNames(nodes: readonly CloudPlaceNode[]): Map<string, FolderEntry> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const folders = new Map<string, FolderEntry>();
  for (const node of nodes) {
    if (node.kind !== 'folder' || node.path === undefined) continue;
    const own = segments(node.path);
    folders.set(node.id, { node, own, names: new Set(own.slice(-1)) });
  }
  for (const node of nodes) {
    if (node.path === undefined) continue;
    let owner = node.parentId === undefined ? undefined : byId.get(node.parentId);
    for (let hops = 0; owner !== undefined && owner.kind !== 'folder' && hops < nodes.length; hops += 1) {
      owner = owner.parentId === undefined ? undefined : byId.get(owner.parentId);
    }
    const entry = owner === undefined ? undefined : folders.get(owner.id);
    if (entry !== undefined) for (const part of below(segments(node.path), entry.own)) entry.names.add(part);
  }
  return folders;
}

/** Every name a node's folders go by: the folder itself and the directories below it, for the node and all it holds. */
export function folderRepoNames(nodes: readonly CloudPlaceNode[], nodeId: string): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const names = new Set<string>();
  for (const [id, entry] of folderNames(nodes)) {
    let current = byId.get(id);
    for (let hops = 0; current !== undefined && hops <= nodes.length; hops += 1) {
      if (current.id === nodeId) {
        for (const name of entry.names) names.add(name);
        break;
      }
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }
  }
  return names;
}

/** The folder holding most of the session's repositories; several folders under one project mean that project. */
function folderOfRepos(repos: readonly { readonly name: string }[], folders: ReadonlyMap<string, FolderEntry>): string | undefined {
  const counts = new Map<string, { readonly node: CloudPlaceNode; count: number }>();
  for (const repo of repos) {
    const wanted = repo.name.toLowerCase();
    for (const { node, names } of folders.values()) {
      if (names.has(wanted)) counts.set(node.id, { node, count: (counts.get(node.id)?.count ?? 0) + 1 });
    }
  }
  const matched = [...counts.values()].sort((a, b) => b.count - a.count || (a.node.id < b.node.id ? -1 : 1));
  const [best] = matched;
  if (best === undefined) return undefined;
  const parent = best.node.parentId;
  return parent !== undefined && matched.length > 1 && matched.every((entry) => entry.node.parentId === parent) ? parent : best.node.id;
}

/**
 * Rows under their tree node: the one the user started them from, else the folder named like their repository.
 * A row that matches no node stays loose.
 */
export function placeCloudRows<T extends { readonly machine: string; readonly session: string; readonly repos?: readonly { readonly name: string }[] }>(
  rows: readonly T[],
  folders: CloudFolders,
  nodes: readonly CloudPlaceNode[],
): { readonly byFolder: Map<string, T[]>; readonly loose: T[] } {
  const ids = new Set(nodes.map((node) => node.id));
  const index = folderNames(nodes);
  const byFolder = new Map<string, T[]>();
  const loose: T[] = [];
  for (const row of rows) {
    const chosen = folders[cloudFolderKey(row.machine, row.session)];
    const folder = chosen !== undefined && ids.has(chosen) ? chosen : folderOfRepos(row.repos ?? [], index);
    if (folder === undefined) loose.push(row);
    else byFolder.set(folder, [...(byFolder.get(folder) ?? []), row]);
  }
  return { byFolder, loose };
}
