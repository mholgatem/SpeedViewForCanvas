import { BUILTIN_FORMATS, formatNumber } from './numfmt';
import { all, attr, decode, first, flag, kid, kids, parseXml, relsFor, unzipParts } from './ooxml';

/**
 * Reader for Excel workbooks (.xlsx/.xlsm): sheets, cell values, cached formula results,
 * formulas (including shared ones), number formats, fonts, fills, borders, alignment,
 * merged cells, and row/column sizes. Charts and images are detected but not drawn.
 * Only the XML parts needed are decompressed, within a size limit.
 */

export interface Borders {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export interface CellStyle {
  numFmt: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Points. */
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  fill?: string;
  borders: Borders;
  hAlign?: string;
  vAlign?: string;
  wrap?: boolean;
  indent?: number;
}

export interface Cell {
  row: number;
  col: number;
  /** Raw value: number, string, boolean, error text (#DIV/0!), or null when empty. */
  value: string | number | boolean | null;
  type: 'number' | 'string' | 'boolean' | 'error' | 'empty';
  formula?: string;
  style: number;
}

export interface Merge {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface Sheet {
  /** Cells by row index (1-based), each row's cells sorted by column. */
  rows: Map<number, Cell[]>;
  /** Row heights in points, by row index. */
  rowHeights: Map<number, number>;
  hiddenRows: Set<number>;
  /** Column widths in Excel character units, by column index (1-based). */
  colWidths: Map<number, number>;
  hiddenCols: Set<number>;
  defaultColWidth?: number;
  /** Points. */
  defaultRowHeight?: number;
  merges: Merge[];
  maxRow: number;
  maxCol: number;
  showGridLines: boolean;
  /** The sheet has charts or images (not rendered). */
  hasDrawing: boolean;
}

export interface SheetInfo {
  name: string;
  hidden: boolean;
  path: string | null;
}

export interface Workbook {
  sheets: SheetInfo[];
  activeSheet: number;
  date1904: boolean;
  styles: CellStyle[];
  loadSheet(index: number): Sheet;
}

const MAX_PART_BYTES = 200 * 1024 * 1024;

// ---- References --------------------------------------------------------------------------

/** "AB12" -> { col: 28, row: 12 }. */
export function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  return { row: Number(m[2]), col };
}

export function columnName(col: number): string {
  let name = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

// ---- Colors ------------------------------------------------------------------------------

/** Excel's legacy 64-color palette, used by "indexed" colors. */
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

/** Theme color order used by index: lt1, dk1, lt2, dk2, accent1-6, hlink, folHlink. */
const THEME_ORDER = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

function parseTheme(xml: string | null): string[] {
  const colors = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
  if (!xml) return colors;
  const scheme = first(parseXml(xml), 'clrScheme');
  if (!scheme) return colors;
  THEME_ORDER.forEach((name, i) => {
    const entry = kid(scheme, name);
    const value = entry && (attr(first(entry, 'srgbClr'), 'val') ?? attr(first(entry, 'sysClr'), 'lastClr'));
    if (value && /^[0-9A-F]{6}$/i.test(value)) colors[i] = value;
  });
  return colors;
}

function applyTint(hex: string, tint: number): string {
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const [r, g, b] = rgb;
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let out: number[];
  if (s === 0) out = [l, l, l];
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    out = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }
  return out.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

function resolveColor(node: Element | null, theme: string[]): string | undefined {
  if (!node || flag(node, 'auto')) return undefined;
  let hex: string | undefined;
  const rgb = attr(node, 'rgb');
  const themeIndex = attr(node, 'theme');
  const indexed = attr(node, 'indexed');
  if (rgb && /^[0-9A-F]{6,8}$/i.test(rgb)) hex = rgb.slice(-6);
  else if (themeIndex !== null) hex = theme[Number(themeIndex)];
  else if (indexed !== null) hex = INDEXED[Number(indexed)];
  if (!hex) return undefined;
  const tint = Number(attr(node, 'tint') ?? 0);
  if (tint) hex = applyTint(hex, Math.max(-1, Math.min(1, tint)));
  return `#${hex.toLowerCase()}`;
}

// ---- Styles ------------------------------------------------------------------------------

const BORDER_CSS: Record<string, string> = {
  thin: '1px solid', hair: '1px dotted', dotted: '1px dotted', dashed: '1px dashed',
  dashDot: '1px dashed', dashDotDot: '1px dotted', medium: '2px solid', mediumDashed: '2px dashed',
  mediumDashDot: '2px dashed', mediumDashDotDot: '2px dotted', slantDashDot: '2px dashed',
  thick: '3px solid', double: '3px double',
};

function parseStyles(xml: string | null, theme: string[]): CellStyle[] {
  if (!xml) return [{ numFmt: 'General', borders: {} }];
  const doc = parseXml(xml);
  const formats = new Map<number, string>();
  for (const f of all(doc, 'numFmt')) formats.set(Number(attr(f, 'numFmtId')), attr(f, 'formatCode') ?? 'General');

  const fontsEl = first(doc, 'fonts');
  const fonts = fontsEl ? kids(fontsEl, 'font') : [];
  const fillsEl = first(doc, 'fills');
  const fills = fillsEl ? kids(fillsEl, 'fill') : [];
  const bordersEl = first(doc, 'borders');
  const borders = bordersEl ? kids(bordersEl, 'border') : [];
  const xfsEl = first(doc, 'cellXfs');
  const xfs = xfsEl ? kids(xfsEl, 'xf') : [];

  const fillColor = (fill: Element | undefined): string | undefined => {
    if (!fill) return undefined;
    const pattern = kid(fill, 'patternFill');
    if (pattern) {
      const type = attr(pattern, 'patternType') ?? (kid(pattern, 'fgColor') ? 'solid' : 'none');
      if (type === 'none' || type === 'gray125') return undefined;
      return resolveColor(kid(pattern, 'fgColor'), theme) ?? resolveColor(kid(pattern, 'bgColor'), theme);
    }
    const gradient = kid(fill, 'gradientFill');
    return gradient ? resolveColor(first(gradient, 'color'), theme) : undefined;
  };

  return (xfs.length ? xfs : [null]).map((xf) => {
    const id = Number(attr(xf, 'numFmtId') ?? 0);
    const style: CellStyle = { numFmt: formats.get(id) ?? BUILTIN_FORMATS[id] ?? 'General', borders: {} };
    const font = fonts[Number(attr(xf, 'fontId') ?? 0)];
    if (font) {
      style.bold = flag(kid(font, 'b'), 'val', !!kid(font, 'b'));
      style.italic = flag(kid(font, 'i'), 'val', !!kid(font, 'i'));
      const u = kid(font, 'u');
      style.underline = !!u && attr(u, 'val') !== 'none';
      style.strike = flag(kid(font, 'strike'), 'val', !!kid(font, 'strike'));
      const size = Number(attr(kid(font, 'sz'), 'val'));
      if (size > 0) style.fontSize = size;
      const name = attr(kid(font, 'name'), 'val');
      if (name) style.fontFamily = name.replace(/["\\;{}<>]/g, '');
      style.color = resolveColor(kid(font, 'color'), theme);
    }
    style.fill = fillColor(fills[Number(attr(xf, 'fillId') ?? 0)]);
    const border = borders[Number(attr(xf, 'borderId') ?? 0)];
    if (border) {
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const edge = kid(border, side);
        const css = BORDER_CSS[attr(edge, 'style') ?? ''];
        if (edge && css) style.borders[side] = `${css} ${resolveColor(kid(edge, 'color'), theme) ?? '#000000'}`;
      }
    }
    const alignment = xf && kid(xf, 'alignment');
    if (alignment) {
      style.hAlign = attr(alignment, 'horizontal') ?? undefined;
      style.vAlign = attr(alignment, 'vertical') ?? undefined;
      style.wrap = flag(alignment, 'wrapText');
      const indent = Number(attr(alignment, 'indent') ?? 0);
      if (indent > 0) style.indent = indent;
    }
    return style;
  });
}

// ---- Formulas ----------------------------------------------------------------------------

/** Shift relative references in a shared formula by (dRow, dCol), as Excel does when filling. */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  if (!dRow && !dCol) return formula;
  // Skip string literals and quoted sheet names; shift A1-style refs not followed by "(".
  return formula.replace(/("[^"]*"|'[^']*')|(?<![A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g, (whole, quoted, colAbs, col, rowAbs, row) => {
    if (quoted) return whole;
    const ref = parseRef(`${col}${row}`)!;
    const newCol = colAbs ? ref.col : ref.col + dCol;
    const newRow = rowAbs ? ref.row : ref.row + dRow;
    if (newCol < 1 || newRow < 1) return '#REF!';
    return `${colAbs}${colAbs ? col : columnName(newCol)}${rowAbs}${rowAbs ? row : newRow}`;
  });
}

// ---- Workbook ----------------------------------------------------------------------------

/** Text of a shared/inline string, skipping phonetic (furigana) runs. */
function stringText(si: Element): string {
  let text = '';
  for (const t of all(si, 't')) {
    if (t.parentElement?.localName !== 'rPh') text += t.textContent ?? '';
  }
  return text;
}

export function readWorkbook(bytes: Uint8Array, maxTotalBytes = MAX_PART_BYTES): Workbook {
  const files = unzipParts(bytes, maxTotalBytes, /\.(xml|rels)$/i);
  const text = (path: string | undefined) => (path && files[path] ? decode(files[path]!) : null);

  const rootRels = relsFor(files, '');
  const workbookPath = [...rootRels.values()].find((r) => r.type.endsWith('/officeDocument'))?.target ?? 'xl/workbook.xml';
  const workbookXml = text(workbookPath);
  if (!workbookXml) throw new Error('this is not an Excel workbook');
  const workbookDoc = parseXml(workbookXml);
  const rels = relsFor(files, workbookPath);
  const relOfType = (suffix: string) => [...rels.values()].find((r) => r.type.endsWith(suffix))?.target;

  const theme = parseTheme(text(relOfType('/theme')));
  const styles = parseStyles(text(relOfType('/styles')), theme);
  const shared = (() => {
    const xml = text(relOfType('/sharedStrings'));
    return xml ? all(parseXml(xml), 'si').map(stringText) : [];
  })();

  const sheets: SheetInfo[] = all(workbookDoc, 'sheet').map((s) => {
    const rel = rels.get(attr(s, 'id') ?? '');
    return {
      name: attr(s, 'name') ?? 'Sheet',
      hidden: (attr(s, 'state') ?? 'visible') !== 'visible',
      path: rel && !rel.external && files[rel.target] ? rel.target : null,
    };
  });
  const date1904 = flag(first(workbookDoc, 'workbookPr'), 'date1904');
  const activeTab = Number(attr(first(workbookDoc, 'workbookView'), 'activeTab') ?? 0);

  const loadSheet = (index: number): Sheet => {
    const info = sheets[index];
    const xml = info?.path ? text(info.path) : null;
    if (!xml) throw new Error('this sheet is a chart or is missing');
    return parseSheet(parseXml(xml), shared, files, info!.path!);
  };

  return {
    sheets,
    activeSheet: Math.min(Math.max(0, activeTab), Math.max(0, sheets.length - 1)),
    date1904,
    styles,
    loadSheet,
  };
}

function parseSheet(doc: Document, shared: string[], files: Record<string, Uint8Array>, path: string): Sheet {
  const sheet: Sheet = {
    rows: new Map(),
    rowHeights: new Map(),
    hiddenRows: new Set(),
    colWidths: new Map(),
    hiddenCols: new Set(),
    merges: [],
    maxRow: 0,
    maxCol: 0,
    showGridLines: flag(first(doc, 'sheetView'), 'showGridLines', true),
    hasDrawing: !!first(doc, 'drawing') || !!first(doc, 'legacyDrawing'),
  };
  const format = first(doc, 'sheetFormatPr');
  const defaultHeight = Number(attr(format, 'defaultRowHeight'));
  if (defaultHeight > 0) sheet.defaultRowHeight = defaultHeight;
  const defaultWidth = Number(attr(format, 'defaultColWidth'));
  if (defaultWidth > 0) sheet.defaultColWidth = defaultWidth;
  else if (Number(attr(format, 'baseColWidth')) > 0) sheet.defaultColWidth = Number(attr(format, 'baseColWidth')) + 5 / 7;

  for (const col of all(doc, 'col')) {
    const min = Number(attr(col, 'min'));
    const max = Math.min(Number(attr(col, 'max')), min + 16384);
    const width = Number(attr(col, 'width'));
    for (let c = min; c <= max && c > 0; c++) {
      if (width > 0) sheet.colWidths.set(c, width);
      if (flag(col, 'hidden')) sheet.hiddenCols.add(c);
    }
  }

  const sharedFormulas = new Map<string, { formula: string; row: number; col: number }>();
  let rowIndex = 0;
  for (const rowEl of all(doc, 'row')) {
    rowIndex = Number(attr(rowEl, 'r')) || rowIndex + 1;
    const height = Number(attr(rowEl, 'ht'));
    if (height > 0) sheet.rowHeights.set(rowIndex, height);
    if (flag(rowEl, 'hidden')) sheet.hiddenRows.add(rowIndex);
    const cells: Cell[] = [];
    let colIndex = 0;
    for (const c of kids(rowEl, 'c')) {
      const ref = parseRef(attr(c, 'r') ?? '');
      colIndex = ref?.col ?? colIndex + 1;
      const cell: Cell = { row: rowIndex, col: colIndex, value: null, type: 'empty', style: Number(attr(c, 's') ?? 0) };
      const type = attr(c, 't') ?? 'n';
      const v = kid(c, 'v')?.textContent ?? null;
      if (type === 'inlineStr') {
        const is = kid(c, 'is');
        cell.value = is ? stringText(is) : '';
        cell.type = 'string';
      } else if (v !== null) {
        if (type === 's') {
          cell.value = shared[Number(v)] ?? '';
          cell.type = 'string';
        } else if (type === 'str' || type === 'd') {
          cell.value = v;
          cell.type = 'string';
        } else if (type === 'b') {
          cell.value = v === '1';
          cell.type = 'boolean';
        } else if (type === 'e') {
          cell.value = v;
          cell.type = 'error';
        } else if (v !== '' && Number.isFinite(Number(v))) {
          cell.value = Number(v);
          cell.type = 'number';
        }
      }

      const f = kid(c, 'f');
      if (f) {
        const si = attr(f, 'si');
        const body = f.textContent ?? '';
        if (attr(f, 't') === 'shared' && si !== null) {
          if (body) sharedFormulas.set(si, { formula: body, row: rowIndex, col: colIndex });
          const master = sharedFormulas.get(si);
          if (master) cell.formula = shiftFormula(master.formula, rowIndex - master.row, colIndex - master.col);
        } else if (body) {
          cell.formula = body;
        }
      }

      if (cell.type !== 'empty' || cell.formula || cell.style) {
        cells.push(cell);
        if (cell.type !== 'empty' || cell.formula) {
          sheet.maxRow = Math.max(sheet.maxRow, rowIndex);
          sheet.maxCol = Math.max(sheet.maxCol, colIndex);
        }
      }
    }
    if (cells.length) sheet.rows.set(rowIndex, cells.sort((a, b) => a.col - b.col));
  }

  for (const m of all(doc, 'mergeCell')) {
    const [a, b] = (attr(m, 'ref') ?? '').split(':').map(parseRef);
    if (!a || !b) continue;
    const merge = { r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col), r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col) };
    sheet.merges.push(merge);
    sheet.maxRow = Math.max(sheet.maxRow, merge.r2);
    sheet.maxCol = Math.max(sheet.maxCol, merge.c2);
  }

  // A drawing relationship to a chart or image part means there's something we don't draw.
  if (!sheet.hasDrawing) {
    sheet.hasDrawing = [...relsFor(files, path).values()].some((r) => /\/(drawing|chart)$/.test(r.type));
  }
  return sheet;
}

/** Text Excel would show in the cell, plus a color from the number format if any. */
export function displayValue(cell: Cell, style: CellStyle | undefined, date1904: boolean): { text: string; color?: string } {
  switch (cell.type) {
    case 'number':
      return formatNumber(cell.value as number, style?.numFmt ?? 'General', date1904);
    case 'boolean':
      return { text: cell.value ? 'TRUE' : 'FALSE' };
    case 'string':
    case 'error':
      return { text: String(cell.value) };
    default:
      return { text: '' };
  }
}
