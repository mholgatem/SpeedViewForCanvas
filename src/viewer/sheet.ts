import { isDateCode } from '../render/numfmt';
import { columnName, displayValue, readWorkbook, type Cell, type CellStyle, type Sheet, type Workbook } from '../render/xlsx';
import type { ZoomableView } from './views';

/**
 * Excel workbooks as a grid: column letters and row numbers, sheet tabs, a formula bar
 * for the selected cell, and a "Show formulas" toggle. Everything is built with
 * textContent and validated style values; nothing from the file becomes HTML.
 */

export interface SheetView extends ZoomableView {
  sheetCount: number;
}

/** Cells beyond this are not drawn (the file stays downloadable). */
const MAX_CELLS = 150_000;
const MAX_COLS = 256;
const DEFAULT_COL_PX = 64;
const DEFAULT_ROW_PT = 15;
const HEADER_COL_PX = 44;
const INDENT_PX = 9;

const H_ALIGN: Record<string, string> = {
  left: 'left', center: 'center', right: 'right', justify: 'justify', fill: 'left',
  centerContinuous: 'center', distributed: 'center',
};
const V_ALIGN: Record<string, string> = { top: 'top', center: 'middle', bottom: 'bottom', justify: 'middle', distributed: 'middle' };

const colPx = (width: number | undefined) => (width ? Math.max(0, Math.round(width * 7)) : DEFAULT_COL_PX);

export function renderSheetView(container: HTMLElement, bytes: Uint8Array, zoom: number, maxTotalBytes: number): SheetView {
  const workbook = readWorkbook(bytes, maxTotalBytes);
  const root = el('div', 'sheet-view');
  const bar = el('div', 'sheet-bar');
  const refEl = el('span', 'cell-ref');
  const contentEl = el('span', 'cell-content');
  const formulasButton = el('button', '', 'Show formulas');
  formulasButton.setAttribute('aria-pressed', 'false');
  formulasButton.title = 'Show formulas in the cells instead of their results';
  bar.append(refEl, contentEl, formulasButton);
  const grid = el('div', 'sheet-grid');
  const notes = el('div', 'sheet-notes');
  const tabs = el('div', 'sheet-tabs');
  root.append(bar, grid, notes, tabs);
  container.append(root);

  const parsed = new Map<number, Sheet>();
  let current = workbook.activeSheet;
  let showFormulas = false;
  let table: HTMLTableElement | null = null;
  let cellsByTd = new WeakMap<HTMLElement, Cell>();
  let selectedTd: HTMLElement | null = null;

  const select = (td: HTMLElement | null, cell: Cell | undefined, ref: string) => {
    selectedTd?.classList.remove('selected');
    selectedTd = td;
    td?.classList.add('selected');
    refEl.textContent = ref;
    contentEl.textContent = cell ? barText(cell, workbook) : '';
  };

  const show = (index: number) => {
    current = index;
    for (const [i, tab] of [...tabs.children].entries()) tab.classList.toggle('active', i === index);
    grid.replaceChildren();
    notes.replaceChildren();
    select(null, undefined, '');
    table = null;
    let sheet: Sheet;
    try {
      sheet = parsed.get(index) ?? workbook.loadSheet(index);
      parsed.set(index, sheet);
    } catch (err) {
      grid.append(el('div', 'notice', `Can't show this sheet: ${(err as Error).message}.`));
      return;
    }
    if (sheet.hasDrawing) notes.append(el('div', '', 'This sheet has charts or images, which aren’t shown. Download the file to see them.'));
    if (!sheet.maxRow) {
      grid.append(el('div', 'notice', 'This sheet is empty.'));
      return;
    }
    const built = buildTable(sheet, workbook, showFormulas);
    cellsByTd = built.cells;
    table = built.table;
    table.style.setProperty('zoom', String(zoom));
    grid.append(table);
    markOverflowingNumbers(table);
    if (built.truncated) notes.append(el('div', '', built.truncated));
  };

  workbook.sheets.forEach((info, i) => {
    const tab = el('button', info.hidden ? 'hidden-sheet' : '', info.name);
    if (info.hidden) tab.title = 'Hidden in Excel';
    tab.addEventListener('click', () => show(i));
    tabs.append(tab);
  });
  tabs.hidden = workbook.sheets.length < 2;

  grid.addEventListener('click', (e) => {
    const td = (e.target as HTMLElement).closest<HTMLElement>('td');
    if (!td?.dataset.ref) return;
    select(td, cellsByTd.get(td), td.dataset.ref);
  });
  formulasButton.addEventListener('click', () => {
    showFormulas = !showFormulas;
    formulasButton.setAttribute('aria-pressed', String(showFormulas));
    const { scrollTop, scrollLeft } = grid;
    show(current);
    grid.scrollTop = scrollTop;
    grid.scrollLeft = scrollLeft;
  });

  if (workbook.sheets.length) show(current);
  else grid.append(el('div', 'notice', 'This workbook has no sheets.'));

  return {
    sheetCount: workbook.sheets.length,
    setZoom(next) {
      zoom = next;
      table?.style.setProperty('zoom', String(zoom));
    },
    destroy() {
      root.remove();
    },
  };
}

