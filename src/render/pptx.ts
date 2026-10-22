import { formatGeneral, formatNumber } from './numfmt';
import { all, attr, decode, first, flag, kid, kids, parseXml, relId, relsFor, unzipParts, type Relationship } from './ooxml';

/**
 * Reader for PowerPoint presentations (.pptx and relatives). Each slide's content comes
 * with its position and size on the slide (inherited from the layout and master when the
 * slide doesn't say), text sizes, colors and fonts resolved through the theme, shape
 * fills and outlines, the background, and the layout/master's own pictures and shapes.
 * Blocks are listed in reading order (title, then top to bottom, left to right) so the
 * same data also works as a text outline. Speaker notes are read too. Animations,
 * transitions, effects, and custom shape outlines are not modeled. Only XML parts and
 * images browsers can display are decompressed.
 */

/** Position and size in EMUs (914400 per inch); rotation in degrees. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  baseline?: 'super' | 'sub';
  /** External http(s)/mailto link. */
  href?: string;
  /** An Office Math (OMML) element, rendered as MathML by the view. */
  math?: Element;
  /** Points. */
  size?: number;
  /** #rrggbb */
  color?: string;
  font?: string;
}

export interface Paragraph {
  runs: TextRun[];
  /** 0-based indent level. */
  level: number;
  /** Bullet or number text ("•", "3."), if the paragraph has one. */
  bullet?: string;
  bulletColor?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  /** Points; used for empty lines and bullets. */
  size?: number;
  /** Left margin and first-line indent (negative = hanging), EMUs. */
  marL?: number;
  indent?: number;
  /** Points. */
  spaceBefore?: number;
  /** Multiple of single spacing. */
  lineSpacing?: number;
}

export interface TextFrame {
  anchor: 'top' | 'middle' | 'bottom';
  /** Left, top, right, bottom insets in EMUs. */
  insets: [number, number, number, number];
  wrap: boolean;
}

export interface ShapeStyle {
  fill?: string;
  line?: string;
  /** EMUs. */
  lineWidth?: number;
  /** Preset geometry name (rect, ellipse, roundRect, rightArrow, ...), or "custom". */
  geometry?: string;
}

export interface TableCell {
  paragraphs: Paragraph[];
  colSpan: number;
  rowSpan: number;
  fill?: string;
}

export interface ChartData {
  type: string;
  title: string;
  /** Header for the category column ("Category", or "X" for scatter charts). */
  categoryLabel: string;
  categories: string[];
  series: { name: string; values: string[] }[];
}

export type Block =
  | { kind: 'text'; role: 'title' | 'subtitle' | 'body'; paragraphs: Paragraph[]; box: Box; frame: TextFrame; style: ShapeStyle }
  | { kind: 'image'; part: string | null; alt: string; label?: string; box: Box; crop?: Crop; style: ShapeStyle }
  | { kind: 'table'; rows: TableCell[][]; box: Box; colWidths: number[]; rowHeights: number[] }
  | { kind: 'chart'; chart: ChartData | null; box: Box }
  | { kind: 'diagram'; items: { text: string; level: number }[]; shapes: Block[]; box: Box }
  | { kind: 'line'; box: Box; color: string; width: number }
  | { kind: 'other'; label: string; box: Box };

/** Fractions cut from each side of a picture. */
export interface Crop {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface Background {
  color?: string;
  /** Image part path. */
  image?: string;
}

export interface Slide {
  number: number;
  hidden: boolean;
  title: string;
  /** Slide content in reading order. */
  blocks: Block[];
  /** Pictures and shapes from the layout and master, drawn behind the content. */
  decor: Block[];
  background: Background;
  notes: Paragraph[];
}

export interface Presentation {
  slides: Slide[];
  /** Slide size in EMUs. */
  width: number;
  height: number;
  /** Image bytes and MIME type for a part path from an image block. */
  image(part: string): { bytes: Uint8Array; mime: string } | null;
}

const MAX_PART_BYTES = 200 * 1024 * 1024;
const DEFAULT_SIZE = 18;

/** Image formats browsers can show; others (EMF, WMF, TIFF) get a placeholder. */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml',
};
const KEEP_PARTS = new RegExp(`\\.(xml|rels|${Object.keys(IMAGE_MIME).join('|')})$`, 'i');

const SYMBOL_FONTS = /wingdings|symbol|webdings|marlett/i;
const TITLE_TYPES = new Set(['title', 'ctrTitle']);
const OTHER_TYPES = new Set(['dt', 'ftr', 'sldNum']);
/** Placeholders that hold boilerplate rather than slide content. */
const SKIPPED_PLACEHOLDERS = new Set(['sldNum']);
/** mc:AlternateContent choices we can render; anything else uses the fallback. */
const SUPPORTED_CHOICE = /^(a14|cx\d*)$/;

const CHART_NAMES: Record<string, string> = {
  barChart: 'Bar chart', bar3DChart: 'Bar chart', lineChart: 'Line chart', line3DChart: 'Line chart',
  pieChart: 'Pie chart', pie3DChart: 'Pie chart', ofPieChart: 'Pie chart', doughnutChart: 'Doughnut chart',
  areaChart: 'Area chart', area3DChart: 'Area chart', scatterChart: 'Scatter chart', bubbleChart: 'Bubble chart',
  radarChart: 'Radar chart', stockChart: 'Stock chart', surfaceChart: 'Surface chart', surface3DChart: 'Surface chart',
};

// ---- Contexts ----------------------------------------------------------------------------

interface Theme {
  colors: Record<string, string>;
  major: string;
  minor: string;
}

/** A placeholder on a layout or master. */
interface PlaceholderInfo {
  box?: Box;
  spPr: Element | null;
  bodyPr: Element | null;
  lstStyle: Element | null;
}

interface PlaceholderSet {
  byIdx: Map<string, PlaceholderInfo>;
  byType: Map<string, PlaceholderInfo>;
}

/** Context for reading one part (slide, layout, master, notes, SmartArt drawing). */
interface PartContext {
  files: Record<string, Uint8Array>;
  rels: Map<string, Relationship>;
  /** Layout then master placeholders (for slides). */
  inherited: PlaceholderSet[];
  /** Master text styles, and the presentation's default text style. */
  styles: { title: Element | null; body: Element | null; other: Element | null; default: Element | null };
  theme: Theme;
  /** Master color map: bg1 -> lt1, tx1 -> dk1, ... */
  clrMap: Record<string, string>;
  width: number;
  height: number;
}

interface Positioned {
  box: Box;
  order: number;
  blocks: Block[];
  isTitle: boolean;
}

// ---- Presentation ------------------------------------------------------------------------

