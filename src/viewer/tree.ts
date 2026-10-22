import type { Attachment } from '../canvas/api';
import type { ArchiveEntry } from '../archive';
import { archiveFormat, type ArchiveFormat } from '../render/detect';

export interface FileNode {
  id: string;
  name: string;
  /** Full display path, including the archive(s) it came from. */
  path: string;
  type: 'file' | 'dir';
  size: number;
  children: FileNode[];
  /** Archive nesting level: 0 for submission attachments. */
  depth: number;
  /** Canvas download URL (attachments only). */
  remoteUrl?: string;
  /** File contents, once downloaded or extracted. */
  data?: Uint8Array;
  archive: ArchiveFormat | null;
  expanded: boolean;
  /** Archive was extracted (children populated). */
  extracted?: boolean;
}

let nextId = 0;
const newId = () => `n${++nextId}`;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes.sort((a, b) => (a.type === b.type ? collator.compare(a.name, b.name) : a.type === 'dir' ? -1 : 1));
}

export function attachmentNodes(attachments: Attachment[]): FileNode[] {
  return attachments.map((a) => ({
    id: newId(),
    name: a.name,
    path: a.name,
    type: 'file',
    size: a.size,
    children: [],
    depth: 0,
    remoteUrl: a.url,
    archive: archiveFormat(a.name),
    expanded: false,
  }));
}

/** Build a directory tree from flat archive entries. Small archives start fully expanded. */
export function entriesToNodes(entries: ArchiveEntry[], parentPath: string, depth: number): FileNode[] {
  const roots: FileNode[] = [];
  const dirs = new Map<string, FileNode>();
  const expandAll = entries.length <= 40;

  const dirFor = (dirPath: string): FileNode[] => {
    if (!dirPath) return roots;
    const existing = dirs.get(dirPath);
    if (existing) return existing.children;
    const slash = dirPath.lastIndexOf('/');
    const parent = dirFor(slash === -1 ? '' : dirPath.slice(0, slash));
    const node: FileNode = {
      id: newId(),
      name: dirPath.slice(slash + 1),
      path: `${parentPath}/${dirPath}`,
      type: 'dir',
      size: 0,
      children: [],
      depth,
      archive: null,
      expanded: expandAll,
    };
    dirs.set(dirPath, node);
    parent.push(node);
    return node.children;
  };

  for (const entry of entries) {
    const slash = entry.path.lastIndexOf('/');
    const name = entry.path.slice(slash + 1);
    dirFor(slash === -1 ? '' : entry.path.slice(0, slash)).push({
      id: newId(),
      name,
      path: `${parentPath}/${entry.path}`,
      type: 'file',
      size: entry.size,
      children: [],
      depth,
      data: entry.data,
      archive: archiveFormat(name),
      expanded: false,
    });
  }

  const sortDeep = (nodes: FileNode[]) => {
    sortNodes(nodes);
    for (const n of nodes) sortDeep(n.children);
  };
  sortDeep(roots);
  // A zip that wraps everything in one folder: open that folder.
  if (roots.length === 1 && roots[0]!.type === 'dir') roots[0]!.expanded = true;
  return roots;
}

export function findNode(nodes: FileNode[], id: string): FileNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** First viewable (non-archive) file in display order. */
export function firstFile(nodes: FileNode[]): FileNode | null {
  for (const node of nodes) {
    if (node.type === 'file' && !node.archive) return node;
    if (node.expanded || node.type === 'dir') {
      const found = firstFile(node.children);
      if (found) return found;
    }
  }
  return null;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
