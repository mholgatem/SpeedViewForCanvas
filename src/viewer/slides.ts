import { readPresentation, type Block, type Box, type ChartData, type Paragraph, type Presentation, type Slide, type TableCell, type TextRun } from '../render/pptx';
import { ommlToMathml } from './omml';
import type { ZoomableView } from './views';

/**
 * PowerPoint presentations, one card per slide with its speaker notes. Two modes:
 * "Slides" draws each slide at its real proportions with content placed where it sits
 * on the slide; "Text outline" lists the content in reading order. Built with
 * textContent, fixed element names, and validated style values; links were checked by
 * the reader (http(s)/mailto only) and images use blob: URLs of the file's own pictures.
 */

export interface SlidesView extends ZoomableView {
  slideCount: number;
  hiddenCount: number;
}

type Mode = 'slides' | 'outline';

export const DISCLAIMER = '*PowerPoint viewer is experimental, download and open in real document viewer for best experience';

const MAX_CHART_ROWS = 200;
const MAX_CARD_PX = 960;
/** EMUs per CSS pixel (96 dpi). */
const EMU_PER_PX = 9525;
const COLOR = /^#[0-9a-f]{6}$/i;

/** Remembered while the viewer is open, so each deck opens in the last mode used. */
let preferredMode: Mode = 'slides';

/** Preset shapes drawn with a clip path; others are drawn as rectangles. */
const CLIP_PATHS: Record<string, string> = {
  triangle: 'polygon(50% 0, 100% 100%, 0 100%)',
  rtTriangle: 'polygon(0 0, 100% 100%, 0 100%)',
  diamond: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
  parallelogram: 'polygon(25% 0, 100% 0, 75% 100%, 0 100%)',
  trapezoid: 'polygon(25% 0, 75% 0, 100% 100%, 0 100%)',
  pentagon: 'polygon(50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%)',
  hexagon: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
  octagon: 'polygon(29% 0, 71% 0, 100% 29%, 100% 71%, 71% 100%, 29% 100%, 0 71%, 0 29%)',
  homePlate: 'polygon(0 0, 80% 0, 100% 50%, 80% 100%, 0 100%)',
  chevron: 'polygon(0 0, 80% 0, 100% 50%, 80% 100%, 0 100%, 20% 50%)',
  rightArrow: 'polygon(0 25%, 70% 25%, 70% 0, 100% 50%, 70% 100%, 70% 75%, 0 75%)',
  leftArrow: 'polygon(30% 0, 30% 25%, 100% 25%, 100% 75%, 30% 75%, 30% 100%, 0 50%)',
  upArrow: 'polygon(50% 0, 100% 30%, 75% 30%, 75% 100%, 25% 100%, 25% 30%, 0 30%)',
  downArrow: 'polygon(25% 0, 75% 0, 75% 70%, 100% 70%, 50% 100%, 0 70%, 25% 70%)',
  star5: 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
};
const ROUND_SHAPES = new Set(['ellipse', 'flowChartConnector', 'donut', 'pie', 'chord']);

const px = (emu: number) => emu / EMU_PER_PX;
const ptPx = (pt: number) => (pt * 4) / 3;
const color = (value: string | undefined) => (value && COLOR.test(value) ? value : undefined);

