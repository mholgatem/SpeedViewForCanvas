import { parseCsv } from '../render/csv';
import { highlight } from '../render/highlight';
import { renderMarkdown } from '../render/markdown';
import { parseNotebook } from '../render/notebook';
import { sanitizeHtml } from '../render/sanitize';

/** Text beyond this many characters is not rendered (the rest is still downloadable). */
export const MAX_RENDER_CHARS = 5_000_000;
const HEX_PREVIEW_BYTES = 64 * 1024;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A page-based view (PDF, Word) whose − / + buttons zoom instead of changing font size. */
export interface ZoomableView {
  setZoom(zoom: number): void;
  destroy(): void;
}

export function notice(container: HTMLElement, text: string): void {
  container.append(el('div', 'notice', text));
}

/** Highlighted, line-numbered code. Returns the language actually used and the line count. */
export function renderCode(
  container: HTMLElement,
  text: string,
  language: string,
  highlightEnabled: boolean,
): { language: string; lineCount: number } {
  let source = text;
  if (source.length > MAX_RENDER_CHARS) {
    notice(container, `Showing the first ${MAX_RENDER_CHARS.toLocaleString()} characters. Download to see the rest.`);
    source = source.slice(0, MAX_RENDER_CHARS);
  }
  const result = highlight(source, language, highlightEnabled);
  const code = el('div', `code hljs language-${result.language}`);
  // Lines come from highlight.js, which HTML-escapes all source text.
  code.innerHTML = result.lines
    .map((line, i) => `<div class="line"><span class="ln" data-n="${i + 1}"></span><span class="lc">${line || '\n'}</span></div>`)
    .join('');
  container.append(code);
  return { language: result.language, lineCount: result.lines.length };
}

export function renderMarkdownView(container: HTMLElement, text: string): void {
  const doc = el('article', 'markdown');
  doc.innerHTML = renderMarkdown(text);
  container.append(doc);
}

export function renderNotebookView(container: HTMLElement, text: string): void {
  const notebook = parseNotebook(text);
  const root = el('div', 'notebook');
  for (const cell of notebook.cells) {
    const cellEl = el('section', `cell cell-${cell.type}`);
    if (cell.type === 'markdown') {
      const md = el('div', 'markdown');
      md.innerHTML = renderMarkdown(cell.source);
      cellEl.append(md);
    } else {
      const prompt = cell.type === 'code' ? `In [${cell.executionCount ?? ' '}]:` : '';
      cellEl.append(el('div', 'prompt', prompt));
      const input = el('div', 'cell-input');
      renderCode(input, cell.source, cell.type === 'code' ? notebook.language : 'plaintext', true);
      cellEl.append(input);
    }
    for (const output of cell.outputs) {
      const out = el('div', 'cell-output');
      if (output.kind === 'text') {
        out.append(el('pre', `stream-${output.stream}`, output.text));
      } else if (output.kind === 'image') {
        const img = el('img');
        img.src = output.src;
        img.alt = 'Cell output';
        out.append(img);
      } else {
        const html = el('div', 'html-output');
        html.innerHTML = sanitizeHtml(output.html);
        out.append(html);
      }
      cellEl.append(out);
    }
    root.append(cellEl);
  }
  if (!notebook.cells.length) notice(root, 'This notebook has no cells.');
  container.append(root);
}

export function renderCsvView(container: HTMLElement, text: string, delimiter: string): void {
  const { rows, truncated } = parseCsv(text, delimiter);
  if (truncated) notice(container, `Showing the first ${rows.length} rows. Use "Source" to see everything.`);
  const table = el('table', 'csv');
  rows.forEach((row, i) => {
    const tr = el('tr');
    for (const cell of row) tr.append(el(i === 0 ? 'th' : 'td', undefined, cell));
    (i === 0 ? table.createTHead() : table.tBodies[0] ?? table.createTBody()).append(tr);
  });
  const wrap = el('div', 'table-wrap');
  wrap.append(table);
  container.append(wrap);
}

export interface ImageView {
  /** Turn the image to `degrees` clockwise (a multiple of 90). */
  setRotation(degrees: number): void;
}

/**
 * An image scaled to fit the width. Once its size is known, the frame takes the rotated
 * image's proportions and the image is turned inside it, so a sideways photo still fits.
 */
export function renderImage(container: HTMLElement, url: string, name: string, rotation = 0): ImageView {
  const img = el('img', 'image-view');
  img.alt = name;
  const frame = el('div', 'image-frame');
  frame.append(img);
  const wrap = el('div', 'image-wrap checkerboard');
  wrap.append(frame);
  container.append(wrap);

  const apply = () => {
    const quarter = rotation % 180 !== 0;
    const { naturalWidth: w, naturalHeight: h } = img;
    frame.style.setProperty('--rotation', `${rotation}deg`);
    frame.classList.toggle('quarter', quarter);
    // Some SVGs have no intrinsic size; those just turn in place.
    frame.classList.toggle('sized', w > 0 && h > 0);
    if (w > 0 && h > 0) {
      frame.style.width = `${quarter ? h : w}px`;
      frame.style.aspectRatio = quarter ? `${h} / ${w}` : `${w} / ${h}`;
    }
  };
  img.addEventListener('load', apply);
  img.src = url;
  apply();
  return {
    setRotation(degrees) {
      rotation = degrees;
      apply();
    },
  };
}

export function renderHex(container: HTMLElement, bytes: Uint8Array): void {
  const preview = bytes.subarray(0, HEX_PREVIEW_BYTES);
  const rows: string[] = [];
  for (let offset = 0; offset < preview.length; offset += 16) {
    const chunk = preview.subarray(offset, offset + 16);
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    rows.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (bytes.length > HEX_PREVIEW_BYTES) rows.push(`… ${bytes.length - HEX_PREVIEW_BYTES} more bytes`);
  container.append(el('pre', 'hex', rows.join('\n')));
}
