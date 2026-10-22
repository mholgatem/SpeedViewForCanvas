// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseGtkw, radixOf, type GroupEntry, type LayoutEntry, type SignalEntry } from '../src/render/gtkw';
import { parseVcd } from '../src/render/vcd';
import { History, groupEntries, insertEntries, moveBy, moveEntries, removeEntries, ungroup } from '../src/viewer/waveEditor';
import { renderWaveView, type WaveOptions } from '../src/viewer/waves';
import { COUNTER_GTKW, COUNTER_VCD, outline } from './helpers/vcd';

const names = (entries: LayoutEntry[]) => outline(entries);

describe('editing operations', () => {
  const fresh = () => parseGtkw(COUNTER_GTKW).entries;

  it('removes entries, including whole groups', () => {
    const entries = fresh();
    removeEntries(entries, [entries[1]!, entries[6]!, entries[8]!]);
    expect(names(entries)).toEqual(['tb.clk', '-Counter outputs', 'tb.count[3:0]', '+{count (dec)} tb.count[3:0]', '-', '#{nibbles} tb.count[3:0] tb.dut.bus[3:0]']);
  });

  it('moves entries before, after, and into groups', () => {
    const entries = fresh();
    const [clk, rst] = entries;
    const group = entries[6] as GroupEntry;
    expect(moveEntries(entries, [clk!], entries[3]!, 'after')).toBe(true);
    expect(names(entries).slice(0, 4)).toEqual(['tb.rst', '-Counter outputs', 'tb.count[3:0]', 'tb.clk']);
    expect(moveEntries(entries, [rst!], group, 'inside')).toBe(true);
    expect(names(group.children)).toContain('tb.rst');
    // A group can't move into itself.
    expect(moveEntries(entries, [group], group.children[0]!, 'before')).toBe(false);
  });

  it('moves the selection one row with Alt+arrows', () => {
    const entries = fresh();
    const rst = entries[1]!;
    expect(moveBy(entries, entries, [rst], -1)).toBe(true);
    expect(names(entries).slice(0, 2)).toEqual(['tb.rst', 'tb.clk']);
    expect(moveBy(entries, entries, [rst], -1)).toBe(false);
  });

  it('groups and ungroups', () => {
    const entries = fresh();
    const group = groupEntries(entries, [entries[0]!, entries[1]!], 'Inputs')!;
    expect(names(entries)[0]).toEqual({ group: 'Inputs', collapsed: false, children: ['tb.clk', 'tb.rst'] });
    ungroup(entries, group);
    expect(names(entries).slice(0, 2)).toEqual(['tb.clk', 'tb.rst']);
  });

  it('inserts after an anchor or at the end', () => {
    const entries = fresh();
    insertEntries(entries, [{ kind: 'comment', text: 'Clocks' }], entries[0]!, 'before');
    insertEntries(entries, [{ kind: 'blank' }], null);
    expect(names(entries)[0]).toBe('-Clocks');
    expect(names(entries).at(-1)).toBe('-');
  });

  it('undoes and redoes', () => {
    let entries = fresh();
    const history = new History();
    history.record(entries);
    removeEntries(entries, [entries[0]!]);
    entries = history.undo(entries)!;
    expect(names(entries)[0]).toBe('tb.clk');
    entries = history.redo(entries)!;
    expect(names(entries)[0]).toBe('tb.rst');
    expect(history.redo(entries)).toBeNull();
  });
});

