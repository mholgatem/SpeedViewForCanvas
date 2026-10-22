import { FLAG, RADIXES, serializeGtkw, setFlag, withRadix, type GtkwLayout, type LayoutEntry, type Radix } from '../render/gtkw';
import { formatTime, indexAfter, indexAt, type ScopeNode, type Vcd, type VcdSignal } from '../render/vcd';
import { defaultLayout, displayValue, gtkwName, layoutRows, makeResolver, signalEntry, valueBits, type Row } from '../render/waveLayout';
import { History, flatten, groupEntries, insertEntries, moveBy, moveEntries, removeEntries, ungroup, type DropPosition } from './waveEditor';

/**
 * Waveform view for VCD files: signal names, values at the cursor, and the waves drawn on a
 * canvas, laid out from a GTKWave save file or one group per scope. The signal list can be
 * edited (add, remove, reorder, radix, comments, groups) and saved back as a .gtkw.
 */

export interface LayoutChoice {
  id: string;
  label: string;
  /** null means "all signals". */
  layout: GtkwLayout | null;
  /** Set for the grader's saved layouts (these can be updated and deleted). */
  savedId?: string;
}

export interface WaveOptions {
  /** File name written to [dumpfile] when exporting. */
  vcdName: string;
  choices: LayoutChoice[];
  selected: string;
  onChoose(id: string): void;
  onLoadFile(file: File): void;
  /** Saves a layout for the assignment: updates `id` when given, otherwise adds one. */
  onSave(text: string, target: { id?: string; name: string }): Promise<void>;
  onDelete(savedId: string): void;
  onExport(text: string, fileName: string): void;
}

export interface WaveView {
  readonly dirty: boolean;
  readonly rowCount: number;
  /** Id of the layout choice being shown. */
  readonly choiceId: string;
  /** Replaces the layout picker's choices; `apply` switches the view to `selected`. */
  setChoices(choices: LayoutChoice[], selected: string, apply: boolean): void;
  destroy(): void;
}