export function renderSlidesView(container: HTMLElement, bytes: Uint8Array, zoom: number, maxTotalBytes: number): SlidesView {
  const presentation = readPresentation(bytes, maxTotalBytes);
  const urls = new Map<string, string>();
  const imageUrl = (part: string) => {
    if (!urls.has(part)) {
      const image = presentation.image(part);
      urls.set(part, image ? URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.mime })) : '');
    }
    return urls.get(part)!;
  };

  const root = el('div', 'slides-view');
  const bar = el('div', 'slides-bar');
  const disclaimer = el('div', 'slides-disclaimer', DISCLAIMER);
  const modes = el('div', 'slides-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Presentation view');
  const buttons: Record<Mode, HTMLButtonElement> = {
    slides: el('button', '', 'Slides'),
    outline: el('button', '', 'Text outline'),
  };
  buttons.slides.title = 'Show each slide as it is laid out';
  buttons.outline.title = 'Show the text and pictures of each slide in reading order';
  modes.append(buttons.slides, buttons.outline);
  bar.append(disclaimer, modes);
  const list = el('div', 'slides-list');
  root.append(bar, list);
  container.append(root);

  let mode = preferredMode;
  const stageWidth = px(presentation.width);

  /** Card width in slide mode: the available width (up to a cap), times the zoom. */
  const layout = () => {
    if (mode === 'outline') {
      list.style.setProperty('zoom', String(zoom));
      return;
    }
    list.style.removeProperty('zoom');
    const available = Math.max(240, (root.clientWidth || MAX_CARD_PX) - 34);
    const cardWidth = Math.min(MAX_CARD_PX, available) * zoom;
    for (const card of list.querySelectorAll<HTMLElement>('.slide-card')) card.style.width = `${cardWidth}px`;
    for (const stage of list.querySelectorAll<HTMLElement>('.slide-stage')) stage.style.setProperty('zoom', String(cardWidth / stageWidth));
  };

  const render = () => {
    list.replaceChildren();
    list.classList.toggle('outline', mode === 'outline');
    for (const [name, button] of Object.entries(buttons)) button.setAttribute('aria-pressed', String(name === mode));
    for (const slide of presentation.slides) list.append(renderCard(slide, presentation, mode, imageUrl));
    if (!presentation.slides.length) list.append(el('div', 'notice', 'This presentation has no slides.'));
    layout();
  };
  for (const [name, button] of Object.entries(buttons) as [Mode, HTMLButtonElement][]) {
    button.addEventListener('click', () => {
      if (mode === name) return;
      mode = preferredMode = name;
      render();
    });
  }
  render();

  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => layout());
  resize?.observe(root);

  return {
    slideCount: presentation.slides.length,
    hiddenCount: presentation.slides.filter((s) => s.hidden).length,
    setZoom(next) {
      zoom = next;
      layout();
    },
    destroy() {
      resize?.disconnect();
      root.remove();
      for (const url of urls.values()) if (url) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}

function renderCard(slide: Slide, pres: Presentation, mode: Mode, imageUrl: (part: string) => string): HTMLElement {
  const card = el('section', 'slide-card');
  card.dataset.slide = String(slide.number);
  card.setAttribute('aria-label', `Slide ${slide.number}`);
  const head = el('div', 'slide-head', `Slide ${slide.number}`);
  if (slide.hidden) {
    card.classList.add('hidden-slide');
    const badge = el('span', 'slide-badge', 'Hidden');
    badge.title = 'This slide is hidden and is skipped in the slide show';
    head.append(badge);
  }
  card.append(head, mode === 'slides' ? renderStage(slide, pres, imageUrl) : renderOutline(slide, pres, imageUrl));
  if (slide.notes.length) {
    const notes = el('div', 'slide-notes');
    notes.append(el('div', 'slide-notes-label', 'Speaker notes'));
    for (const p of collapseBlank(slide.notes)) notes.append(renderParagraph(p, false));
    card.append(notes);
  }
  return card;
}

// ---- Slide layout ------------------------------------------------------------------------

function renderStage(slide: Slide, pres: Presentation, imageUrl: (part: string) => string): HTMLElement {
  const frame = el('div', 'slide-frame');
  const stage = el('div', 'slide-stage');
  stage.style.width = `${px(pres.width)}px`;
  stage.style.height = `${px(pres.height)}px`;
  const bg = color(slide.background.color);
  if (bg) stage.style.backgroundColor = bg;
  const bgUrl = slide.background.image ? imageUrl(slide.background.image) : '';
  if (bgUrl) stage.style.backgroundImage = `url("${bgUrl}")`;
  for (const block of [...slide.decor, ...slide.blocks]) stage.append(...placeBlock(block, imageUrl));
  frame.append(stage);
  return frame;
}

function positioned(className: string, box: Box, flips = true): HTMLElement {
  const node = el('div', `sl-item ${className}`);
  node.style.left = `${px(box.x)}px`;
  node.style.top = `${px(box.y)}px`;
  node.style.width = `${px(box.w)}px`;
  node.style.height = `${px(box.h)}px`;
  const transforms: string[] = [];
  if (box.rot) transforms.push(`rotate(${box.rot}deg)`);
  if (flips && box.flipH) transforms.push('scaleX(-1)');
  if (flips && box.flipV) transforms.push('scaleY(-1)');
  if (transforms.length) node.style.transform = transforms.join(' ');
  return node;
}

/** Fill and outline of a shape, as a layer behind its text. */
function shapeLayer(style: { fill?: string; line?: string; lineWidth?: number; geometry?: string }, box: Box): HTMLElement | null {
  const fill = color(style.fill);
  const line = color(style.line);
  if (!fill && !line) return null;
  const layer = el('div', 'sl-fill');
  if (box.flipH || box.flipV) layer.style.transform = `scale(${box.flipH ? -1 : 1}, ${box.flipV ? -1 : 1})`;
  const clip = CLIP_PATHS[style.geometry ?? ''];
  if (fill) layer.style.backgroundColor = fill;
  if (clip) {
    layer.style.clipPath = clip;
    if (!fill && line) layer.style.backgroundColor = line;
  } else if (line) {
    layer.style.border = `${Math.max(1, px(style.lineWidth ?? 12700)).toFixed(2)}px solid ${line}`;
  }
  if (ROUND_SHAPES.has(style.geometry ?? '')) layer.style.borderRadius = '50%';
  else if (style.geometry === 'roundRect') layer.style.borderRadius = `${(Math.min(px(box.w), px(box.h)) * 0.1667).toFixed(1)}px`;
  return layer;
}

function placeBlock(block: Block, imageUrl: (part: string) => string): HTMLElement[] {
  switch (block.kind) {
    case 'text': {
      const node = positioned('sl-shape', block.box, false);
      const layer = shapeLayer(block.style, block.box);
      if (layer) node.append(layer);
      if (block.paragraphs.length) {
        const text = el('div', 'sl-text');
        const [l, t, r, b] = block.frame.insets.map(px) as [number, number, number, number];
        text.style.padding = `${t}px ${r}px ${b}px ${l}px`;
        text.style.justifyContent = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[block.frame.anchor];
        if (!block.frame.wrap) text.style.whiteSpace = 'pre';
        for (const p of block.paragraphs) text.append(renderParagraph(p, true));
        node.append(text);
      }
      if (block.role === 'title') node.setAttribute('role', 'heading');
      return [node];
    }
    case 'image': {
      const node = positioned('sl-image', block.box);
      const url = block.part ? imageUrl(block.part) : '';
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = block.alt;
        if (block.alt) img.title = block.alt;
        const crop = block.crop ?? { l: 0, t: 0, r: 0, b: 0 };
        const w = 1 / Math.max(0.01, 1 - crop.l - crop.r);
        const h = 1 / Math.max(0.01, 1 - crop.t - crop.b);
        img.style.width = `${(w * 100).toFixed(3)}%`;
        img.style.height = `${(h * 100).toFixed(3)}%`;
        img.style.left = `${(-crop.l * w * 100).toFixed(3)}%`;
        img.style.top = `${(-crop.t * h * 100).toFixed(3)}%`;
        node.append(img);
        const line = color(block.style.line);
        if (line) node.style.outline = `${Math.max(1, px(block.style.lineWidth ?? 12700)).toFixed(2)}px solid ${line}`;
        if (ROUND_SHAPES.has(block.style.geometry ?? '')) node.style.borderRadius = '50%';
        else if (CLIP_PATHS[block.style.geometry ?? '']) node.style.clipPath = CLIP_PATHS[block.style.geometry ?? '']!;
        if (block.label) node.append(el('div', 'sl-label', block.label));
      } else {
        node.append(el('div', 'sl-missing', block.label ?? 'Image'));
      }
      return [node];
    }
    case 'table': {
      const node = positioned('sl-table', block.box, false);
      const table = el('table', '');
      if (block.colWidths.length) {
        const cols = el('colgroup', '');
        for (const w of block.colWidths) {
          const col = el('col', '');
          col.style.width = `${px(w)}px`;
          cols.append(col);
        }
        table.append(cols);
        table.style.width = `${px(block.colWidths.reduce((a, b) => a + b, 0))}px`;
      }
      const tbody = el('tbody', '');
      block.rows.forEach((row, i) => {
        const tr = el('tr', '');
        if (block.rowHeights[i]) tr.style.height = `${px(block.rowHeights[i]!)}px`;
        for (const cell of row) tr.append(tableCell(cell, true));
        tbody.append(tr);
      });
      table.append(tbody);
      node.append(table);
      return [node];
    }
    case 'chart': {
      const node = positioned('sl-chart', block.box, false);
      node.append(renderChart(block.chart));
      return [node];
    }
    case 'diagram': {
      if (block.shapes.length) return block.shapes.flatMap((shape) => placeBlock(shape, imageUrl));
      const node = positioned('sl-chart', block.box, false);
      node.append(renderDiagramList(block.items));
      return [node];
    }
    case 'line': {
      const node = positioned('sl-line', { ...block.box, flipH: false, flipV: false });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const w = Math.max(1, px(block.box.w));
      const h = Math.max(1, px(block.box.h));
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(block.box.flipH ? w : 0));
      line.setAttribute('y1', String(block.box.flipV ? h : 0));
      line.setAttribute('x2', String(block.box.flipH ? 0 : w));
      line.setAttribute('y2', String(block.box.flipV ? 0 : h));
      line.setAttribute('stroke', color(block.color) ?? '#000000');
      line.setAttribute('stroke-width', String(Math.max(1, px(block.width))));
      svg.append(line);
      node.append(svg);
      return [node];
    }
    case 'other': {
      const node = positioned('sl-other', block.box, false);
      node.append(el('div', 'sl-missing', block.label));
      return [node];
    }
  }
}

