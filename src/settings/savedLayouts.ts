/**
 * The grader's own GTKWave save files, kept per assignment in local extension storage so
 * they apply to every student's VCDs. Each holds only signal names and display settings;
 * the assignment record also keeps the course and assignment names for the settings page.
 */

export interface SavedLayout {
  id: string;
  name: string;
  text: string;
  /** Milliseconds since the epoch. */
  savedAt: number;
}

export interface AssignmentLabels {
  course: string | null;
  assignment: string | null;
}

export interface AssignmentLayouts extends AssignmentLabels {
  /** "origin|courseId|assignmentId", from assignmentKey(). */
  key: string;
  layouts: SavedLayout[];
}

export const MAX_LAYOUT_BYTES = 512 * 1024;
const PREFIX = 'gtkw|';

const storageKey = (assignmentKey: string) => `${PREFIX}${assignmentKey}`;

/** Accepts the current record and the earlier single-layout format ({ name, text }). */
function normalize(key: string, raw: unknown): AssignmentLayouts | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<AssignmentLayouts> & { name?: unknown; text?: unknown };
  if (Array.isArray(value.layouts)) {
    const layouts = value.layouts.filter((l): l is SavedLayout => !!l && typeof l.text === 'string' && typeof l.id === 'string');
    return { key, course: value.course ?? null, assignment: value.assignment ?? null, layouts };
  }
  if (typeof value.text === 'string') {
    const name = typeof value.name === 'string' ? value.name : 'My layout';
    return { key, course: null, assignment: null, layouts: [{ id: 'legacy', name, text: value.text, savedAt: 0 }] };
  }
  return null;
}

export async function getAssignmentLayouts(assignmentKey: string): Promise<SavedLayout[]> {
  if (!assignmentKey) return [];
  const key = storageKey(assignmentKey);
  return normalize(assignmentKey, (await browser.storage.local.get(key))[key])?.layouts ?? [];
}

/** Adds a layout, or replaces the one with the same id. Returns the stored layout. */
export async function saveAssignmentLayout(
  assignmentKey: string,
  labels: AssignmentLabels,
  layout: { id?: string; name: string; text: string },
): Promise<SavedLayout> {
  if (!assignmentKey) throw new Error('no assignment is open');
  if (layout.text.length > MAX_LAYOUT_BYTES) throw new Error('the save file is larger than 512 KB');
  const key = storageKey(assignmentKey);
  const record = normalize(assignmentKey, (await browser.storage.local.get(key))[key]) ?? {
    key: assignmentKey,
    course: null,
    assignment: null,
    layouts: [],
  };
  const stored: SavedLayout = {
    id: layout.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: layout.name.trim() || 'My layout',
    text: layout.text,
    savedAt: Date.now(),
  };
  const index = record.layouts.findIndex((l) => l.id === stored.id);
  if (index >= 0) record.layouts[index] = stored;
  else record.layouts.push(stored);
  await browser.storage.local.set({
    [key]: {
      course: labels.course ?? record.course,
      assignment: labels.assignment ?? record.assignment,
      layouts: record.layouts,
    },
  });
  return stored;
}

export async function deleteAssignmentLayout(assignmentKey: string, id: string): Promise<void> {
  const key = storageKey(assignmentKey);
  const record = normalize(assignmentKey, (await browser.storage.local.get(key))[key]);
  if (!record) return;
  const layouts = record.layouts.filter((l) => l.id !== id);
  if (layouts.length) await browser.storage.local.set({ [key]: { course: record.course, assignment: record.assignment, layouts } });
  else await browser.storage.local.remove(key);
}

export async function deleteAllAssignmentLayouts(assignmentKey: string): Promise<void> {
  await browser.storage.local.remove(storageKey(assignmentKey));
}

/** Every assignment with saved layouts, for the settings page. */
export async function listAllLayouts(): Promise<AssignmentLayouts[]> {
  const everything = await browser.storage.local.get(null);
  const records: AssignmentLayouts[] = [];
  for (const [key, value] of Object.entries(everything)) {
    if (!key.startsWith(PREFIX)) continue;
    const record = normalize(key.slice(PREFIX.length), value);
    if (record?.layouts.length) records.push(record);
  }
  return records;
}

export function onLayoutsChanged(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && Object.keys(changes).some((k) => k.startsWith(PREFIX))) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Splits an assignment key into its parts. */
export function parseAssignmentKey(key: string): { origin: string; courseId: string; assignmentId: string } {
  const [origin = '', courseId = '', assignmentId = ''] = key.split('|');
  return { origin, courseId, assignmentId };
}
