import type { GroupEntry, LayoutEntry } from '../render/gtkw';

/**
 * Editing operations on a layout's entry tree (signals, comments, blanks, groups). Entries
 * are identified by object identity; every operation mutates the tree in place.
 */

export type DropPosition = 'before' | 'after' | 'inside';

interface Place {
  list: LayoutEntry[];
  index: number;
}

export function locate(entries: LayoutEntry[], target: LayoutEntry): Place | null {
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry === target) return { list: entries, index };
    if (entry.kind === 'group') {
      const found = locate(entry.children, target);
      if (found) return found;
    }
  }
  return null;
}

/** Entries in display order (depth first), including the contents of collapsed groups. */
export function flatten(entries: LayoutEntry[]): LayoutEntry[] {
  const out: LayoutEntry[] = [];
  const walk = (list: LayoutEntry[]) => {
    for (const entry of list) {
      out.push(entry);
      if (entry.kind === 'group') walk(entry.children);
    }
  };
  walk(entries);
  return out;
}

function contains(group: LayoutEntry, target: LayoutEntry): boolean {
  return group.kind === 'group' && flatten(group.children).includes(target);
}

/** Selected entries in display order, without any that sit inside another selected group. */
export function topmost(entries: LayoutEntry[], selected: Iterable<LayoutEntry>): LayoutEntry[] {
  const set = new Set(selected);
  return flatten(entries).filter((e) => set.has(e) && ![...set].some((other) => other !== e && contains(other, e)));
}

export function removeEntries(entries: LayoutEntry[], selected: Iterable<LayoutEntry>): void {
  for (const entry of topmost(entries, selected)) {
    const place = locate(entries, entry);
    place?.list.splice(place.index, 1);
  }
}

/** Inserts `added` next to `anchor` (or at the end when there is none). */
export function insertEntries(entries: LayoutEntry[], added: LayoutEntry[], anchor: LayoutEntry | null, where: DropPosition = 'after'): void {
  if (anchor && where === 'inside' && anchor.kind === 'group') {
    anchor.children.push(...added);
    return;
  }
  const place = anchor ? locate(entries, anchor) : null;
  if (!place) {
    entries.push(...added);
    return;
  }
  place.list.splice(where === 'before' ? place.index : place.index + 1, 0, ...added);
}

/** Moves entries next to (or into) `target`. Returns false when the move makes no sense. */
export function moveEntries(entries: LayoutEntry[], moving: Iterable<LayoutEntry>, target: LayoutEntry, where: DropPosition): boolean {
  const list = topmost(entries, moving);
  if (!list.length || list.includes(target) || list.some((m) => contains(m, target))) return false;
  if (where === 'inside' && target.kind !== 'group') return false;
  removeEntries(entries, list);
  insertEntries(entries, list, target, where);
  return true;
}

/** Alt+↑/↓: moves the selection past the neighbouring visible row. */
export function moveBy(entries: LayoutEntry[], visible: LayoutEntry[], selected: Iterable<LayoutEntry>, delta: -1 | 1): boolean {
  const list = topmost(entries, selected);
  if (!list.length) return false;
  const indices = list.map((e) => visible.indexOf(e)).filter((i) => i >= 0);
  if (!indices.length) return false;
  if (delta < 0) {
    const target = visible.slice(0, Math.min(...indices)).reverse().find((e) => !list.some((m) => m === e || contains(m, e)));
    return target ? moveEntries(entries, list, target, 'before') : false;
  }
  const last = visible[Math.max(...indices)]!;
  // Skip past the contents of the last selected group.
  const after = visible.slice(Math.max(...indices) + 1).filter((e) => !contains(last, e));
  const target = after.find((e) => !list.some((m) => m === e || contains(m, e)));
  return target ? moveEntries(entries, list, target, 'after') : false;
}

/** Wraps the selection in a new group placed where the first selected entry was. */
export function groupEntries(entries: LayoutEntry[], selected: Iterable<LayoutEntry>, name: string): GroupEntry | null {
  const list = topmost(entries, selected);
  const first = list[0] ? locate(entries, list[0]) : null;
  if (!first) return null;
  const group: GroupEntry = { kind: 'group', name, collapsed: false, children: [] };
  first.list.splice(first.index, 0, group);
  removeEntries(entries, list);
  group.children.push(...list);
  return group;
}

export function ungroup(entries: LayoutEntry[], group: GroupEntry): void {
  const place = locate(entries, group);
  place?.list.splice(place.index, 1, ...group.children);
}

/** Undo/redo over snapshots of the entry tree. */
export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor(private readonly limit = 100) {}

  /** Call before changing `entries`. */
  record(entries: LayoutEntry[]): void {
    this.undoStack.push(JSON.stringify(entries));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(entries: LayoutEntry[]): LayoutEntry[] | null {
    const previous = this.undoStack.pop();
    if (previous === undefined) return null;
    this.redoStack.push(JSON.stringify(entries));
    return JSON.parse(previous) as LayoutEntry[];
  }

  redo(entries: LayoutEntry[]): LayoutEntry[] | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(JSON.stringify(entries));
    return JSON.parse(next) as LayoutEntry[];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
}