// ---- Text outline ------------------------------------------------------------------------

function renderOutline(slide: Slide, pres: Presentation, imageUrl: (part: string) => string): HTMLElement {
  const body = el('div', 'slide-body');
  for (const block of slide.blocks) {
    const node = outlineBlock(block, pres, imageUrl);
    if (node) body.append(node);
  }
  if (!body.children.length) body.append(el('div', 'slide-empty', 'This slide has no text or pictures.'));
  return body;
}

function outlineBlock(block: Block, pres: Presentation, imageUrl: (part: string) => string): HTMLElement | null {
  switch (block.kind) {
    case 'text': {
      if (!block.paragraphs.length) return null;
      const box = el('div', `slide-text ${block.role === 'title' ? 'slide-title' : block.role === 'subtitle' ? 'slide-subtitle' : ''}`.trim());
      if (block.role === 'title') box.setAttribute('role', 'heading');
      for (const p of collapseBlank(block.paragraphs)) box.append(renderParagraph(p, false));
      return box;
    }
    case 'image': {
      const figure = el('figure', 'slide-image');
      const url = block.part ? imageUrl(block.part) : '';
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = block.alt;
        if (block.alt) img.title = block.alt;
        img.style.width = `${Math.min(100, Math.max(3, (block.box.w / pres.width) * 100)).toFixed(1)}%`;
        figure.append(img);
      } else {
        figure.append(el('div', 'slide-missing', block.label ?? 'Image'));
      }
      if (url && block.label) figure.append(el('figcaption', '', block.label));
      return figure;
    }
    case 'table': {
      const wrap = el('div', 'slide-table-wrap');
      const table = el('table', 'slide-table');
      const tbody = el('tbody', '');
      for (const row of block.rows) {
        const tr = el('tr', '');
        for (const cell of row) tr.append(tableCell(cell, false));
        tbody.append(tr);
      }
      table.append(tbody);
      wrap.append(table);
      return wrap;
    }
    case 'chart':
      return renderChart(block.chart);
    case 'diagram':
      return renderDiagramList(block.items);
    case 'line':
      return null;
    case 'other':
      return el('div', 'slide-missing', block.label);
  }
}