function barText(cell: Cell, workbook: Workbook): string {
  if (cell.formula) return `=${cell.formula}`;
  if (cell.type === 'number') {
    const style = workbook.styles[cell.style];
    return style && isDateCode(style.numFmt) ? displayValue(cell, style, workbook.date1904).text : String(cell.value);
  }
  return displayValue(cell, workbook.styles[cell.style], workbook.date1904).text;
}

function buildTable(sheet: Sheet, workbook: Workbook, showFormulas: boolean) {
  const maxCol = Math.min(sheet.maxCol, MAX_COLS);
  const maxRow = Math.min(sheet.maxRow, Math.max(1, Math.floor(MAX_CELLS / maxCol)));
  const truncated =
    maxRow < sheet.maxRow || maxCol < sheet.maxCol
      ? `Showing ${columnName(1)}1:${columnName(maxCol)}${maxRow} of ${columnName(sheet.maxCol)}${sheet.maxRow}. Download the file to see the rest.`
      : '';

  const lookup = new Map<number, Map<number, Cell>>();
  for (const [r, cells] of sheet.rows) lookup.set(r, new Map(cells.map((c) => [c.col, c])));
  const cellAt = (r: number, c: number) => lookup.get(r)?.get(c);
  const hasContent = (cell: Cell | undefined) => !!cell && (cell.type !== 'empty' || (showFormulas && !!cell.formula));

  const spans = new Map<string, { rows: number; cols: number }>();
  const covered = new Set<string>();
  const coveredBy = new Map<string, string>();
  for (const m of sheet.merges) {
    if (m.r1 > maxRow || m.c1 > maxCol) continue;
    const r2 = Math.min(m.r2, maxRow);
    const c2 = Math.min(m.c2, maxCol);
    spans.set(`${m.r1}:${m.c1}`, { rows: r2 - m.r1 + 1, cols: c2 - m.c1 + 1 });
    for (let r = m.r1; r <= r2; r++) {
      for (let c = m.c1; c <= c2; c++) {
        if (r !== m.r1 || c !== m.c1) {
          covered.add(`${r}:${c}`);
          coveredBy.set(`${r}:${c}`, `${m.r1}:${m.c1}`);
        }
      }
    }
  }

  const base = workbook.styles[0];
  const gridColor = sheet.showGridLines ? '#d4d4d4' : 'transparent';
  const table = el('table', 'sheet');
  table.style.setProperty('--grid', gridColor);
  if (base?.fontFamily) table.style.fontFamily = `"${base.fontFamily}", Calibri, Carlito, Arial, sans-serif`;
  if (base?.fontSize) table.style.fontSize = `${base.fontSize}pt`;

  const colgroup = el('colgroup');
  const headerCol = el('col');
  headerCol.style.width = `${HEADER_COL_PX}px`;
  colgroup.append(headerCol);
  let totalWidth = HEADER_COL_PX;
  for (let c = 1; c <= maxCol; c++) {
    const px = colPx(sheet.colWidths.get(c) ?? sheet.defaultColWidth);
    totalWidth += px;
    const col = el('col');
    col.style.width = `${px}px`;
    colgroup.append(col);
  }
  table.style.width = `${totalWidth}px`;
  table.append(colgroup);

  const head = el('thead');
  const headRow = el('tr');
  headRow.append(el('th', 'corner'));
  for (let c = 1; c <= maxCol; c++) {
    const th = el('th', sheet.hiddenCols.has(c) ? 'hidden-rc' : '', columnName(c));
    if (sheet.hiddenCols.has(c)) th.title = 'Hidden in Excel';
    headRow.append(th);
  }
  head.append(headRow);
  table.append(head);

  const cells = new WeakMap<HTMLElement, Cell>();
  const body = el('tbody');
  // The td that owns each column in the previous row (for moving top borders onto it).
  let above: (HTMLElement | undefined)[] = [];
  const tdAt = new Map<string, HTMLElement>();

  for (let r = 1; r <= maxRow; r++) {
    const tr = el('tr');
    const height = sheet.rowHeights.get(r) ?? sheet.defaultRowHeight ?? DEFAULT_ROW_PT;
    tr.style.height = `${height}pt`;
    const rowHead = el('th', sheet.hiddenRows.has(r) ? 'hidden-rc' : '', String(r));
    if (sheet.hiddenRows.has(r)) rowHead.title = 'Hidden in Excel';
    tr.append(rowHead);
    const current: (HTMLElement | undefined)[] = [];
    let left: HTMLElement | undefined;

    for (let c = 1; c <= maxCol; c++) {
      const key = `${r}:${c}`;
      if (covered.has(key)) {
        const owner = tdAt.get(coveredBy.get(key)!);
        current[c] = owner;
        left = owner;
        continue;
      }
      const cell = cellAt(r, c);
      const style = cell ? workbook.styles[cell.style] : undefined;
      const td = el('td');
      td.dataset.ref = `${columnName(c)}${r}`;
      tdAt.set(key, td);
      const span = spans.get(key);
      if (span) {
        if (span.rows > 1) td.rowSpan = span.rows;
        if (span.cols > 1) td.colSpan = span.cols;
      }

      if (cell) {
        cells.set(td, cell);
        let text: string;
        let color: string | undefined;
        if (showFormulas && cell.formula) {
          text = `=${cell.formula}`;
        } else if (cell.type === 'empty' && cell.formula) {
          // Formula saved without a computed result (common with Python-generated files).
          text = `=${cell.formula}`;
          td.classList.add('uncached');
          td.title = 'No saved result for this formula';
        } else {
          ({ text, color } = displayValue(cell, style, workbook.date1904));
        }
        td.textContent = text;
        if (cell.type === 'number' && !(showFormulas && cell.formula)) td.classList.add('num');
        applyStyle(td, style, base, color, cell, showFormulas);
      }

      // Text spills into empty neighbors, as in Excel.
      const align = td.style.textAlign || 'left';
      const wraps = style?.wrap;
      const nextEmpty = c < maxCol && !hasContent(cellAt(r, c + 1)) && !covered.has(`${r}:${c + 1}`) && !span;
      if (td.textContent && align === 'left' && !wraps && nextEmpty) td.classList.add('spill');

      // Gridlines are right/bottom borders; filled cells hide them, like Excel.
      if (style?.fill) {
        td.style.borderRightColor = style.fill;
        td.style.borderBottomColor = style.fill;
      }
      if (style) {
        const b = style.borders;
        if (b.right) td.style.borderRight = b.right;
        if (b.bottom) td.style.borderBottom = b.bottom;
        // Left/top borders are drawn by the neighbor so they line up with its gridline.
        if (b.left) {
          if (left) left.style.borderRight = b.left;
          else td.style.borderLeft = b.left;
        }
        if (b.top) {
          const up = above[c];
          if (up) up.style.borderBottom = b.top;
          else td.style.borderTop = b.top;
        }
      }

      const cols = span?.cols ?? 1;
      for (let k = 0; k < cols; k++) current[c + k] = td;
      left = td;
      tr.append(td);
      c += cols - 1;
    }
    above = current;
    body.append(tr);
  }
  table.append(body);
  return { table, cells, truncated };
}

