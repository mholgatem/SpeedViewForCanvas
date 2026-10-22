import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAllAssignmentLayouts,
  deleteAssignmentLayout,
  getAssignmentLayouts,
  listAllLayouts,
  parseAssignmentKey,
  saveAssignmentLayout,
} from '../src/settings/savedLayouts';

/** In-memory stand-in for browser.storage.local. */
function fakeStorage() {
  const data: Record<string, unknown> = {};
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return {
    data,
    local: {
      get: async (key: string | null) => (key === null ? clone(data) : key in data ? { [key]: clone(data[key]) } : {}),
      set: async (items: Record<string, unknown>) => void Object.assign(data, clone(items)),
      remove: async (key: string) => void delete data[key],
    },
  };
}

const KEY = 'https://canvas.example.edu|12|34';
const LABELS = { course: 'EEE 120', assignment: 'Lab 4' };
let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal('browser', { storage: { local: storage.local } });
});

describe('saved waveform layouts', () => {
  it('keeps several named layouts per assignment, with its names', async () => {
    const a = await saveAssignmentLayout(KEY, LABELS, { name: 'Counter', text: 'tb.count' });
    const b = await saveAssignmentLayout(KEY, LABELS, { name: 'ALU', text: 'tb.alu' });
    expect(a.id).not.toBe(b.id);
    expect((await getAssignmentLayouts(KEY)).map((l) => l.name)).toEqual(['Counter', 'ALU']);
    const [record] = await listAllLayouts();
    expect(record).toMatchObject({ key: KEY, course: 'EEE 120', assignment: 'Lab 4' });
  });

  it('updates a layout in place by id', async () => {
    const a = await saveAssignmentLayout(KEY, LABELS, { name: 'Counter', text: 'v1' });
    await saveAssignmentLayout(KEY, { course: null, assignment: null }, { id: a.id, name: 'Counter', text: 'v2' });
    const layouts = await getAssignmentLayouts(KEY);
    expect(layouts).toHaveLength(1);
    expect(layouts[0]!.text).toBe('v2');
    // Unknown labels don't erase the ones already stored.
    expect((await listAllLayouts())[0]!.course).toBe('EEE 120');
  });

  it('deletes one layout, and removes the assignment with its last one', async () => {
    const a = await saveAssignmentLayout(KEY, LABELS, { name: 'A', text: 'a' });
    const b = await saveAssignmentLayout(KEY, LABELS, { name: 'B', text: 'b' });
    await deleteAssignmentLayout(KEY, a.id);
    expect((await getAssignmentLayouts(KEY)).map((l) => l.name)).toEqual(['B']);
    await deleteAssignmentLayout(KEY, b.id);
    expect(storage.data).toEqual({});
  });

  it('deletes everything for an assignment', async () => {
    await saveAssignmentLayout(KEY, LABELS, { name: 'A', text: 'a' });
    await saveAssignmentLayout('https://canvas.example.edu|12|35', LABELS, { name: 'B', text: 'b' });
    await deleteAllAssignmentLayouts(KEY);
    expect((await listAllLayouts()).map((r) => r.key)).toEqual(['https://canvas.example.edu|12|35']);
  });

  it('reads layouts saved in the earlier one-per-assignment format', async () => {
    storage.data[`gtkw|${KEY}`] = { name: 'old.gtkw', text: 'tb.clk' };
    expect((await getAssignmentLayouts(KEY)).map((l) => [l.id, l.name])).toEqual([['legacy', 'old.gtkw']]);
    await saveAssignmentLayout(KEY, LABELS, { name: 'New', text: 'x' });
    expect((await getAssignmentLayouts(KEY)).map((l) => l.name)).toEqual(['old.gtkw', 'New']);
  });

  it('ignores other stored settings and rejects oversized files', async () => {
    storage.data.theme = 'dark';
    expect(await listAllLayouts()).toEqual([]);
    await expect(saveAssignmentLayout(KEY, LABELS, { name: 'Big', text: 'x'.repeat(600 * 1024) })).rejects.toThrow(/512 KB/);
    expect(parseAssignmentKey(KEY)).toEqual({ origin: 'https://canvas.example.edu', courseId: '12', assignmentId: '34' });
  });
});