/** Blank lines matter for layout, but in the outline one is enough. */
function collapseBlank(paragraphs: Paragraph[]): Paragraph[] {
  const blank = (p: Paragraph | undefined) => !!p && !p.runs.some((r) => r.math || r.text.trim());
  return paragraphs.filter((p, i) => !(blank(p) && blank(paragraphs[i - 1])));
}

// ---- Shared pieces -----------------------------------------------------------------------

/** A paragraph; `styled` applies the file's sizes, colors, fonts, and indents (slide mode). */
function renderParagraph(p: Paragraph, styled: boolean): HTMLElement {
  const line = el('div', styled ? 'sl-para' : 'slide-para');
  if (p.align) line.style.textAlign = p.align;
  const content = el('span', 'slide-runs');
  for (const run of p.runs) content.append(renderRun(run, styled));
  if (!p.runs.length) content.append(document.createElement('br'));

  if (styled) {
    line.style.fontSize = `${ptPx(p.size ?? 18).toFixed(2)}px`;
    if (p.lineSpacing) line.style.lineHeight = String(1.2 * p.lineSpacing);
    if (p.spaceBefore) line.style.marginTop = `${ptPx(p.spaceBefore).toFixed(2)}px`;
    const marL = px(p.marL ?? 0);
    const indent = px(p.indent ?? 0);
    if (marL) line.style.paddingLeft = `${marL}px`;
    if (indent) line.style.textIndent = `${indent}px`;
    if (p.bullet) {
      const bullet = el('span', 'sl-bullet', p.bullet);
      bullet.style.minWidth = indent < 0 ? `${-indent}px` : '0';
      const bulletColor = color(p.bulletColor);
      if (bulletColor) bullet.style.color = bulletColor;
      const firstSize = p.runs.find((r) => r.size)?.size;
      if (firstSize) bullet.style.fontSize = `${ptPx(firstSize).toFixed(2)}px`;
      line.append(bullet);
    }
  } else {
    if (p.level) line.style.marginLeft = `${p.level * 1.5}em`;
    if (p.bullet) {
      line.classList.add('has-bullet');
      line.append(el('span', 'bullet', p.bullet));
    }
  }
  line.append(content);
  return line;
}