const ROW_H = 22;
const RULER_H = 24;
const MIN_SPAN = 2;
const LOAD = '__load';
const RADIX_LABELS: Record<Radix, string> = {
  hex: 'Hexadecimal',
  dec: 'Decimal',
  signed: 'Signed decimal',
  bin: 'Binary',
  oct: 'Octal',
  ascii: 'ASCII',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', '', text);
  b.title = title;
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

const clone = (entries: LayoutEntry[]) => JSON.parse(JSON.stringify(entries)) as LayoutEntry[];

export function renderWaveView(container: HTMLElement, vcd: Vcd, options: WaveOptions): WaveView {
  const resolver = makeResolver(vcd);
  const fullEnd = vcd.endTime > 0 ? vcd.endTime : 1;
  let choices = options.choices;
  let choiceId = options.selected;
  let entries: LayoutEntry[] = [];
  let rows: Row[] = [];
  let history = new History();
  let dirty = false;
  const selection = new Set<LayoutEntry>();
  let anchor: LayoutEntry | null = null;
  let start = 0;
  let span = fullEnd;
  let cursor: number | null = null;
  /** GTKWave zoom waiting for the canvas width to be known. */
  let pendingZoom: number | null = null;
  let frame = 0;
  let destroyed = false;

  // ---- DOM ----
  const root = el('div', 'wave-view');
  const bar = el('div', 'wave-bar');
  const picker = el('select', 'wave-layout');
  picker.title = 'Signal layout';
  const browseButton = button('Signals', 'Show the signal browser to add signals', () => toggleBrowser());
  browseButton.setAttribute('aria-pressed', 'false');
  const zoomGroup = el('span', 'wave-zoom');
  zoomGroup.append(
    button('−', 'Zoom out (−)', () => zoomBy(2)),
    button('+', 'Zoom in (+)', () => zoomBy(0.5)),
    button('Fit', 'Show the whole simulation (F)', () => fit()),
  );
  const edited = el('span', 'wave-edited', 'Edited');
  edited.hidden = true;
  const saveButton = button('Save', 'Save your changes to this layout', () => void requestSave(false));
  const saveAsButton = button('Save as my layout…', 'Save this signal list as one of your layouts for this assignment', () => void requestSave(true));
  // Saved layouts, listed on hover with a delete button for each.
  const savedMenu = el('div', 'wave-saved');
  const savedToggle = button('My layouts ▾', 'Your saved layouts for this assignment', () => savedMenu.classList.toggle('open'));
  savedToggle.setAttribute('aria-haspopup', 'true');
  const savedList = el('div', 'wave-saved-list');
  savedList.setAttribute('role', 'menu');
  savedMenu.append(savedToggle, savedList);
  savedMenu.addEventListener('pointerleave', () => savedMenu.classList.remove('open'));
  const exportButton = button('Export .gtkw', 'Download this signal list as a GTKWave save file', () => exportGtkw());
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = '.gtkw';
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) options.onLoadFile(file);
  });
  bar.append(picker, browseButton, zoomGroup, edited, el('span', 'spacer'), saveButton, saveAsButton, savedMenu, exportButton, fileInput);

  const confirmBar = el('div', 'wave-confirm');
  confirmBar.hidden = true;

  const main = el('div', 'wave-main');
  const browser = el('aside', 'wave-browser');
  browser.hidden = true;
  const search = el('input', 'wave-search');
  search.type = 'search';
  search.placeholder = 'Filter signals';
  const browserList = el('div', 'wave-browser-list');
  const addButton = button('Add', 'Add the selected signals below the selected row', () => {
    addFromBrowser([...browserSelection]);
    browserSelection.clear();
    renderBrowser();
  });
  const browserFoot = el('div', 'wave-browser-foot');
  browserFoot.append(addButton);
  browser.append(search, browserList, browserFoot);

  const body = el('div', 'wave-body');
  body.tabIndex = 0;
  const headNames = el('div', 'wave-head wave-head-names', 'Signals');
  const headValues = el('div', 'wave-head wave-head-values');
  const resizer = el('div', 'wave-resizer');
  resizer.title = 'Drag to resize';
  headValues.append(resizer);
  const headRuler = el('div', 'wave-head wave-head-ruler');
  const rulerCanvas = el('canvas', 'wave-ruler');
  headRuler.append(rulerCanvas);
  const namesCol = el('div', 'wave-names');
  const valuesCol = el('div', 'wave-values');
  const wavesCol = el('div', 'wave-waves');
  const sticky = el('div', 'wave-sticky');
  const canvas = el('canvas', 'wave-canvas');
  sticky.append(canvas);
  wavesCol.append(sticky);
  body.append(headNames, headValues, headRuler, namesCol, valuesCol, wavesCol);
  const hscroll = el('div', 'wave-hscroll');
  const hinner = el('div', 'wave-hscroll-inner');
  hscroll.append(hinner);
  const bodyWrap = el('div', 'wave-body-wrap');
  bodyWrap.append(body, hscroll);
  main.append(browser, bodyWrap);

  const menu = el('div', 'wave-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');

  root.append(bar, confirmBar, main, menu);
  container.append(root);

  const ctx = canvas.getContext('2d');
  const rulerCtx = rulerCanvas.getContext('2d');

  // ---- Layout choice ----

  const currentSaved = () => choices.find((c) => c.id === choiceId)?.savedId;

  function renderPicker() {
    picker.replaceChildren(...choices.map((c) => new Option(c.label, c.id)), new Option('Load .gtkw from computer…', LOAD));
    picker.value = choiceId;
    const saved = currentSaved();
    saveButton.hidden = !saved;
    saveAsButton.textContent = saved ? 'Save as new…' : 'Save as my layout…';
    renderSavedMenu();
  }

  function renderSavedMenu() {
    const saved = choices.filter((c) => c.savedId);
    savedMenu.hidden = !saved.length;
    savedList.replaceChildren(
      ...saved.map((choice) => {
        const item = el('div', 'wave-saved-item');
        if (choice.id === choiceId) item.classList.add('current');
        const open = el('button', 'wave-saved-name', choice.label.replace(/^Mine: /, ''));
        open.type = 'button';
        open.title = 'Show this layout';
        open.setAttribute('role', 'menuitem');
        open.addEventListener('click', () => {
          savedMenu.classList.remove('open');
          if (choice.id !== choiceId) choose(choice.id);
        });
        // Two clicks to delete, so a stray click while hovering can't lose a layout.
        const remove = el('button', 'wave-saved-delete', '✕');
        remove.type = 'button';
        remove.title = 'Delete this layout';
        remove.setAttribute('aria-label', `Delete ${open.textContent}`);
        remove.addEventListener('click', () => {
          if (!remove.classList.contains('confirm')) {
            remove.classList.add('confirm');
            remove.textContent = 'Delete';
            remove.title = 'Click again to delete';
            return;
          }
          savedMenu.classList.remove('open');
          options.onDelete(choice.savedId!);
        });
        remove.addEventListener('blur', () => {
          remove.classList.remove('confirm');
          remove.textContent = '✕';
          remove.title = 'Delete this layout';
        });
        item.append(open, remove);
        return item;
      }),
    );
  }

  /** Switches layouts, asking first if there are unsaved edits. */
  function choose(id: string) {
    const act = () => {
      applyChoice(id);
      options.onChoose(id);
    };
    if (dirty) confirmDiscard(act);
    else act();
  }

  function applyChoice(id: string) {
    const choice = choices.find((c) => c.id === id) ?? choices[0];
    if (!choice) return;
    choiceId = choice.id;
    entries = choice.layout ? clone(choice.layout.entries) : defaultLayout(vcd);
    history = new History();
    selection.clear();
    anchor = null;
    setDirty(false);
    const layout = choice.layout;
    cursor = layout?.marker != null ? layout.marker / vcd.timescale.magnitude : null;
    start = layout?.timestart != null ? layout.timestart / vcd.timescale.magnitude : 0;
    pendingZoom = layout?.zoom ?? null;
    span = fullEnd - start > 0 ? fullEnd - start : fullEnd;
    if (pendingZoom === null) fit(false);
    renderPicker();
    renderRows();
  }

  picker.addEventListener('change', () => {
    const value = picker.value;
    picker.value = choiceId;
    if (value !== LOAD) choose(value);
    else if (dirty) confirmDiscard(() => fileInput.click());
    else fileInput.click();
  });

  function confirmDiscard(then: () => void) {
    confirmBar.replaceChildren(
      el('span', '', 'Discard your edits to this signal list?'),
      button('Save', 'Save, then continue', () => {
        confirmBar.hidden = true;
        void requestSave(!currentSaved(), then);
      }),
      button('Discard', 'Continue without saving', () => {
        confirmBar.hidden = true;
        setDirty(false);
        then();
      }),
      button('Cancel', 'Keep editing', () => (confirmBar.hidden = true)),
    );
    confirmBar.hidden = false;
  }

  function setDirty(value: boolean) {
    dirty = value;
    edited.hidden = !value;
  }

  function currentLayout(): GtkwLayout {
    const width = Math.max(1, wavesCol.clientWidth);
    const unitsPerPx = (span / width) * vcd.timescale.magnitude;
    return {
      dumpfile: options.vcdName,
      timestart: start * vcd.timescale.magnitude,
      zoom: -Math.log2(unitsPerPx),
      marker: cursor === null ? null : cursor * vcd.timescale.magnitude,
      entries,
    };
  }

  /** Saves over the current saved layout, or asks for a name and adds a new one. */
  async function requestSave(asNew: boolean, then?: () => void) {
    // Stored with the assignment, so leave out the student's file name.
    const text = serializeGtkw({ ...currentLayout(), dumpfile: null });
    const saved = choices.find((c) => c.id === choiceId && c.savedId);
    if (!asNew && saved) {
      await options.onSave(text, { id: saved.savedId, name: saved.label.replace(/^Mine: /, '') });
      setDirty(false);
      then?.();
      return;
    }
    const count = choices.filter((c) => c.savedId).length;
    const input = el('input', 'wave-name-input');
    input.value = `Layout ${count + 1}`;
    input.setAttribute('aria-label', 'Layout name');
    const confirm = async () => {
      const name = input.value.trim();
      if (!name) return input.focus();
      confirmBar.hidden = true;
      await options.onSave(text, { name });
      setDirty(false);
      then?.();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void confirm();
      else if (e.key === 'Escape') confirmBar.hidden = true;
    });
    confirmBar.replaceChildren(
      el('span', '', 'Name this layout:'),
      input,
      button('Save', 'Save this layout for every student in the assignment', () => void confirm()),
      button('Cancel', 'Don’t save', () => (confirmBar.hidden = true)),
    );
    confirmBar.hidden = false;
    input.focus();
    input.select();
  }

  function exportGtkw() {
    const stem = options.vcdName.replace(/\.[^.]*$/, '') || 'waves';
    options.onExport(serializeGtkw(currentLayout()), `${stem}.gtkw`);
  }

  // ---- Editing ----

  /** Runs an edit with undo support, then redraws. */
  function edit(change: () => boolean | void) {
    const before = JSON.stringify(entries);
    if (change() === false) return;
    if (JSON.stringify(entries) === before) return;
    history.record(JSON.parse(before) as LayoutEntry[]);
    setDirty(true);
    renderRows();
  }

  function restore(next: LayoutEntry[] | null) {
    if (!next) return;
    entries = next;
    selection.clear();
    anchor = null;
    setDirty(true);
    renderRows();
  }

  const selectedTraces = (row: Row) =>
    selection.has(row.entry)
      ? rows.filter((r): r is Extract<Row, { kind: 'trace' }> => r.kind === 'trace' && selection.has(r.entry))
      : row.kind === 'trace'
        ? [row]
        : [];

  function lastSelected(): LayoutEntry | null {
    const flat = flatten(entries);
    let last: LayoutEntry | null = null;
    for (const e of flat) if (selection.has(e)) last = e;
    return last;
  }

  function addFromBrowser(signals: VcdSignal[]) {
    if (!signals.length) return;
    const added = signals.map(signalEntry);
    const anchorEntry = lastSelected();
    edit(() => insertEntries(entries, added, anchorEntry, anchorEntry?.kind === 'group' && !anchorEntry.collapsed ? 'inside' : 'after'));
    selection.clear();
    for (const a of added) selection.add(a);
    anchor = added[0] ?? null;
    renderRows();
    const index = rows.findIndex((r) => r.entry === added[0]);
    (namesCol.children[index] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
  }

  // ---- Rows (names and values columns) ----

  function renderRows() {
    rows = layoutRows(entries, resolver);
    namesCol.replaceChildren(
      ...rows.map((row, index) => {
        const div = el('div', `wave-row wave-name kind-${row.kind}`);
        div.dataset.index = String(index);
        div.draggable = true;
        div.style.paddingLeft = `${6 + row.depth * 12}px`;
        if (selection.has(row.entry)) div.classList.add('selected');
        if (row.kind === 'group') {
          div.append(el('span', 'wave-twisty', row.entry.collapsed ? '▸' : '▾'), el('span', 'wave-label', row.label));
        } else if (row.kind === 'comment') {
          div.append(el('span', 'wave-label', row.label));
        } else if (row.kind === 'trace') {
          if (row.highlight) div.classList.add('highlight');
          if (!row.trace) {
            div.classList.add('missing');
            div.title = `${row.entry.name} is not in this VCD`;
          } else div.title = row.entry.kind === 'concat' ? `{${row.entry.parts.join(', ')}}` : row.entry.name;
          div.append(el('span', 'wave-scope', row.scope), el('span', 'wave-label', row.label));
        }
        const more = el('button', 'wave-more', '⋯');
        more.type = 'button';
        more.title = 'Options';
        more.tabIndex = -1;
        div.append(more);
        return div;
      }),
    );
    wavesCol.style.height = `${rows.length * ROW_H}px`;
    renderValues();
    scheduleDraw();
  }

  function renderValues() {
    headValues.firstChild?.remove();
    headValues.prepend(el('span', 'wave-cursor-time', cursor === null ? 'Value' : `@ ${formatTime(cursor, vcd.timescale)}`));
    valuesCol.replaceChildren(
      ...rows.map((row) => {
        const div = el('div', 'wave-row wave-value');
        if (row.kind === 'trace') {
          if (row.highlight) div.classList.add('highlight');
          if (selection.has(row.entry)) div.classList.add('selected');
          if (row.trace && cursor !== null) {
            const i = indexAt(row.trace.times, cursor);
            if (i >= 0) {
              const text = displayValue(row, i);
              div.textContent = text;
              div.title = text;
            }
          } else if (!row.trace) div.textContent = '—';
        } else if (selection.has(row.entry)) div.classList.add('selected');
        return div;
      }),
    );
  }

  function rowIndexOf(target: EventTarget | null): number {
    const rowEl = (target as HTMLElement | null)?.closest<HTMLElement>('.wave-row');
    return rowEl?.dataset.index === undefined ? -1 : Number(rowEl.dataset.index);
  }

  namesCol.addEventListener('click', (e) => {
    const index = rowIndexOf(e.target);
    const row = rows[index];
    if (!row) return;
    if ((e.target as HTMLElement).closest('.wave-more')) {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      if (!selection.has(row.entry)) {
        selectOnly(row.entry);
        renderRows();
      }
      openMenu(rows[index]!, rect.left, rect.bottom);
      return;
    }
    if (row.kind === 'group' && (e.target as HTMLElement).closest('.wave-twisty')) {
      row.entry.collapsed = !row.entry.collapsed;
      renderRows();
      return;
    }
    if (e.shiftKey && anchor) {
      const from = rows.findIndex((r) => r.entry === anchor);
      if (!(e.ctrlKey || e.metaKey)) selection.clear();
      const [a, b] = from < index ? [from, index] : [index, from];
      for (let i = Math.max(0, a); i <= b; i++) selection.add(rows[i]!.entry);
    } else if (e.ctrlKey || e.metaKey) {
      if (selection.has(row.entry)) selection.delete(row.entry);
      else selection.add(row.entry);
      anchor = row.entry;
    } else {
      selectOnly(row.entry);
    }
    renderRows();
  });

  namesCol.addEventListener('dblclick', (e) => {
    const row = rows[rowIndexOf(e.target)];
    if (row?.kind === 'group') {
      row.entry.collapsed = !row.entry.collapsed;
      renderRows();
    } else if (row && row.kind !== 'blank') startRename(row);
  });

  namesCol.addEventListener('contextmenu', (e) => {
    const index = rowIndexOf(e.target);
    const row = rows[index];
    if (!row) return;
    e.preventDefault();
    if (!selection.has(row.entry)) {
      selectOnly(row.entry);
      renderRows();
    }
    // Rows are rebuilt on render; use the fresh one.
    openMenu(rows[index]!, e.clientX, e.clientY);
  });

  function selectOnly(entry: LayoutEntry) {
    selection.clear();
    selection.add(entry);
    anchor = entry;
  }

  // Drag to reorder.
  let dragging: LayoutEntry[] = [];
  let drop: { index: number; where: DropPosition } | null = null;
  const clearDropMarks = () => namesCol.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-inside'));

  namesCol.addEventListener('dragstart', (e) => {
    const row = rows[rowIndexOf(e.target)];
    if (!row) return;
    if (!selection.has(row.entry)) {
      selectOnly(row.entry);
      namesCol.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
      (e.target as HTMLElement).classList.add('selected');
    }
    dragging = [...selection];
    e.dataTransfer?.setData('text/plain', row.kind === 'trace' ? row.entry.name : '');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  namesCol.addEventListener('dragover', (e) => {
    if (!dragging.length) return;
    const index = rowIndexOf(e.target);
    const rowEl = namesCol.children[index] as HTMLElement | undefined;
    const row = rows[index];
    if (!rowEl || !row) return;
    e.preventDefault();
    const rect = rowEl.getBoundingClientRect();
    const fraction = rect.height ? (e.clientY - rect.top) / rect.height : 0;
    const where: DropPosition =
      row.kind === 'group' && fraction > 0.3 && fraction < 0.7 ? 'inside' : fraction < 0.5 ? 'before' : 'after';
    drop = { index, where };
    clearDropMarks();
    rowEl.classList.add(`drop-${where}`);
  });
  namesCol.addEventListener('dragleave', (e) => {
    if (!namesCol.contains(e.relatedTarget as Node | null)) clearDropMarks();
  });
  namesCol.addEventListener('drop', (e) => {
    e.preventDefault();
    const target = drop ? rows[drop.index] : null;
    if (target && drop) {
      const where = drop.where;
      edit(() => moveEntries(entries, dragging, target.entry, where));
    }
    dragging = [];
    drop = null;
    clearDropMarks();
  });
  namesCol.addEventListener('dragend', () => {
    dragging = [];
    drop = null;
    clearDropMarks();
  });

  // ---- Inline text editing (rename, comments, groups) ----

  function inlineInput(rowEl: HTMLElement, initial: string, placeholder: string, commit: (text: string) => void) {
    const input = el('input', 'wave-inline');
    input.value = initial;
    input.placeholder = placeholder;
    const label = rowEl.querySelector('.wave-label');
    rowEl.draggable = false;
    if (label) label.replaceWith(input);
    else rowEl.append(input);
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (ok) commit(input.value.trim());
      else renderRows();
      body.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.focus();
    input.select();
  }

  function startRename(row: Row) {
    const rowEl = namesCol.children[rows.indexOf(row)] as HTMLElement | undefined;
    if (!rowEl) return;
    const entry = row.entry;
    if (entry.kind === 'group') {
      inlineInput(rowEl, entry.name, 'Group name', (text) => edit(() => void (entry.name = text || entry.name)));
    } else if (entry.kind === 'comment') {
      inlineInput(rowEl, entry.text, 'Comment', (text) => edit(() => void (entry.text = text || entry.text)));
    } else if (entry.kind === 'signal' || entry.kind === 'concat') {
      inlineInput(rowEl, entry.alias ?? '', 'Display name (empty for the signal name)', (text) =>
        edit(() => {
          if (text) entry.alias = text;
          else delete entry.alias;
        }),
      );
    }
  }

  /** Shows a text field on a new row below `row`; `create` gets the text when it's confirmed. */
  function insertWithText(row: Row, placeholder: string, create: (text: string) => void) {
    const rowEl = namesCol.children[rows.indexOf(row)] as HTMLElement | undefined;
    if (!rowEl) return;
    const pending = el('div', 'wave-row wave-name kind-comment');
    pending.style.paddingLeft = rowEl.style.paddingLeft;
    rowEl.after(pending);
    inlineInput(pending, '', placeholder, (text) => {
      if (text) create(text);
      else renderRows();
    });
  }

  // ---- Context menu ----

  function openMenu(row: Row, x: number, y: number) {
    const items: Array<HTMLElement> = [];
    const item = (label: string, action: () => void, checked?: boolean) => {
      const b = el('button', 'wave-menu-item', label);
      b.type = 'button';
      b.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (checked !== undefined) b.setAttribute('aria-checked', String(checked));
      b.addEventListener('click', () => {
        closeMenu();
        action();
      });
      items.push(b);
    };
    const separator = () => items.push(el('div', 'wave-menu-sep'));

    if (row.kind === 'trace') {
      const targets = selectedTraces(row);
      if (row.trace && !row.trace.real && row.trace.width > 1) {
        for (const radix of RADIXES) {
          item(RADIX_LABELS[radix], () => edit(() => targets.forEach((t) => (t.entry.flags = withRadix(t.entry.flags, radix)))), row.radix === radix);
        }
        separator();
      }
      item('Invert', () => edit(() => targets.forEach((t) => (t.entry.flags = setFlag(t.entry.flags, FLAG.invert, !row.invert)))), row.invert);
      item('Highlight', () => edit(() => targets.forEach((t) => (t.entry.flags = setFlag(t.entry.flags, FLAG.highlight, !row.highlight)))), row.highlight);
      item('Rename…', () => startRename(row));
    } else if (row.kind === 'group') {
      item('Rename group…', () => startRename(row));
      item('Ungroup', () => edit(() => ungroup(entries, row.entry)));
    } else if (row.kind === 'comment') {
      item('Edit comment…', () => startRename(row));
    }
    separator();
    item('Insert comment…', () =>
      insertWithText(row, 'Comment', (text) => edit(() => insertEntries(entries, [{ kind: 'comment', text }], row.entry, 'after'))),
    );
    item('Insert blank row', () => edit(() => insertEntries(entries, [{ kind: 'blank' }], row.entry, 'after')));
    item('Group selection…', () =>
      insertWithText(row, 'Group name', (text) =>
        edit(() => {
          const group = groupEntries(entries, selection.has(row.entry) ? selection : [row.entry], text);
          if (!group) return false;
          selectOnly(group);
        }),
      ),
    );
    separator();
    item(selection.size > 1 && selection.has(row.entry) ? `Remove ${selection.size} rows` : 'Remove', () => removeSelected(row));

    menu.replaceChildren(...items);
    menu.hidden = false;
    const rootRect = root.getBoundingClientRect();
    const width = menu.offsetWidth || 180;
    const height = menu.offsetHeight || 300;
    menu.style.left = `${Math.max(0, Math.min(x, rootRect.right - width - 4) - rootRect.left)}px`;
    menu.style.top = `${Math.max(0, Math.min(y, rootRect.bottom - height - 4) - rootRect.top)}px`;
    (menu.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  function closeMenu() {
    menu.hidden = true;
  }

  menu.addEventListener('keydown', (e) => {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      closeMenu();
      body.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(at + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
    e.stopPropagation();
  });
  const onDocumentPointer = (e: Event) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) closeMenu();
  };
  document.addEventListener('pointerdown', onDocumentPointer);

  function removeSelected(row?: Row) {
    const targets = row && !selection.has(row.entry) ? [row.entry] : [...selection];
    if (!targets.length) return;
    edit(() => removeEntries(entries, targets));
    selection.clear();
    anchor = null;
    renderRows();
  }

  // ---- Signal browser ----

  const expandedScopes = new Set<ScopeNode>(vcd.root.scopes);
  const browserSelection = new Set<VcdSignal>();
  let browserRows: Array<{ scope?: ScopeNode; signal?: VcdSignal }> = [];

  function toggleBrowser(show = browser.hidden) {
    browser.hidden = !show;
    browseButton.setAttribute('aria-pressed', String(show));
    if (show) {
      renderBrowser();
      search.focus();
    }
    scheduleDraw();
  }

  function shownSignals(): Set<VcdSignal> {
    const shown = new Set<VcdSignal>();
    for (const entry of flatten(entries)) {
      if (entry.kind !== 'signal') continue;
      const found = resolver.resolve(entry.name);
      if (found) shown.add(found.signal);
    }
    return shown;
  }

  function renderBrowser() {
    const shown = shownSignals();
    const filter = search.value.trim().toLowerCase();
    browserRows = [];
    const out: HTMLElement[] = [];
    const signalRow = (signal: VcdSignal, depth: number, label: string) => {
      const div = el('div', 'wave-browser-row signal');
      div.dataset.index = String(browserRows.length);
      browserRows.push({ signal });
      div.style.paddingLeft = `${8 + depth * 12}px`;
      if (browserSelection.has(signal)) div.classList.add('selected');
      div.append(el('span', 'wave-check', shown.has(signal) ? '✓' : ''), el('span', 'wave-label', label));
      div.append(el('span', 'wave-width', signal.width > 1 ? `[${signal.width}]` : signal.type === 'real' ? 'real' : ''));
      div.title = `${gtkwName(signal)} (double-click to add)`;
      out.push(div);
    };
    if (filter) {
      const matches = vcd.signals.filter((s) => gtkwName(s).toLowerCase().includes(filter));
      for (const signal of matches.slice(0, 500)) signalRow(signal, 0, gtkwName(signal));
      if (matches.length > 500) out.push(el('div', 'wave-browser-note', `${matches.length - 500} more; refine the filter.`));
      if (!matches.length) out.push(el('div', 'wave-browser-note', 'No matching signals.'));
    } else {
      const walk = (scope: ScopeNode, depth: number) => {
        for (const child of scope.scopes) {
          const div = el('div', 'wave-browser-row scope');
          div.dataset.index = String(browserRows.length);
          browserRows.push({ scope: child });
          div.style.paddingLeft = `${8 + depth * 12}px`;
          const open = expandedScopes.has(child);
          div.append(el('span', 'wave-twisty', open ? '▾' : '▸'), el('span', 'wave-label', child.name));
          const all = el('button', 'wave-add-all', '+ all');
          all.type = 'button';
          all.title = `Add every signal in ${child.name}`;
          div.append(all);
          out.push(div);
          if (open) {
            for (const signal of child.signals) signalRow(signal, depth + 1, signal.name + signal.range);
            walk(child, depth + 1);
          }
        }
      };
      for (const signal of vcd.root.signals) signalRow(signal, 0, signal.name + signal.range);
      walk(vcd.root, 0);
    }
    browserList.replaceChildren(...out);
    addButton.disabled = !browserSelection.size;
  }

  search.addEventListener('input', () => renderBrowser());
  search.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') toggleBrowser(false);
  });
  browserList.addEventListener('click', (e) => {
    const index = rowIndexOfBrowser(e.target);
    const entry = browserRows[index];
    if (!entry) return;
    if (entry.scope) {
      if ((e.target as HTMLElement).closest('.wave-add-all')) {
        addFromBrowser(entry.scope.signals);
        renderBrowser();
        return;
      }
      if (expandedScopes.has(entry.scope)) expandedScopes.delete(entry.scope);
      else expandedScopes.add(entry.scope);
    } else if (entry.signal) {
      const signal = entry.signal;
      const wasSelected = browserSelection.has(signal);
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) browserSelection.clear();
      if (wasSelected && browserSelection.size) browserSelection.delete(signal);
      else browserSelection.add(signal);
      // Update in place: rebuilding the list here would break double-click.
      browserList.querySelectorAll<HTMLElement>('.wave-browser-row.signal').forEach((rowEl) => {
        const s = browserRows[Number(rowEl.dataset.index)]?.signal;
        rowEl.classList.toggle('selected', !!s && browserSelection.has(s));
      });
      addButton.disabled = !browserSelection.size;
      return;
    }
    renderBrowser();
  });
  browserList.addEventListener('dblclick', (e) => {
    const signal = browserRows[rowIndexOfBrowser(e.target)]?.signal;
    if (!signal) return;
    addFromBrowser([signal]);
    renderBrowser();
  });

  function rowIndexOfBrowser(target: EventTarget | null): number {
    const rowEl = (target as HTMLElement | null)?.closest<HTMLElement>('.wave-browser-row');
    return rowEl?.dataset.index === undefined ? -1 : Number(rowEl.dataset.index);
  }

  // ---- Time window ----

  function waveWidth() {
    return wavesCol.clientWidth;
  }

  function clampWindow() {
    const maxSpan = fullEnd * 1.05;
    span = Math.min(maxSpan, Math.max(MIN_SPAN, span));
    start = Math.min(Math.max(0, start), Math.max(0, fullEnd - span * 0.1));
  }

  function fit(draw = true) {
    start = 0;
    span = fullEnd;
    if (draw) scheduleDraw();
  }

  /** factor < 1 zooms in, around `at` (a time) or the window's centre. */
  function zoomBy(factor: number, at?: number) {
    const center = at ?? (cursor !== null && cursor >= start && cursor <= start + span ? cursor : start + span / 2);
    const ratio = (center - start) / span;
    span *= factor;
    clampWindow();
    start = center - ratio * span;
    clampWindow();
    scheduleDraw();
  }

  function pan(ticks: number) {
    start += ticks;
    clampWindow();
    scheduleDraw();
  }

  body.addEventListener(
    'wheel',
    (e) => {
      const width = waveWidth();
      if (!width) return;
      const k = width / span;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = wavesCol.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const at = x >= 0 && x <= width ? start + x / k : undefined;
        zoomBy(Math.exp(e.deltaY * 0.002), at);
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        pan((e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) / k);
      }
    },
    { passive: false },
  );

  const setCursorAt = (clientX: number) => {
    const width = waveWidth();
    if (!width) return;
    const x = clientX - wavesCol.getBoundingClientRect().left;
    // VCD times are whole ticks.
    cursor = Math.round(Math.max(0, Math.min(fullEnd, start + (x * span) / width)));
    renderValues();
    scheduleDraw();
  };
  canvas.addEventListener('pointerdown', (e) => {
    body.focus();
    setCursorAt(e.clientX);
  });
  rulerCanvas.addEventListener('pointerdown', (e) => setCursorAt(e.clientX));

  let syncingScroll = false;
  hscroll.addEventListener('scroll', () => {
    if (syncingScroll) return;
    const max = hinner.offsetWidth - hscroll.clientWidth;
    if (max <= 0) return;
    start = (hscroll.scrollLeft / max) * Math.max(0, fullEnd - span);
    clampWindow();
    scheduleDraw(false);
  });
  body.addEventListener('scroll', () => scheduleDraw(false));

  body.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      restore(e.shiftKey ? history.redo(entries) : history.undo(entries));
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      restore(history.redo(entries));
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const visible = rows.map((r) => r.entry);
      edit(() => moveBy(entries, visible, selection, e.key === 'ArrowUp' ? -1 : 1));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelected();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      pan((e.key === 'ArrowLeft' ? -0.2 : 0.2) * span);
    } else if (e.key === '+' || e.key === '=') {
      zoomBy(0.5);
    } else if (e.key === '-' || e.key === '_') {
      zoomBy(2);
    } else if (e.key === 'f' || e.key === 'F') {
      fit();
    } else if (e.key === 'Escape' && selection.size) {
      e.stopPropagation();
      selection.clear();
      renderRows();
    }
  });

  // Name column width.
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = namesCol.offsetWidth;
    resizer.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      root.style.setProperty('--wave-names-w', `${Math.max(60, Math.min(600, startWidth + ev.clientX - startX))}px`);
      scheduleDraw();
    };
    const up = () => {
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', up);
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
  });

  // ---- Drawing ----

  function scheduleDraw(syncScrollbar = true) {
    if (frame || destroyed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw(syncScrollbar);
    });
  }

  function colors() {
    const style = getComputedStyle(root);
    const v = (name: string) => style.getPropertyValue(name).trim() || '#888';
    return {
      bg: v('--wave-bg'),
      line: v('--wave-line'),
      bus: v('--wave-bus'),
      busFill: v('--wave-bus-fill'),
      x: v('--wave-x'),
      z: v('--wave-z'),
      cursor: v('--wave-cursor'),
      grid: v('--wave-grid'),
      text: v('--wave-text'),
      muted: v('--muted'),
      highlight: v('--wave-highlight'),
      selected: v('--selected'),
      font: `12px ${style.getPropertyValue('--mono').trim() || 'monospace'}`,
    };
  }

  function sizeCanvas(target: HTMLCanvasElement, c: CanvasRenderingContext2D, width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (target.width !== w || target.height !== h) {
      target.width = w;
      target.height = h;
      target.style.width = `${width}px`;
      target.style.height = `${height}px`;
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function tickStep(k: number): number {
    const raw = 100 / k;
    const pow = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  }

  function draw(syncScrollbar: boolean) {
    if (pendingZoom !== null && waveWidth() > 0) {
      const ticksPerPx = 2 ** -pendingZoom / vcd.timescale.magnitude;
      span = ticksPerPx * waveWidth();
      pendingZoom = null;
      clampWindow();
    }
    const width = waveWidth();
    if (syncScrollbar) syncScroll(width);
    if (!ctx || !rulerCtx || width <= 0) return;
    const viewport = Math.max(0, body.clientHeight - RULER_H);
    const height = Math.min(viewport, rows.length * ROW_H);
    const k = width / span;
    const toX = (t: number) => (t - start) * k;
    const c = colors();
    const step = tickStep(k);
    const firstTick = Math.ceil(start / step) * step;

    // Ruler.
    sizeCanvas(rulerCanvas, rulerCtx, width, RULER_H);
    rulerCtx.clearRect(0, 0, width, RULER_H);
    rulerCtx.font = c.font;
    rulerCtx.fillStyle = c.text;
    rulerCtx.strokeStyle = c.grid;
    rulerCtx.textBaseline = 'middle';
    for (let t = firstTick; t <= start + span; t += step) {
      const x = Math.round(toX(t)) + 0.5;
      rulerCtx.beginPath();
      rulerCtx.moveTo(x, RULER_H - 6);
      rulerCtx.lineTo(x, RULER_H);
      rulerCtx.stroke();
      rulerCtx.fillText(formatTime(t, vcd.timescale), x + 3, RULER_H / 2 - 2);
    }
    if (cursor !== null) {
      const x = Math.round(toX(cursor)) + 0.5;
      rulerCtx.fillStyle = c.cursor;
      rulerCtx.fillRect(x - 0.5, 0, 1, RULER_H);
    }

    // Waves.
    sizeCanvas(canvas, ctx, width, height);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = firstTick; t <= start + span; t += step) {
      const x = Math.round(toX(t)) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();
    ctx.font = c.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const charWidth = ctx.measureText('0').width || 7;
    const scrollTop = body.scrollTop;
    const first = Math.floor(scrollTop / ROW_H);
    const last = Math.min(rows.length - 1, Math.ceil((scrollTop + height) / ROW_H));
    const endX = toX(vcd.endTime);
    for (let r = first; r <= last; r++) {
      const row = rows[r]!;
      const y = r * ROW_H - scrollTop;
      if (selection.has(row.entry)) {
        ctx.fillStyle = c.selected;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(0, y, width, ROW_H);
        ctx.globalAlpha = 1;
      } else if (row.kind === 'trace' && row.highlight) {
        ctx.fillStyle = c.highlight;
        ctx.fillRect(0, y, width, ROW_H);
      }
      if (row.kind !== 'trace') continue;
      if (!row.trace) {
        ctx.fillStyle = c.muted;
        ctx.textAlign = 'left';
        ctx.fillText('not in this VCD', 6, y + ROW_H / 2);
        ctx.textAlign = 'center';
        continue;
      }
      drawTrace(ctx, row, y, width, k, endX, charWidth, c);
    }
    if (cursor !== null) {
      ctx.fillStyle = c.cursor;
      ctx.fillRect(Math.round(toX(cursor)), 0, 1, height);
    }
  }

  function drawTrace(
    c2: CanvasRenderingContext2D,
    row: Extract<Row, { kind: 'trace' }>,
    y: number,
    width: number,
    k: number,
    endX: number,
    charWidth: number,
    c: ReturnType<typeof colors>,
  ) {
    const trace = row.trace!;
    const times = trace.times;
    const n = times.length;
    const top = y + 4;
    const bottom = y + ROW_H - 4;
    const mid = y + ROW_H / 2;
    const toX = (t: number) => (t - start) * k;
    const scalar = !!trace.scalars;
    let i = Math.max(0, indexAt(times, start));
    let prevY: number | null = null;

    c2.save();
    c2.beginPath();
    c2.rect(0, y, width, ROW_H);
    c2.clip();
    c2.lineWidth = 1;

    while (i < n && times[i]! <= start + span) {
      const x0 = Math.max(-2, toX(times[i]!));
      let j = i + 1;
      let x1 = j < n ? toX(times[j]!) : Math.max(endX, x0 + 1);
      if (j < n && x1 - x0 < 2) {
        // Changes closer than 2px: draw one solid block instead of each one.
        let jj = j;
        let bx = x1;
        for (;;) {
          const nj = indexAfter(times, start + (bx + 2) / k);
          if (nj <= jj + 1) break;
          jj = nj - 1;
          bx = toX(times[jj]!);
        }
        c2.fillStyle = scalar ? c.line : c.bus;
        c2.fillRect(x0, top, Math.max(1, bx - x0), bottom - top);
        prevY = null;
        i = jj;
        continue;
      }
      x1 = Math.min(x1, width + 4);
      if (scalar) {
        let v = trace.scalars![i]!;
        if (row.invert && v < 2) v = 1 - v;
        const level = v === 0 ? bottom : v === 1 ? top : mid;
        if (v === 2) {
          c2.fillStyle = c.x;
          c2.globalAlpha = 0.3;
          c2.fillRect(x0, top, x1 - x0, bottom - top);
          c2.globalAlpha = 1;
          c2.strokeStyle = c.x;
          c2.strokeRect(x0 + 0.5, top + 0.5, x1 - x0, bottom - top);
        } else {
          c2.strokeStyle = v === 3 ? c.z : c.line;
          c2.beginPath();
          if (prevY !== null && prevY !== level) {
            c2.moveTo(Math.round(x0) + 0.5, prevY + 0.5);
            c2.lineTo(Math.round(x0) + 0.5, level + 0.5);
          } else c2.moveTo(x0, level + 0.5);
          c2.lineTo(x1, level + 0.5);
          c2.stroke();
        }
        prevY = v === 2 ? null : level;
      } else {
        const bits = valueBits(trace, i);
        const floating = !trace.real && /^z+$/.test(bits);
        const unknown = !trace.real && /x/.test(bits);
        if (floating) {
          c2.strokeStyle = c.z;
          c2.beginPath();
          c2.moveTo(x0, mid + 0.5);
          c2.lineTo(x1, mid + 0.5);
          c2.stroke();
        } else {
          const s = Math.min(3, (x1 - x0) / 2);
          c2.beginPath();
          c2.moveTo(x0, mid);
          c2.lineTo(x0 + s, top + 0.5);
          c2.lineTo(x1 - s, top + 0.5);
          c2.lineTo(x1, mid);
          c2.lineTo(x1 - s, bottom - 0.5);
          c2.lineTo(x0 + s, bottom - 0.5);
          c2.closePath();
          c2.fillStyle = unknown ? c.x : c.busFill;
          c2.globalAlpha = unknown ? 0.3 : 1;
          c2.fill();
          c2.globalAlpha = 1;
          c2.strokeStyle = unknown ? c.x : c.bus;
          c2.stroke();
          const left = Math.max(x0 + s, 0);
          const right = Math.min(x1 - s, width);
          const room = right - left - 4;
          if (room > charWidth) {
            let text = displayValue(row, i);
            const fit = Math.floor(room / charWidth);
            if (text.length > fit) text = fit > 1 ? `${text.slice(0, fit - 1)}…` : '…';
            c2.fillStyle = c.text;
            c2.fillText(text, (left + right) / 2, mid + 1);
          }
        }
      }
      i = j;
    }
    c2.restore();
  }

  function syncScroll(width: number) {
    const extra = Math.max(0, fullEnd - span);
    hscroll.hidden = extra <= 0 || width <= 0;
    hscroll.style.marginLeft = `${body.clientWidth - width}px`;
    if (hscroll.hidden) return;
    const inner = Math.min(10_000_000, Math.max(width + 1, (width * fullEnd) / span));
    hinner.style.width = `${inner}px`;
    syncingScroll = true;
    hscroll.scrollLeft = (start / extra) * (inner - hscroll.clientWidth);
    requestAnimationFrame(() => (syncingScroll = false));
  }

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => scheduleDraw());
  resizeObserver?.observe(body);
  const themeObserver = new MutationObserver(() => scheduleDraw());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  applyChoice(choiceId);

  return {
    get dirty() {
      return dirty;
    },
    get rowCount() {
      return rows.length;
    },
    get choiceId() {
      return choiceId;
    },
    setChoices(next, selected, apply) {
      choices = next;
      if (apply) applyChoice(selected);
      else {
        choiceId = selected;
        renderPicker();
      }
    },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('pointerdown', onDocumentPointer);
      root.remove();
    },
  };
}