export function readPresentation(bytes: Uint8Array, maxTotalBytes = MAX_PART_BYTES): Presentation {
  const files = unzipParts(bytes, maxTotalBytes, KEEP_PARTS);
  const text = (path: string | undefined) => (path && files[path] ? decode(files[path]!) : null);

  const rootRels = relsFor(files, '');
  const presPath = [...rootRels.values()].find((r) => r.type.endsWith('/officeDocument'))?.target ?? 'ppt/presentation.xml';
  const presXml = text(presPath);
  if (!presXml) throw new Error('this is not a PowerPoint presentation');
  const pres = parseXml(presXml);
  const presRels = relsFor(files, presPath);
  const sldSz = first(pres, 'sldSz');
  const width = Number(attr(sldSz, 'cx')) || 12192000;
  const height = Number(attr(sldSz, 'cy')) || 6858000;
  const defaultTextStyle = first(pres, 'defaultTextStyle');

  const docs = new Map<string, Document | null>();
  const docOf = (path: string | undefined) => {
    if (!path) return null;
    if (!docs.has(path)) {
      const xml = text(path);
      docs.set(path, xml ? parseXml(xml) : null);
    }
    return docs.get(path)!;
  };
  const relOfType = (rels: Map<string, Relationship>, suffix: string) =>
    [...rels.values()].find((r) => !r.external && r.type.endsWith(suffix))?.target;

  // Masters and layouts are shared by many slides; read each once.
  const masters = new Map<string, { ctx: PartContext; placeholders: PlaceholderSet; doc: Document; decor: Block[] }>();
  const masterOf = (path: string | undefined) => {
    const doc = docOf(path);
    if (!path || !doc) return null;
    if (!masters.has(path)) {
      const rels = relsFor(files, path);
      const txStyles = first(doc, 'txStyles');
      const clrMap: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
      for (const a of first(doc, 'clrMap')?.attributes ?? []) clrMap[a.localName] = a.value;
      const ctx: PartContext = {
        files,
        rels,
        inherited: [],
        styles: {
          title: txStyles && kid(txStyles, 'titleStyle'),
          body: txStyles && kid(txStyles, 'bodyStyle'),
          other: txStyles && kid(txStyles, 'otherStyle'),
          default: defaultTextStyle,
        },
        theme: readTheme(text(relOfType(rels, '/theme'))),
        clrMap,
        width,
        height,
      };
      masters.set(path, { ctx, placeholders: collectPlaceholders(doc), doc, decor: readShapeTree(first(doc, 'spTree'), ctx, true) });
    }
    return masters.get(path)!;
  };
  const layouts = new Map<string, { ctx: PartContext; placeholders: PlaceholderSet; doc: Document; decor: Block[] } | null>();
  const layoutOf = (path: string | undefined) => {
    const doc = docOf(path);
    if (!path || !doc) return null;
    if (!layouts.has(path)) {
      const rels = relsFor(files, path);
      const master = masterOf(relOfType(rels, '/slideMaster'));
      const ctx: PartContext = master ? { ...master.ctx, rels } : { ...fallbackContext(files, rels, width, height, defaultTextStyle) };
      layouts.set(path, { ctx, placeholders: collectPlaceholders(doc), doc, decor: readShapeTree(first(doc, 'spTree'), ctx, true) });
    }
    return layouts.get(path)!;
  };

  const slides: Slide[] = [];
  const whole: Box = { x: 0, y: 0, w: width, h: height };
  for (const id of all(first(pres, 'sldIdLst') ?? pres, 'sldId')) {
    const rel = presRels.get(relId(id) ?? '');
    const number = slides.length + 1;
    const doc = rel && !rel.external ? docOf(rel.target) : null;
    if (!rel || !doc) {
      slides.push({ number, hidden: false, title: '', blocks: [{ kind: 'other', label: 'This slide is missing from the file.', box: whole }], decor: [], background: {}, notes: [] });
      continue;
    }
    const path = rel.target;
    const rels = relsFor(files, path);
    const layoutPath = relOfType(rels, '/slideLayout');
    const layout = layoutOf(layoutPath);
    const master = layoutPath ? masterOf(relOfType(relsFor(files, layoutPath), '/slideMaster')) : null;
    const base = master?.ctx ?? layout?.ctx ?? fallbackContext(files, rels, width, height, defaultTextStyle);
    const ctx: PartContext = { ...base, rels, inherited: [layout?.placeholders, master?.placeholders].filter((p): p is PlaceholderSet => !!p) };
    const blocks = readShapeTree(first(doc, 'spTree'), ctx, false);
    const titleBlock = blocks.find((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text' && b.role === 'title');

    // Layout shapes, and master shapes unless the layout hides them.
    let decor: Block[] = [];
    if (flag(doc.documentElement, 'showMasterSp', true) && layout) {
      decor = flag(layout.doc.documentElement, 'showMasterSp', true) && master ? [...master.decor, ...layout.decor] : layout.decor;
    }
    const background =
      backgroundOf(doc, ctx) ??
      (layout && backgroundOf(layout.doc, layout.ctx)) ??
      (master && backgroundOf(master.doc, master.ctx)) ?? { color: colorFor('bg1', ctx) };

    let notes: Paragraph[] = [];
    const notesPath = relOfType(rels, '/notesSlide');
    const notesDoc = docOf(notesPath);
    if (notesPath && notesDoc) {
      const notesCtx: PartContext = { ...ctx, rels: relsFor(files, notesPath), inherited: [] };
      for (const sp of all(notesDoc, 'sp')) {
        if (placeholderOf(sp)?.type !== 'body') continue;
        const body = kid(sp, 'txBody');
        if (body) notes = notes.concat(readParagraphs(body, notesCtx, { lists: [], tail: [] }, 1));
      }
      notes = trimEmpty(notes);
    }

    slides.push({
      number,
      hidden: !flag(doc.documentElement, 'show', true),
      title: titleBlock ? paragraphsText(titleBlock.paragraphs) : '',
      blocks,
      decor,
      background,
      notes,
    });
  }

  return {
    slides,
    width,
    height,
    image(part) {
      const ext = part.slice(part.lastIndexOf('.') + 1).toLowerCase();
      const data = files[part];
      return data && IMAGE_MIME[ext] ? { bytes: data, mime: IMAGE_MIME[ext]! } : null;
    },
  };
}

function fallbackContext(files: Record<string, Uint8Array>, rels: Map<string, Relationship>, width: number, height: number, defaultStyle: Element | null): PartContext {
  return {
    files,
    rels,
    inherited: [],
    styles: { title: null, body: null, other: null, default: defaultStyle },
    theme: readTheme(null),
    clrMap: { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' },
    width,
    height,
  };
}

/** Plain text of paragraphs (for slide titles and tooltips). */
export function paragraphsText(paragraphs: Paragraph[]): string {
  return paragraphs
    .map((p) => p.runs.map((r) => (r.math ? r.math.textContent ?? '' : r.text)).join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Theme and colors --------------------------------------------------------------------

const THEME_COLORS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

function readTheme(xml: string | null): Theme {
  const theme: Theme = {
    colors: {
      dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31',
      accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72',
    },
    major: 'Calibri Light',
    minor: 'Calibri',
  };
  if (!xml) return theme;
  const doc = parseXml(xml);
  const scheme = first(doc, 'clrScheme');
  for (const name of THEME_COLORS) {
    const entry = scheme && kid(scheme, name);
    const value = entry && (attr(first(entry, 'srgbClr'), 'val') ?? attr(first(entry, 'sysClr'), 'lastClr'));
    if (value && /^[0-9A-F]{6}$/i.test(value)) theme.colors[name] = value;
  }
  const major = attr(first(first(doc, 'majorFont') ?? doc, 'latin'), 'typeface');
  const minor = attr(first(first(doc, 'minorFont') ?? doc, 'latin'), 'typeface');
  if (major) theme.major = cleanFont(major);
  if (minor) theme.minor = cleanFont(minor);
  return theme;
}

const cleanFont = (name: string) => name.replace(/["'\\;{}<>]/g, '').trim();

function fontFor(typeface: string | null, ctx: PartContext): string | undefined {
  if (!typeface) return undefined;
  if (typeface.startsWith('+mj')) return ctx.theme.major;
  if (typeface.startsWith('+mn')) return ctx.theme.minor;
  return cleanFont(typeface) || undefined;
}

const PRESET_COLORS: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080', darkBlue: '00008B', darkRed: '8B0000',
  darkGreen: '006400', lightGray: 'D3D3D3', lightGrey: 'D3D3D3', navy: '000080', cyan: '00FFFF', magenta: 'FF00FF',
};
const COLOR_TAGS = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr']);

/** Theme color by scheme name (bg1, tx1, accent1, ...), through the master's color map. */
function colorFor(name: string, ctx: PartContext): string | undefined {
  const hex = ctx.theme.colors[ctx.clrMap[name] ?? name];
  return hex ? `#${hex.toLowerCase()}` : undefined;
}

/** The color inside `holder` (solidFill, fontRef, buClr, ...), with tint/shade/luminance applied. */
function colorOf(holder: Element | null, ctx: PartContext): string | undefined {
  const c = holder && [...holder.children].find((e) => COLOR_TAGS.has(e.localName));
  if (!c) return undefined;
  let hex: string | undefined;
  switch (c.localName) {
    case 'srgbClr':
      hex = attr(c, 'val') ?? undefined;
      break;
    case 'sysClr':
      hex = attr(c, 'lastClr') ?? (attr(c, 'val') === 'window' ? 'FFFFFF' : '000000');
      break;
    case 'schemeClr':
      hex = colorFor(attr(c, 'val') ?? '', ctx)?.slice(1);
      break;
    case 'prstClr':
      hex = PRESET_COLORS[attr(c, 'val') ?? ''];
      break;
    case 'scrgbClr':
      hex = ['r', 'g', 'b'].map((k) => channel((Number(attr(c, k)) / 100000) * 255)).join('');
      break;
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  if (c.children.length && [...c.children].some((m) => m.localName === 'alpha' && Number(attr(m, 'val')) === 0)) return undefined;
  return `#${applyColorMods(hex, c)}`;
}

const channel = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

function applyColorMods(hex: string, color: Element): string {
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  for (const mod of color.children) {
    const v = Number(attr(mod, 'val')) / 100000;
    if (!Number.isFinite(v)) continue;
    if (mod.localName === 'tint') [r, g, b] = [r, g, b].map((c) => c * v + 255 * (1 - v)) as [number, number, number];
    else if (mod.localName === 'shade') [r, g, b] = [r, g, b].map((c) => c * v) as [number, number, number];
    else if (mod.localName === 'lumMod' || mod.localName === 'lumOff') {
      const [h, s, l] = toHsl(r, g, b);
      [r, g, b] = fromHsl(h, s, Math.min(1, Math.max(0, mod.localName === 'lumMod' ? l * v : l + v)));
    }
  }
  return [r, g, b].map(channel).join('');
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

/** Fill of a spPr/bgPr/tcPr: a color, 'none', or undefined when not specified. */
function fillOf(props: Element | null, ctx: PartContext): string | undefined {
  if (!props) return undefined;
  for (const c of props.children) {
    switch (c.localName) {
      case 'noFill':
        return 'none';
      case 'solidFill':
        return colorOf(c, ctx) ?? 'none';
      case 'gradFill':
        return colorOf(first(c, 'gs'), ctx) ?? 'none';
      case 'pattFill':
        return colorOf(kid(c, 'fgClr'), ctx) ?? 'none';
    }
  }
  return undefined;
}

function shapeStyleOf(node: Element, ctx: PartContext, inheritedSpPr: (Element | null)[] = []): ShapeStyle {
  const spPr = kid(node, 'spPr');
  const ref = kid(node, 'style');
  const style: ShapeStyle = {};
  const geom = spPr && kid(spPr, 'prstGeom');
  style.geometry = geom ? attr(geom, 'prst') ?? 'rect' : spPr && kid(spPr, 'custGeom') ? 'custom' : 'rect';

  let fill = fillOf(spPr, ctx);
  for (const props of inheritedSpPr) fill ??= fillOf(props, ctx);
  const fillRef = ref && kid(ref, 'fillRef');
  if (fill === undefined && fillRef && Number(attr(fillRef, 'idx')) > 0) fill = colorOf(fillRef, ctx);
  if (fill && fill !== 'none') style.fill = fill;

  const ln = spPr && kid(spPr, 'ln');
  const lnRef = ref && kid(ref, 'lnRef');
  let line: string | undefined;
  if (ln && kid(ln, 'noFill')) line = undefined;
  else if (ln && (kid(ln, 'solidFill') || kid(ln, 'gradFill'))) line = fillOf(ln, ctx);
  else if (lnRef && Number(attr(lnRef, 'idx')) > 0) line = colorOf(lnRef, ctx);
  if (line && line !== 'none') {
    style.line = line;
    style.lineWidth = Number(attr(ln, 'w')) || 12700;
  }
  return style;
}

function backgroundOf(doc: Document, ctx: PartContext): Background | null {
  const bg = first(first(doc, 'cSld') ?? doc, 'bg');
  if (!bg) return null;
  const bgPr = kid(bg, 'bgPr');
  if (bgPr) {
    const blip = first(kid(bgPr, 'blipFill') ?? bgPr, 'blip');
    const rel = blip && ctx.rels.get(attr(blip, 'embed') ?? '');
    if (rel && !rel.external && ctx.files[rel.target]) return { image: rel.target };
    const fill = fillOf(bgPr, ctx);
    return fill && fill !== 'none' ? { color: fill } : null;
  }
  const color = colorOf(kid(bg, 'bgRef'), ctx);
  return color ? { color } : null;
}

// ---- Placeholders ------------------------------------------------------------------------

function placeholderOf(shape: Element): { type: string; idx: string | null } | null {
  const nv = [...shape.children].find((c) => c.localName.startsWith('nv'));
  const ph = nv && first(nv, 'ph');
  if (!ph) return null;
  return { type: attr(ph, 'type') ?? 'obj', idx: attr(ph, 'idx') };
}

function boxOf(xfrm: Element | null): Box | undefined {
  const off = xfrm && kid(xfrm, 'off');
  const ext = xfrm && kid(xfrm, 'ext');
  if (!off || !ext) return undefined;
  const box: Box = {
    x: Number(attr(off, 'x')) || 0,
    y: Number(attr(off, 'y')) || 0,
    w: Math.max(0, Number(attr(ext, 'cx')) || 0),
    h: Math.max(0, Number(attr(ext, 'cy')) || 0),
  };
  const rot = (Number(attr(xfrm, 'rot')) || 0) / 60000;
  if (rot) box.rot = rot;
  if (flag(xfrm, 'flipH')) box.flipH = true;
  if (flag(xfrm, 'flipV')) box.flipV = true;
  return box;
}

function collectPlaceholders(doc: Document): PlaceholderSet {
  const set: PlaceholderSet = { byIdx: new Map(), byType: new Map() };
  for (const sp of all(doc, 'sp')) {
    const ph = placeholderOf(sp);
    if (!ph) continue;
    const spPr = kid(sp, 'spPr');
    const body = kid(sp, 'txBody');
    const info: PlaceholderInfo = {
      box: boxOf(spPr && kid(spPr, 'xfrm')),
      spPr,
      bodyPr: body && kid(body, 'bodyPr'),
      lstStyle: body && kid(body, 'lstStyle'),
    };
    if (ph.idx !== null && !set.byIdx.has(ph.idx)) set.byIdx.set(ph.idx, info);
    if (!set.byType.has(ph.type)) set.byType.set(ph.type, info);
  }
  return set;
}

/** The layout/master placeholders a slide placeholder inherits from, nearest first. */
function inheritedPlaceholders(ph: { type: string; idx: string | null }, ctx: PartContext): PlaceholderInfo[] {
  const found: PlaceholderInfo[] = [];
  // Masters only have title/body/dt/ftr/sldNum; other types map onto those.
  const masterType = TITLE_TYPES.has(ph.type) ? 'title' : OTHER_TYPES.has(ph.type) ? ph.type : 'body';
  ctx.inherited.forEach((set, i) => {
    const match =
      (ph.idx !== null && i === 0 ? set.byIdx.get(ph.idx) : undefined) ??
      set.byType.get(ph.type) ??
      (TITLE_TYPES.has(ph.type) ? set.byType.get(ph.type === 'title' ? 'ctrTitle' : 'title') : undefined) ??
      (i > 0 ? set.byType.get(masterType) : undefined);
    if (match) found.push(match);
  });
  return found;
}

// ---- Shapes ------------------------------------------------------------------------------

/**
 * All content of a shape tree, in reading order: titles first, then top-to-bottom,
 * left-to-right. `decorOnly` reads a layout or master: placeholders are skipped (their
 * text is prompt text like "Click to add title").
 */
function readShapeTree(tree: Element | null, ctx: PartContext, decorOnly: boolean, transform: (b: Box) => Box = (b) => b): Block[] {
  if (!tree) return [];
  const items: Positioned[] = [];
  collectShapes(tree, ctx, items, transform, decorOnly);
  // Group boxes into horizontal bands so side-by-side boxes read left to right.
  const band = ctx.width * 0.04;
  items.sort(
    (a, b) =>
      Number(b.isTitle) - Number(a.isTitle) ||
      Math.floor(a.box.y / band) - Math.floor(b.box.y / band) ||
      a.box.x - b.box.x ||
      a.order - b.order,
  );
  // Keep captions with their pictures: text just below a picture and centered within
  // its width follows that picture (instead of after the whole row of pictures).
  const paired = new Set<Positioned>();
  for (let i = 0; i < items.length; i++) {
    const picture = items[i]!;
    if (picture.blocks[0]?.kind !== 'image') continue;
    const bottom = picture.box.y + picture.box.h;
    const j = items.findIndex((item, k) => {
      if (k <= i || paired.has(item) || item.blocks[0]?.kind !== 'text') return false;
      const center = item.box.x + item.box.w / 2;
      return (
        center >= picture.box.x && center <= picture.box.x + picture.box.w &&
        item.box.y >= bottom - picture.box.h * 0.25 && item.box.y <= bottom + ctx.height * 0.12
      );
    });
    if (j < 0) continue;
    const [caption] = items.splice(j, 1);
    items.splice(i + 1, 0, caption!);
    paired.add(caption!);
  }
  return items.flatMap((item) => item.blocks);
}

function collectShapes(container: Element, ctx: PartContext, out: Positioned[], transform: (b: Box) => Box, decorOnly: boolean) {
  for (const node of container.children) {
    if (node.localName === 'AlternateContent') {
      const chosen = chooseAlternate(node);
      if (chosen) collectShapes(chosen, ctx, out, transform, decorOnly);
      continue;
    }
    if (node.localName === 'grpSp') {
      const xfrm = first(kid(node, 'grpSpPr') ?? node, 'xfrm');
      const outer = boxOf(xfrm);
      const chOff = xfrm && kid(xfrm, 'chOff');
      const chExt = xfrm && kid(xfrm, 'chExt');
      if (!outer) {
        collectShapes(node, ctx, out, transform, decorOnly);
        continue;
      }
      const sx = outer.w / (Number(attr(chExt, 'cx')) || outer.w || 1) || 1;
      const sy = outer.h / (Number(attr(chExt, 'cy')) || outer.h || 1) || 1;
      const cx = Number(attr(chOff, 'x')) || 0;
      const cy = Number(attr(chOff, 'y')) || 0;
      collectShapes(node, ctx, out, (b) => transform({ ...b, x: outer.x + (b.x - cx) * sx, y: outer.y + (b.y - cy) * sy, w: b.w * sx, h: b.h * sy }), decorOnly);
      continue;
    }
    if (!['sp', 'pic', 'graphicFrame', 'cxnSp', 'contentPart'].includes(node.localName)) continue;

    const ph = placeholderOf(node);
    if (ph && (decorOnly || SKIPPED_PLACEHOLDERS.has(ph.type))) continue;
    const inherited = ph ? inheritedPlaceholders(ph, ctx) : [];
    const ownBox = boxOf(shapeXfrm(node));
    const box = ownBox ? transform(ownBox) : inherited.find((i) => i.box)?.box ?? { x: 0, y: ctx.height * 0.85, w: ctx.width, h: ctx.height * 0.15 };

    let blocks: Block[] = [];
    if (node.localName === 'sp' || node.localName === 'cxnSp') blocks = readShape(node, ph, inherited, ctx, box, transform);
    else if (node.localName === 'pic') blocks = [readPicture(node, ctx, box)];
    else if (node.localName === 'graphicFrame') blocks = readGraphicFrame(node, ctx, box);
    else blocks = [{ kind: 'other', label: 'Ink drawing (not shown)', box }];
    if (!blocks.length) continue;
    out.push({ box, order: out.length, blocks, isTitle: !!ph && TITLE_TYPES.has(ph.type) });
  }
}

function shapeXfrm(node: Element): Element | null {
  const props = kid(node, 'spPr') ?? kid(node, 'grpSpPr');
  if (props) return kid(props, 'xfrm');
  return kid(node, 'xfrm'); // graphicFrame keeps p:xfrm directly
}

function chooseAlternate(node: Element): Element | null {
  const choice = kid(node, 'Choice');
  const fallback = kid(node, 'Fallback');
  const requires = (attr(choice, 'Requires') ?? '').split(/\s+/).filter(Boolean);
  if (choice && requires.every((r) => SUPPORTED_CHOICE.test(r))) return choice;
  return fallback ?? choice;
}

function readShape(sp: Element, ph: { type: string } | null, inherited: PlaceholderInfo[], ctx: PartContext, box: Box, transform: (b: Box) => Box): Block[] {
  const style = shapeStyleOf(sp, ctx, inherited.map((i) => i.spPr));
  if (sp.localName === 'cxnSp' || style.geometry === 'line' || style.geometry?.includes('Connector')) {
    return style.line ? [{ kind: 'line', box, color: style.line, width: style.lineWidth ?? 12700 }] : [];
  }

  const blocks: Block[] = [];
  const spPr = kid(sp, 'spPr');
  const blipFill = spPr && kid(spPr, 'blipFill');
  if (blipFill) {
    blocks.push(imageBlock(blipFill, sp, ctx, box, { geometry: style.geometry, line: style.line, lineWidth: style.lineWidth }));
    delete style.line;
  }

  const body = kid(sp, 'txBody');
  const isTitle = !!ph && TITLE_TYPES.has(ph.type);
  const fontRefColor = colorOf(kid(kid(sp, 'style') ?? sp, 'fontRef'), ctx);
  const tail = ph
    ? [isTitle ? ctx.styles.title : OTHER_TYPES.has(ph.type) ? ctx.styles.other : ctx.styles.body]
    : [ctx.styles.other, ctx.styles.default];
  const chain: TextChain = { lists: [body && kid(body, 'lstStyle'), ...inherited.map((i) => i.lstStyle)], fallbackColor: fontRefColor, tail };
  const bodies = [body && kid(body, 'bodyPr'), ...inherited.map((i) => i.bodyPr)];
  const fontScale = (Number(attr(first(bodies[0] ?? sp, 'normAutofit'), 'fontScale')) || 100000) / 100000;
  const paragraphs = body ? trimEmpty(readParagraphs(body, ctx, chain, fontScale)) : [];

  // SmartArt drawings place text in its own rectangle (txXfrm) inside the shape.
  const txBox = boxOf(kid(sp, 'txXfrm'));
  const role = isTitle ? 'title' : ph?.type === 'subTitle' ? 'subtitle' : 'body';
  const frame = frameOf(bodies);
  if (txBox && paragraphs.length) {
    if (style.fill || style.line) blocks.push({ kind: 'text', role, paragraphs: [], box, frame, style });
    blocks.push({ kind: 'text', role, paragraphs, box: transform(txBox), frame, style: {} });
  } else if (paragraphs.length || style.fill || style.line) {
    blocks.push({ kind: 'text', role, paragraphs, box, frame, style });
  }
  return blocks;
}

function frameOf(bodies: (Element | null)[]): TextFrame {
  const get = (name: string) => {
    for (const body of bodies) {
      const value = attr(body, name);
      if (value !== null) return value;
    }
    return null;
  };
  const inset = (name: string, fallback: number) => {
    const value = Number(get(name));
    return get(name) !== null && Number.isFinite(value) ? value : fallback;
  };
  const anchor = get('anchor');
  return {
    anchor: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
    insets: [inset('lIns', 91440), inset('tIns', 45720), inset('rIns', 91440), inset('bIns', 45720)],
    wrap: get('wrap') !== 'none',
  };
}

function readPicture(pic: Element, ctx: PartContext, box: Box): Block {
  const nvPr = first(kid(pic, 'nvPicPr') ?? pic, 'nvPr');
  const media = nvPr && [...nvPr.getElementsByTagNameNS('*', '*')].find((e) => ['videoFile', 'audioFile', 'quickTimeFile', 'media'].includes(e.localName));
  const style = shapeStyleOf(pic, ctx);
  delete style.fill;
  const block = imageBlock(kid(pic, 'blipFill') ?? first(pic, 'blipFill'), pic, ctx, box, style);
  if (media) {
    const audio = media.localName === 'audioFile' || /audio/i.test([...ctx.rels.values()].find((r) => r.target === attr(media, 'link'))?.type ?? '');
    block.label = audio ? 'Audio clip (not played; download the file to listen)' : 'Video (not played; download the file to watch)';
  }
  return block;
}

function imageBlock(blipFill: Element | null, shape: Element, ctx: PartContext, box: Box, style: ShapeStyle): Extract<Block, { kind: 'image' }> {
  const cNvPr = first(shape, 'cNvPr');
  const alt = attr(cNvPr, 'descr') ?? attr(cNvPr, 'title') ?? '';
  const block: Extract<Block, { kind: 'image' }> = { kind: 'image', part: null, alt, box, style };
  const blip = blipFill && first(blipFill, 'blip');
  const embed = ctx.rels.get(attr(blip, 'embed') ?? '');
  if (embed && !embed.external && ctx.files[embed.target]) {
    block.part = embed.target;
  } else if (attr(blip, 'link') || embed?.external) {
    block.label = 'Linked image (not loaded: it lives outside the file)';
  } else {
    const ext = embed?.target.split('.').pop()?.toUpperCase();
    block.label = ext ? `Image in ${ext} format (can’t be shown in the browser)` : 'Image (missing from the file)';
  }
  const src = blipFill && kid(blipFill, 'srcRect');
  if (src) {
    const side = (name: string) => Math.min(0.99, (Number(attr(src, name)) || 0) / 100000);
    const crop = { l: side('l'), t: side('t'), r: side('r'), b: side('b') };
    if (crop.l || crop.t || crop.r || crop.b) block.crop = crop;
  }
  return block;
}

function readGraphicFrame(frame: Element, ctx: PartContext, box: Box): Block[] {
  const data = first(frame, 'graphicData');
  const uri = attr(data, 'uri') ?? '';
  if (!data) return [];
  if (uri.endsWith('/table')) {
    const tbl = first(data, 'tbl');
    return tbl ? [readTable(tbl, ctx, box)] : [];
  }
  if (uri.endsWith('/chart')) {
    const rel = ctx.rels.get(attr(first(data, 'chart'), 'id') ?? '');
    const xml = rel && !rel.external && ctx.files[rel.target];
    return [{ kind: 'chart', chart: xml ? readChart(parseXml(decode(xml))) : null, box }];
  }
  if (uri.includes('chartex')) return [{ kind: 'chart', chart: null, box }];
  if (uri.endsWith('/diagram')) return [readDiagramFrame(data, ctx, box)];
  if (uri.endsWith('/ole')) {
    const ole = first(data, 'oleObj');
    const name = attr(ole, 'progId')?.split('.')[0] ?? '';
    const label = `Embedded ${name ? `${name} ` : ''}object (download the file to open it)`;
    const pic = first(data, 'pic');
    if (pic) return [{ ...imageBlock(first(pic, 'blipFill'), pic, ctx, box, {}), label }];
    return [{ kind: 'other', label, box }];
  }
  return [{ kind: 'other', label: 'Embedded content (not shown)', box }];
}

// ---- Text --------------------------------------------------------------------------------

type BulletSpec = { char: string } | { scheme: string; startAt: number } | null;

/** Where paragraph properties come from: list styles nearest first, then shape style color, then master/default styles. */
interface TextChain {
  lists: (Element | null)[];
  fallbackColor?: string;
  tail: (Element | null)[];
}

interface LevelProps {
  bullet?: BulletSpec;
  bulletColor?: string;
  align?: Paragraph['align'];
  marL?: number;
  indent?: number;
  lineSpacing?: number;
  spaceBefore?: number;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  baseline?: 'super' | 'sub';
  color?: string;
  font?: string;
}

const ALIGN: Record<string, Paragraph['align']> = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };

/** Bullet settings of a pPr / lvlNpPr: null for buNone, undefined when unspecified. */
function bulletOf(pPr: Element): BulletSpec | undefined {
  if (kid(pPr, 'buNone')) return null;
  const autoNum = kid(pPr, 'buAutoNum');
  if (autoNum) return { scheme: attr(autoNum, 'type') ?? 'arabicPeriod', startAt: Number(attr(autoNum, 'startAt')) || 1 };
  const char = kid(pPr, 'buChar');
  if (char) {
    const font = attr(kid(pPr, 'buFont'), 'typeface') ?? '';
    const value = attr(char, 'char') ?? '•';
    return { char: SYMBOL_FONTS.test(font) || !value.trim() ? '•' : value };
  }
  if (kid(pPr, 'buBlip')) return { char: '•' };
  return undefined;
}

function runPropsOf(rPr: Element | null, ctx: PartContext): LevelProps {
  const props: LevelProps = {};
  if (!rPr) return props;
  const size = Number(attr(rPr, 'sz'));
  if (size > 0) props.size = size / 100;
  if (attr(rPr, 'b') !== null) props.bold = flag(rPr, 'b');
  if (attr(rPr, 'i') !== null) props.italic = flag(rPr, 'i');
  const u = attr(rPr, 'u');
  if (u !== null) props.underline = u !== 'none';
  const strike = attr(rPr, 'strike');
  if (strike !== null) props.strike = strike !== 'noStrike';
  const baseline = Number(attr(rPr, 'baseline')) || 0;
  if (baseline) props.baseline = baseline > 0 ? 'super' : 'sub';
  const fill = kid(rPr, 'solidFill') ?? kid(rPr, 'gradFill');
  const color = fill && (fill.localName === 'solidFill' ? colorOf(fill, ctx) : colorOf(first(fill, 'gs'), ctx));
  if (color) props.color = color;
  const font = fontFor(attr(kid(rPr, 'latin'), 'typeface'), ctx);
  if (font) props.font = font;
  return props;
}

function levelPropsOf(pPr: Element | null, ctx: PartContext): LevelProps {
  if (!pPr) return {};
  const props = runPropsOf(kid(pPr, 'defRPr'), ctx);
  const bullet = bulletOf(pPr);
  if (bullet !== undefined) props.bullet = bullet;
  const bulletColor = colorOf(kid(pPr, 'buClr'), ctx);
  if (bulletColor) props.bulletColor = bulletColor;
  const align = ALIGN[attr(pPr, 'algn') ?? ''];
  if (align) props.align = align;
  if (attr(pPr, 'marL') !== null) props.marL = Number(attr(pPr, 'marL')) || 0;
  if (attr(pPr, 'indent') !== null) props.indent = Number(attr(pPr, 'indent')) || 0;
  const spacing = Number(attr(first(kid(pPr, 'lnSpc') ?? pPr, 'spcPct'), 'val'));
  if (kid(pPr, 'lnSpc') && spacing > 0) props.lineSpacing = spacing / 100000;
  const before = kid(pPr, 'spcBef');
  const beforePts = before && Number(attr(kid(before, 'spcPts'), 'val'));
  if (beforePts !== null && beforePts !== undefined && Number.isFinite(beforePts)) props.spaceBefore = beforePts / 100;
  return props;
}

function mergeProps(into: LevelProps, from: LevelProps) {
  for (const [key, value] of Object.entries(from) as [keyof LevelProps, unknown][]) {
    if (into[key] === undefined && value !== undefined) (into as Record<string, unknown>)[key] = value;
  }
}

function readParagraphs(body: Element, ctx: PartContext, chain: TextChain, fontScale: number): Paragraph[] {
  const cache = new Map<number, LevelProps>();
  const levelProps = (level: number) => {
    if (!cache.has(level)) {
      const props: LevelProps = {};
      const fromList = (list: Element | null) => mergeProps(props, levelPropsOf(list && kid(list, `lvl${level + 1}pPr`), ctx));
      chain.lists.forEach(fromList);
      if (props.color === undefined && chain.fallbackColor) props.color = chain.fallbackColor;
      chain.tail.forEach(fromList);
      cache.set(level, props);
    }
    return cache.get(level)!;
  };

  const paragraphs: Paragraph[] = [];
  // Running numbers per level; reset by shallower paragraphs or unnumbered ones.
  const counters: (number | undefined)[] = [];
  for (const p of kids(body, 'p')) {
    const pPr = kid(p, 'pPr');
    const level = Math.min(8, Math.max(0, Number(attr(pPr, 'lvl')) || 0));
    const props = levelPropsOf(pPr, ctx);
    mergeProps(props, levelProps(level));
    const paragraph: Paragraph = { runs: readRuns(p, ctx, props, fontScale), level };
    const size = (runPropsOf(kid(p, 'endParaRPr'), ctx).size ?? props.size ?? DEFAULT_SIZE) * fontScale;
    paragraph.size = paragraph.runs.find((r) => r.size)?.size ?? size;
    if (props.align) paragraph.align = props.align;
    if (props.marL !== undefined) paragraph.marL = props.marL;
    if (props.indent !== undefined) paragraph.indent = props.indent;
    if (props.spaceBefore !== undefined) paragraph.spaceBefore = props.spaceBefore * fontScale;
    if (props.lineSpacing !== undefined) paragraph.lineSpacing = props.lineSpacing;

    counters.length = Math.min(counters.length, level + 1);
    const hasText = paragraph.runs.some((r) => r.math || r.text.trim());
    const spec = props.bullet;
    if (spec && hasText) {
      if ('char' in spec) {
        paragraph.bullet = spec.char;
        counters[level] = undefined;
      } else {
        const n = counters[level] === undefined ? spec.startAt : counters[level]! + 1;
        counters[level] = n;
        paragraph.bullet = autoNumber(n, spec.scheme);
      }
      paragraph.bulletColor = props.bulletColor ?? paragraph.runs.find((r) => r.color)?.color;
    } else if (hasText) {
      counters[level] = undefined;
    }
    paragraphs.push(paragraph);
  }
  return paragraphs;
}

function readRuns(p: Element, ctx: PartContext, base: LevelProps, fontScale: number): TextRun[] {
  const runs: TextRun[] = [];
  const styled = (text: string, rPr: Element | null): TextRun => {
    const props = runPropsOf(rPr, ctx);
    const link = ctx.rels.get(attr(rPr && kid(rPr, 'hlinkClick'), 'id') ?? '');
    const href = link?.external && /^(https?:|mailto:)/i.test(link.target.trim()) ? link.target.trim() : undefined;
    if (href && !props.color) props.color = colorFor('hlink', ctx);
    if (href && props.underline === undefined) props.underline = true;
    mergeProps(props, base);
    const run: TextRun = { text, size: (props.size ?? DEFAULT_SIZE) * fontScale, color: props.color ?? colorFor('tx1', ctx) };
    if (props.bold) run.bold = true;
    if (props.italic) run.italic = true;
    if (props.underline) run.underline = true;
    if (props.strike) run.strike = true;
    if (props.baseline) run.baseline = props.baseline;
    if (props.font) run.font = props.font;
    if (href) run.href = href;
    return run;
  };
  const visit = (node: Element) => {
    for (const child of node.children) {
      switch (child.localName) {
        case 'r':
        case 'fld': {
          const text = kid(child, 't')?.textContent ?? '';
          if (text) runs.push(styled(text, kid(child, 'rPr')));
          break;
        }
        case 'br':
          runs.push({ ...styled('\n', kid(child, 'rPr')), text: '\n' });
          break;
        case 'm': {
          // a14:m wraps Office Math: one oMath, or an oMathPara with several.
          for (const math of all(child, 'oMath')) runs.push({ ...styled('', null), math });
          break;
        }
        case 'AlternateContent': {
          const chosen = chooseAlternate(child);
          if (chosen) visit(chosen);
          break;
        }
      }
    }
  };
  visit(p);
  return runs;
}

function trimEmpty(paragraphs: Paragraph[]): Paragraph[] {
  const empty = (p: Paragraph | undefined) => !!p && !p.runs.some((r) => r.math || r.text.trim());
  const out = [...paragraphs];
  while (empty(out[0])) out.shift();
  while (empty(out[out.length - 1])) out.pop();
  return out;
}

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

/** Number text for an autonumber scheme such as arabicPeriod, alphaUcParenR, romanLcParenBoth. */
export function autoNumber(n: number, scheme: string): string {
  let value: string;
  if (scheme.startsWith('alpha')) {
    let s = '';
    for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
    value = s;
  } else if (scheme.startsWith('roman')) {
    let s = '';
    let k = n;
    for (const [v, sym] of ROMAN) while (k >= v) (s += sym), (k -= v);
    value = s;
  } else {
    value = String(n);
  }
  if (/Uc/.test(scheme)) value = value.toUpperCase();
  if (scheme.endsWith('ParenBoth')) return `(${value})`;
  if (scheme.endsWith('ParenR')) return `${value})`;
  if (scheme.endsWith('Plain')) return value;
  if (scheme.endsWith('Minus')) return `- ${value} -`;
  return `${value}.`;
}

// ---- Tables, charts, SmartArt ------------------------------------------------------------

function readTable(tbl: Element, ctx: PartContext, box: Box): Block {
  const chain: TextChain = { lists: [], tail: [ctx.styles.default] };
  const rows: TableCell[][] = [];
  const rowHeights: number[] = [];
  for (const tr of kids(tbl, 'tr')) {
    const row: TableCell[] = [];
    rowHeights.push(Number(attr(tr, 'h')) || 0);
    for (const tc of kids(tr, 'tc')) {
      if (flag(tc, 'hMerge') || flag(tc, 'vMerge')) continue;
      const body = kid(tc, 'txBody');
      const cell: TableCell = {
        paragraphs: body ? trimEmpty(readParagraphs(body, ctx, chain, 1)) : [],
        colSpan: Math.max(1, Number(attr(tc, 'gridSpan')) || 1),
        rowSpan: Math.max(1, Number(attr(tc, 'rowSpan')) || 1),
      };
      const fill = fillOf(kid(tc, 'tcPr'), ctx);
      if (fill && fill !== 'none') cell.fill = fill;
      row.push(cell);
    }
    rows.push(row);
  }
  const grid = first(tbl, 'tblGrid');
  const colWidths = grid ? kids(grid, 'gridCol').map((c) => Number(attr(c, 'w')) || 0) : [];
  return { kind: 'table', rows, box, colWidths, rowHeights };
}

/** Values cached in a chart reference (strRef/numRef/strLit/numLit), by point index. */
function cachedValues(node: Element | null): string[] {
  if (!node) return [];
  const cache = first(node, 'strCache') ?? first(node, 'numCache') ?? first(node, 'strLit') ?? first(node, 'numLit') ?? first(node, 'multiLvlStrCache');
  if (!cache) return [];
  const code = first(cache, 'formatCode')?.textContent ?? 'General';
  const isNumber = cache.localName === 'numCache' || cache.localName === 'numLit';
  const count = Math.min(10_000, Number(attr(first(cache, 'ptCount'), 'val')) || 0);
  const values: string[] = new Array(count).fill('');
  // multiLvlStrCache has one lvl per level; the first is the innermost category.
  const points = cache.localName === 'multiLvlStrCache' ? kids(first(cache, 'lvl') ?? cache, 'pt') : kids(cache, 'pt');
  for (const pt of points) {
    const idx = Number(attr(pt, 'idx')) || 0;
    if (idx > 10_000) continue;
    const raw = kid(pt, 'v')?.textContent ?? '';
    const num = Number(raw);
    values[idx] = isNumber && raw !== '' && Number.isFinite(num) ? formatChartNumber(num, attr(pt, 'formatCode') ?? code) : raw;
  }
  return values;
}

function formatChartNumber(value: number, code: string): string {
  try {
    return formatNumber(value, code).text.trim();
  } catch {
    return formatGeneral(value);
  }
}

function readChart(doc: Document): ChartData {
  const plotArea = first(doc, 'plotArea');
  const typeEl = plotArea ? [...plotArea.children].find((c) => CHART_NAMES[c.localName]) : undefined;
  let type = typeEl ? CHART_NAMES[typeEl.localName]! : 'Chart';
  if (typeEl?.localName.startsWith('bar') && attr(first(typeEl, 'barDir'), 'val') === 'col') type = 'Column chart';
  const titleEl = first(first(doc, 'chart') ?? doc, 'title');
  const title = titleEl ? all(titleEl, 't').map((t) => t.textContent ?? '').join('') || cachedValues(first(titleEl, 'tx')).join(' ') : '';

  const series: ChartData['series'] = [];
  let categories: string[] = [];
  let categoryLabel = 'Category';
  for (const ser of plotArea ? all(plotArea, 'ser') : []) {
    const name = cachedValues(kid(ser, 'tx')).join(' ') || `Series ${series.length + 1}`;
    const values = cachedValues(kid(ser, 'val') ?? kid(ser, 'yVal'));
    const xVal = kid(ser, 'xVal');
    if (xVal) categoryLabel = 'X';
    const cats = cachedValues(kid(ser, 'cat') ?? xVal);
    if (cats.length > categories.length) categories = cats;
    series.push({ name, values });
  }
  const length = Math.max(categories.length, ...series.map((s) => s.values.length), 0);
  if (categories.length < length) {
    categories = Array.from({ length }, (_, i) => categories[i] || String(i + 1));
  }
  return { type, title, categoryLabel, categories, series };
}

/**
 * SmartArt: the text as an outline, plus the shapes PowerPoint saved for it (the
 * "drawing" part), placed relative to the graphic frame.
 */
function readDiagramFrame(data: Element, ctx: PartContext, box: Box): Block {
  const rel = ctx.rels.get(attr(first(data, 'relIds'), 'dm') ?? '');
  const dataXml = rel && !rel.external && ctx.files[rel.target];
  const dataDoc = dataXml ? parseXml(decode(dataXml)) : null;
  const items = dataDoc ? readDiagram(dataDoc) : [];

  let shapes: Block[] = [];
  const drawingId = attr(first(dataDoc ?? data, 'dataModelExt'), 'relId');
  const drawings = [...ctx.rels.entries()].filter(([, r]) => !r.external && r.type.endsWith('/diagramDrawing'));
  const drawingPath = (drawingId && ctx.rels.get(drawingId)?.target) ?? (drawings.length === 1 ? drawings[0]![1].target : undefined);
  const drawingXml = drawingPath && ctx.files[drawingPath];
  if (drawingPath && drawingXml) {
    const drawingCtx: PartContext = { ...ctx, rels: relsFor(ctx.files, drawingPath), inherited: [] };
    shapes = readShapeTree(first(parseXml(decode(drawingXml)), 'spTree'), drawingCtx, false, (b) => ({ ...b, x: box.x + b.x, y: box.y + b.y }));
  }
  return { kind: 'diagram', items, shapes, box };
}

/** SmartArt text, outline-style: each node's text with its depth in the hierarchy. */
function readDiagram(doc: Document): { text: string; level: number }[] {
  const points = new Map<string, { type: string; text: string }>();
  for (const pt of all(doc, 'pt')) {
    const type = attr(pt, 'type') ?? 'node';
    const textEl = kid(pt, 't');
    const text = textEl ? kids(textEl, 'p').map((p) => all(p, 't').map((t) => t.textContent ?? '').join('')).join(' ').trim() : '';
    points.set(attr(pt, 'modelId') ?? '', { type, text });
  }
  const children = new Map<string, { id: string; order: number }[]>();
  for (const cxn of all(doc, 'cxn')) {
    if ((attr(cxn, 'type') ?? 'parOf') !== 'parOf') continue;
    const src = attr(cxn, 'srcId') ?? '';
    const list = children.get(src) ?? [];
    list.push({ id: attr(cxn, 'destId') ?? '', order: Number(attr(cxn, 'srcOrd')) || 0 });
    children.set(src, list);
  }
  const items: { text: string; level: number }[] = [];
  const seen = new Set<string>();
  const walk = (id: string, level: number) => {
    if (seen.has(id) || items.length > 1000) return;
    seen.add(id);
    const point = points.get(id);
    if (point?.type === 'node' && point.text) items.push({ text: point.text, level: Math.max(0, level) });
    for (const child of (children.get(id) ?? []).sort((a, b) => a.order - b.order)) walk(child.id, level + 1);
  };
  const root = [...points.entries()].find(([, p]) => p.type === 'doc');
  if (root) walk(root[0], -1);
  else for (const [id, p] of points) if (p.type === 'node' && p.text && !seen.has(id)) items.push({ text: p.text, level: 0 });
  return items;
}