function renderRun(run: TextRun, styled: boolean): Node {
  if (run.math) {
    const math = ommlToMathml(run.math);
    if (!styled) return math;
    const wrapper = el('span', 'sl-math');
    if (run.size) wrapper.style.fontSize = `${ptPx(run.size).toFixed(2)}px`;
    const mathColor = color(run.color);
    if (mathColor) wrapper.style.color = mathColor;
    wrapper.append(math);
    return wrapper;
  }
  if (run.text === '\n') return document.createElement('br');
  const node = run.href ? document.createElement('a') : document.createElement('span');
  node.textContent = run.text;
  if (run.href && node instanceof HTMLAnchorElement) {
    node.href = run.href;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
    node.title = run.href;
  }
  if (run.bold) node.style.fontWeight = '700';
  if (run.italic) node.style.fontStyle = 'italic';
  const lines = [run.underline && 'underline', run.strike && 'line-through'].filter(Boolean).join(' ');
  if (lines) node.style.textDecoration = lines;
  if (styled) {
    if (run.size) node.style.fontSize = `${ptPx(run.size).toFixed(2)}px`;
    const runColor = color(run.color);
    if (runColor) node.style.color = runColor;
    if (run.font) node.style.fontFamily = `"${run.font}", Calibri, Carlito, Arial, sans-serif`;
  }
  if (run.baseline) {
    const wrapper = document.createElement(run.baseline === 'super' ? 'sup' : 'sub');
    wrapper.append(node);
    return wrapper;
  }
  return node;
}

function tableCell(cell: TableCell, styled: boolean): HTMLElement {
  const td = el('td', '');
  if (cell.colSpan > 1) td.colSpan = cell.colSpan;
  if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
  const fill = color(cell.fill);
  if (styled && fill) td.style.backgroundColor = fill;
  for (const p of cell.paragraphs) td.append(renderParagraph(p, styled));
  return td;
}

function renderDiagramList(items: { text: string; level: number }[]): HTMLElement {
  const box = el('div', 'slide-diagram');
  box.append(el('div', 'slide-caption', 'SmartArt'));
  for (const item of items) {
    const line = el('div', 'slide-para has-bullet');
    line.style.marginLeft = `${item.level * 1.5}em`;
    line.append(el('span', 'bullet', '•'), el('span', '', item.text));
    box.append(line);
  }
  return box;
}

function renderChart(chart: ChartData | null): HTMLElement {
  const box = el('div', 'slide-chart');
  if (!chart) {
    box.append(el('div', 'slide-missing', 'Chart (this chart type isn’t shown; download the file to see it)'));
    return box;
  }
  box.append(el('div', 'slide-caption', `${chart.title ? `${chart.type}: ${chart.title}` : chart.type} (data)`));
  if (!chart.series.length) {
    box.append(el('div', 'slide-missing', 'The chart has no saved data.'));
    return box;
  }
  const wrap = el('div', 'slide-table-wrap');
  const table = el('table', 'slide-table chart-data');
  const head = el('tr', '');
  head.append(el('th', '', chart.categoryLabel), ...chart.series.map((s) => el('th', '', s.name)));
  const thead = el('thead', '');
  thead.append(head);
  const tbody = el('tbody', '');
  chart.categories.slice(0, MAX_CHART_ROWS).forEach((category, i) => {
    const tr = el('tr', '');
    tr.append(el('th', '', category), ...chart.series.map((s) => el('td', 'num', s.values[i] ?? '')));
    tbody.append(tr);
  });
  table.append(thead, tbody);
  wrap.append(table);
  box.append(wrap);
  if (chart.categories.length > MAX_CHART_ROWS) box.append(el('div', 'slide-missing', `Showing the first ${MAX_CHART_ROWS} of ${chart.categories.length} rows.`));
  return box;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