/** Numbers and dates too wide for their column show ####, as in Excel (full value on hover). */
function markOverflowingNumbers(table: HTMLTableElement) {
  const tooWide = [...table.querySelectorAll<HTMLElement>('td.num')].filter((td) => td.scrollWidth > td.clientWidth + 1);
  for (const td of tooWide) {
    const text = td.textContent ?? '';
    td.title = text;
    td.textContent = '#'.repeat(Math.max(1, Math.floor((text.length * td.clientWidth) / td.scrollWidth)));
  }
}

const VALID_COLOR = /^#[0-9a-f]{6}$/i;

function applyStyle(td: HTMLElement, style: CellStyle | undefined, base: CellStyle | undefined, formatColor: string | undefined, cell: Cell, showFormulas: boolean) {
  const color = formatColor ?? style?.color;
  if (color && VALID_COLOR.test(color)) td.style.color = color;
  if (!style) return;
  if (style.fill && VALID_COLOR.test(style.fill)) td.style.backgroundColor = style.fill;
  if (style.bold) td.style.fontWeight = '700';
  if (style.italic) td.style.fontStyle = 'italic';
  const decoration = [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean).join(' ');
  if (decoration) td.style.textDecoration = decoration;
  if (style.fontSize && style.fontSize !== base?.fontSize) td.style.fontSize = `${style.fontSize}pt`;
  if (style.fontFamily && style.fontFamily !== base?.fontFamily) td.style.fontFamily = `"${style.fontFamily}", sans-serif`;

  const general = cell.type === 'number' && !(showFormulas && cell.formula) ? 'right' : cell.type === 'boolean' || cell.type === 'error' ? 'center' : 'left';
  const align = (style.hAlign && H_ALIGN[style.hAlign]) || general;
  if (align !== 'left') td.style.textAlign = align;
  td.style.verticalAlign = (style.vAlign && V_ALIGN[style.vAlign]) || 'bottom';
  if (style.wrap) td.classList.add('wrap');
  if (style.indent) td.style[align === 'right' ? 'paddingRight' : 'paddingLeft'] = `${3 + style.indent * INDENT_PX}px`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