describe('renderWaveView', () => {
  beforeAll(() => {
    // jsdom has no canvas; the view skips drawing and still lays out names and values.
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  });

  const setup = (overrides: Partial<WaveOptions> = {}) => {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const options: WaveOptions = {
      vcdName: 'counter.vcd',
      choices: [
        { id: 'student:0', label: 'Student: counter.gtkw', layout: parseGtkw(COUNTER_GTKW) },
        { id: 'all', label: 'All signals', layout: null },
      ],
      selected: 'student:0',
      onChoose: vi.fn(),
      onLoadFile: vi.fn(),
      onSave: vi.fn(async () => {}),
      onDelete: vi.fn(),
      onExport: vi.fn(),
      ...overrides,
    };
    const view = renderWaveView(container, parseVcd(COUNTER_VCD), options);
    const nameRows = () => [...container.querySelectorAll<HTMLElement>('.wave-name')];
    const nameTexts = () => nameRows().map((r) => r.querySelector('.wave-label')?.textContent ?? '');
    const valueTexts = () => [...container.querySelectorAll('.wave-value')].map((r) => r.textContent);
    const row = (label: string) => nameRows().find((r) => r.querySelector('.wave-label')?.textContent === label)!;
    const body = container.querySelector<HTMLElement>('.wave-body')!;
    const key = (k: string, init: KeyboardEventInit = {}) => body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
    const menu = (label: string, item: string) => {
      row(label).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const button = [...container.querySelectorAll<HTMLButtonElement>('.wave-menu-item')].find((b) => b.textContent === item);
      if (!button) throw new Error(`no menu item ${item}`);
      button.click();
    };
    return { container, view, options, nameTexts, valueTexts, row, key, menu, body };
  };

  it('shows the save file’s rows with values at its marker', () => {
    const { nameTexts, valueTexts, container, view } = setup();
    expect(nameTexts()).toEqual(['clk', 'rst', 'Counter outputs', 'count[3:0]', 'count (dec)', '', 'Internals', 'bus[7:0]', 'bus[0]', 'Closed group', 'nibbles', 'missing_signal']);
    // Marker at 20 ns.
    expect(container.querySelector('.wave-cursor-time')!.textContent).toBe('@ 20 ns');
    expect(valueTexts().slice(0, 5)).toEqual(['0', '0', '', '1', '1']);
    expect(valueTexts()[11]).toBe('—');
    expect(container.querySelector('.wave-name.missing')).not.toBeNull();
    expect(view.rowCount).toBe(12);
    view.destroy();
  });

  it('expands a closed group from its twisty', () => {
    const { nameTexts, row } = setup();
    row('Closed group').querySelector<HTMLElement>('.wave-twisty')!.click();
    expect(nameTexts()).toContain('vout');
  });

  it('switches to all signals', () => {
    const { container, nameTexts, options } = setup();
    const picker = container.querySelector<HTMLSelectElement>('.wave-layout')!;
    picker.value = 'all';
    picker.dispatchEvent(new Event('change'));
    expect(nameTexts()).toEqual(['tb', 'clk', 'rst', 'count[3:0]', 'dut', 'clk', 'q[3:0]', 'bus[7:0]', 'vout']);
    expect(options.onChoose).toHaveBeenCalledWith('all');
  });

  it('adds signals from the browser, filtered by name', () => {
    const { container, nameTexts, row } = setup();
    row('rst').click();
    container.querySelector<HTMLButtonElement>('.wave-bar button[title^="Show the signal browser"]')!.click();
    const search = container.querySelector<HTMLInputElement>('.wave-search')!;
    search.value = 'q[';
    search.dispatchEvent(new Event('input'));
    const results = [...container.querySelectorAll<HTMLElement>('.wave-browser-row.signal')];
    expect(results.map((r) => r.querySelector('.wave-label')!.textContent)).toEqual(['tb.dut.q[3:0]']);
    results[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(nameTexts().slice(0, 3)).toEqual(['clk', 'rst', 'q[3:0]']);
    expect(container.querySelector('.wave-edited')!.hasAttribute('hidden')).toBe(false);
    // Already-shown signals are ticked.
    expect(container.querySelector('.wave-browser-row.signal .wave-check')!.textContent).toBe('✓');
  });

  it('removes, reorders, and undoes with the keyboard', () => {
    const { nameTexts, row, key } = setup();
    row('rst').click();
    key('ArrowUp', { altKey: true });
    expect(nameTexts().slice(0, 2)).toEqual(['rst', 'clk']);
    key('Delete');
    expect(nameTexts()[0]).toBe('clk');
    key('z', { ctrlKey: true });
    expect(nameTexts().slice(0, 2)).toEqual(['rst', 'clk']);
    key('z', { ctrlKey: true, shiftKey: true });
    expect(nameTexts()[0]).toBe('clk');
  });

  it('changes the radix of the selected rows from the menu', () => {
    const { menu, valueTexts } = setup();
    menu('count[3:0]', 'Binary');
    expect(valueTexts()[3]).toBe('0001');
    menu('bus[7:0]', 'Signed decimal');
    expect(valueTexts()[7]).toBe('-91');
  });

  it('inserts comments, blank rows, and groups from the menu', () => {
    const { menu, nameTexts, container, row } = setup();
    menu('clk', 'Insert comment…');
    const input = container.querySelector<HTMLInputElement>('.wave-inline')!;
    input.value = 'Clocks';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(nameTexts().slice(0, 3)).toEqual(['clk', 'Clocks', 'rst']);
    menu('rst', 'Insert blank row');
    expect(nameTexts().slice(2, 4)).toEqual(['rst', '']);
    row('clk').click();
    menu('clk', 'Group selection…');
    const groupName = container.querySelector<HTMLInputElement>('.wave-inline')!;
    groupName.value = 'Clock';
    groupName.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(nameTexts().slice(0, 2)).toEqual(['Clock', 'clk']);
    expect(container.querySelector('.wave-name.kind-group')!.textContent).toContain('Clock');
  });

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const savedLayout = { id: 'mine:a1', label: 'Mine: Counter view', layout: parseGtkw(COUNTER_GTKW), savedId: 'a1' };

  it('saves the edited list as a new named layout for the assignment', async () => {
    const { menu, container, options } = setup();
    menu('count[3:0]', 'Remove');
    // Only "save as" is offered for a student's save file.
    expect(container.querySelector<HTMLButtonElement>('.wave-bar button[title="Save your changes to this layout"]')!.hidden).toBe(true);
    container.querySelector<HTMLButtonElement>('.wave-bar button[title^="Save this signal list"]')!.click();
    const name = container.querySelector<HTMLInputElement>('.wave-confirm input')!;
    expect(name.value).toBe('Layout 1');
    name.value = 'Counter only';
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();
    const [text, target] = (options.onSave as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, { id?: string; name: string }];
    expect(target).toEqual({ name: 'Counter only' });
    const saved = parseGtkw(text);
    // Nothing from the student's file name is kept with the assignment.
    expect(saved.dumpfile).toBeNull();
    expect(saved.marker).toBe(20);
    expect(outline(saved.entries)).not.toContain('tb.count[3:0]');
    expect(radixOf((saved.entries[0] as SignalEntry).flags)).toBe('bin');
    expect(container.querySelector('.wave-edited')!.hasAttribute('hidden')).toBe(true);
  });

  it('updates a saved layout in place with Save', async () => {
    const { menu, container, options } = setup({ choices: [savedLayout, { id: 'all', label: 'All signals', layout: null }], selected: 'mine:a1' });
    menu('clk', 'Remove');
    const save = container.querySelector<HTMLButtonElement>('.wave-bar button[title="Save your changes to this layout"]')!;
    expect(save.hidden).toBe(false);
    save.click();
    await flush();
    expect((options.onSave as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual({ id: 'a1', name: 'Counter view' });
  });

  it('lists saved layouts on hover and deletes one after a second click', () => {
    const { container, options } = setup({ choices: [savedLayout, { id: 'all', label: 'All signals', layout: null }], selected: 'all' });
    const menuEl = container.querySelector<HTMLElement>('.wave-saved')!;
    expect(menuEl.hidden).toBe(false);
    expect([...menuEl.querySelectorAll('.wave-saved-name')].map((b) => b.textContent)).toEqual(['Counter view']);
    const remove = menuEl.querySelector<HTMLButtonElement>('.wave-saved-delete')!;
    remove.click();
    expect(options.onDelete).not.toHaveBeenCalled();
    expect(remove.textContent).toBe('Delete');
    remove.click();
    expect(options.onDelete).toHaveBeenCalledWith('a1');
  });

  it('hides the saved-layout menu when there are none', () => {
    const { container } = setup();
    expect(container.querySelector<HTMLElement>('.wave-saved')!.hidden).toBe(true);
  });

  it('asks before discarding edits when switching layouts', () => {
    const { menu, container, nameTexts } = setup();
    menu('clk', 'Remove');
    const picker = container.querySelector<HTMLSelectElement>('.wave-layout')!;
    picker.value = 'all';
    picker.dispatchEvent(new Event('change'));
    const confirm = container.querySelector<HTMLElement>('.wave-confirm')!;
    expect(confirm.hidden).toBe(false);
    expect(nameTexts()[0]).toBe('rst');
    [...confirm.querySelectorAll('button')].find((b) => b.textContent === 'Discard')!.click();
    expect(nameTexts()[0]).toBe('tb');
  });
});
