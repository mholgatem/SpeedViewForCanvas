import { extractArchive } from '@/src/archive';
import type { Attempt } from '@/src/canvas/api';
import { unwrap, wrap, type ToContent, type ToViewer } from '@/src/messaging';
import { detectKind, extensionOf, imageMime, languageFor, sniffArchive, type FileKind } from '@/src/render/detect';
import { languageNames } from '@/src/render/highlight';
import { decodeText, type DecodedText } from '@/src/render/text';
import { originMatchesDomain } from '@/src/settings/domains';
import type { Settings } from '@/src/settings/schema';
import { loadSettings, onSettingsChanged, saveSettings } from '@/src/settings/storage';
import { attachmentNodes, entriesToNodes, findNode, firstFile, formatSize, type FileNode } from '@/src/viewer/tree';
import {
  notice,
  renderCode,
  renderCsvView,
  renderHex,
  renderImage,
  renderMarkdownView,
  renderNotebookView,
  type ZoomableView,
} from '@/src/viewer/views';
import { renderDocxView } from '@/src/viewer/docx';
import { renderPdfView } from '@/src/viewer/pdf';
import { renderSheetView } from '@/src/viewer/sheet';
import { renderSlidesView } from '@/src/viewer/slides';
import { parseGtkw, type GtkwLayout } from '@/src/render/gtkw';
import { formatTime, parseVcd, timescaleLabel, type Vcd } from '@/src/render/vcd';
import {
  deleteAssignmentLayout,
  getAssignmentLayouts,
  MAX_LAYOUT_BYTES,
  saveAssignmentLayout,
  type AssignmentLabels,
  type SavedLayout,
} from '@/src/settings/savedLayouts';
import { coverage, makeResolver } from '@/src/render/waveLayout';
import { renderWaveView, type LayoutChoice } from '@/src/viewer/waves';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  attempt: $<HTMLSelectElement>('attempt'),
  status: $('status'),
  tree: $('tree'),
  toolbar: $('toolbar'),
  path: $('file-path'),
  info: $('file-info'),
  language: $<HTMLSelectElement>('language'),
  mode: $<HTMLButtonElement>('mode'),
  wrap: $<HTMLButtonElement>('wrap'),
  rotate: $<HTMLButtonElement>('rotate'),
  copy: $<HTMLButtonElement>('copy'),
  smaller: $<HTMLButtonElement>('font-down'),
  larger: $<HTMLButtonElement>('font-up'),
  view: $('view'),
};

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

/** Kinds where − / + zoom instead of changing the font size. */
const PAGED: ReadonlySet<string> = new Set(['pdf', 'docx', 'xlsx', 'pptx']);

/** Kinds that have both a rendered view and a source view. */
const RENDERABLE: ReadonlySet<string> = new Set(['markdown', 'notebook', 'csv', 'svg', 'vcd']);

let settings: Settings;
let generation = -1;
let attempts: Attempt[] = [];
let roots: FileNode[] = [];
let selected: FileNode | null = null;
let mode: 'rendered' | 'source' = 'rendered';
let languageOverride: string | null = null;
let currentText: DecodedText | null = null;
let blobUrls: string[] = [];
let zoomView: ZoomableView | null = null;
/** The open image or PDF, when it can be rotated. */
let rotatable: { rotate(): void } | null = null;
/** Clockwise turns the grader gave each file (per PDF page), kept while on this student. */
const rotations = new Map<string, number[]>();
let zoom = 1;
/** Bumped whenever the view is cleared, so slow async renders know they're stale. */
let viewToken = 0;
const confirmedLarge = new Set<string>();
/** Identifies the assignment, for the grader's saved waveform layout. */
let assignment = '';
/** Course and assignment names, stored with saved layouts for the settings page. */
let assignmentLabels: AssignmentLabels = { course: null, assignment: null };
/** Which kind of waveform layout the grader last picked, reused for the next VCD. */
let layoutPreference: 'mine' | 'student' | 'all' | null = null;

// ---- Messaging with the content script ----------------------------------------------

let nextRequestId = 1;
const pending = new Map<number, { resolve(bytes: Uint8Array): void; reject(err: Error): void }>();

function postToPage(message: ToContent) {
  // The parent's origin is checked on every incoming message; '*' is safe here because
  // outgoing messages only carry requests, never file contents.
  window.parent.postMessage(wrap(message), '*');
}

function requestFile(url: string): Promise<Uint8Array> {
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    postToPage({ type: 'fetch', requestId, generation, url });
  });
}

function cancelPending() {
  for (const { reject } of pending.values()) reject(new Error('cancelled'));
  pending.clear();
}

function handleMessage(event: MessageEvent) {
  if (event.source !== window.parent) return;
  if (!settings.domains.some((domain) => originMatchesDomain(event.origin, domain))) return;
  const message = unwrap<ToViewer>(event.data);
  if (!message) return;

  switch (message.type) {
    case 'submission':
      if (message.generation < generation) return;
      if (message.generation !== generation || message.status === 'loading') resetSubmission(message.generation);
      if (message.status === 'ready') {
        assignment = message.assignmentKey;
        assignmentLabels = message.labels;
        showAttempts(message.attempts);
      }
      else if (message.status === 'error') setStatus(`Couldn't load the submission: ${message.message}`);
      else if (message.status === 'loading') setStatus('Loading submission…');
      else setStatus('Select a student to see their files.');
      break;
    case 'file':
      pending.get(message.requestId)?.resolve(new Uint8Array(message.bytes));
      pending.delete(message.requestId);
      break;
    case 'file-error':
      pending.get(message.requestId)?.reject(new Error(message.message));
      pending.delete(message.requestId);
      break;
  }
}

// ---- Submission and tree -------------------------------------------------------------

function resetSubmission(gen: number) {
  generation = gen;
  cancelPending();
  attempts = [];
  roots = [];
  selected = null;
  confirmedLarge.clear();
  rotations.clear();
  ui.attempt.hidden = true;
  renderTree();
  clearView();
}

function setStatus(text: string) {
  ui.status.textContent = text;
}

function showAttempts(list: Attempt[]) {
  attempts = list;
  if (!attempts.length) {
    setStatus('');
    clearView();
    notice(ui.view, 'This submission has no attached files.');
    return;
  }
  ui.attempt.replaceChildren(
    ...attempts.map((a, i) => {
      const date = a.submittedAt ? new Date(a.submittedAt).toLocaleString() : 'unknown date';
      return new Option(`Attempt ${a.attempt} · ${date}`, String(i));
    }),
  );
  ui.attempt.hidden = attempts.length < 2;
  selectAttempt(0);
}

function selectAttempt(index: number) {
  const attempt = attempts[index];
  if (!attempt) return;
  roots = attachmentNodes(attempt.attachments);
  selected = null;
  const count = attempt.attachments.length;
  setStatus(attempts.length < 2 ? `${count} file${count === 1 ? '' : 's'}` : '');
  renderTree();
  clearView();
  if (roots.length === 1) void activate(roots[0]!);
  else notice(ui.view, 'Choose a file on the left.');
}

function renderTree() {
  const build = (nodes: FileNode[], level: number): HTMLUListElement => {
    const ul = document.createElement('ul');
    for (const node of nodes) {
      const li = document.createElement('li');
      const row = document.createElement('button');
      row.className = 'node' + (node === selected ? ' selected' : '');
      row.dataset.id = node.id;
      row.style.paddingLeft = `${8 + level * 14}px`;
      const expandable = node.type === 'dir' || node.archive;
      const icon = expandable ? (node.expanded ? '▾' : '▸') : '';
      row.title = node.path;
      row.innerHTML = '<span class="twisty"></span><span class="name"></span><span class="size"></span>';
      row.children[0]!.textContent = icon;
      row.children[1]!.textContent = node.name + (node.type === 'dir' ? '/' : '');
      row.children[2]!.textContent = node.type === 'file' ? formatSize(node.size) : '';
      li.append(row);
      if (expandable && node.expanded && node.children.length) li.append(build(node.children, level + 1));
      ul.append(li);
    }
    return ul;
  };
  ui.tree.replaceChildren(build(roots, 0));
}

async function getBytes(node: FileNode): Promise<Uint8Array | null> {
  if (node.data) return node.data;
  if (!node.remoteUrl) throw new Error('File data is unavailable');
  const limit = settings.confirmSizeMB * 1024 * 1024;
  if (node.size > limit && !confirmedLarge.has(node.id)) {
    clearView();
    notice(ui.view, `${node.name} is ${formatSize(node.size)}. Loading it may take a while.`);
    const button = document.createElement('button');
    button.textContent = 'Load anyway';
    button.className = 'primary';
    button.addEventListener('click', () => {
      confirmedLarge.add(node.id);
      void activate(node);
    });
    ui.view.append(button);
    return null;
  }
  showLoading(`Opening ${node.name}…`);
  node.data = await requestFile(node.remoteUrl);
  return node.data;
}

/** Click on a tree row: toggle folders, unpack archives, open files. */
async function activate(node: FileNode) {
  if (node.type === 'dir') {
    node.expanded = !node.expanded;
    renderTree();
    return;
  }
  if (node.archive && node.extracted) {
    node.expanded = !node.expanded;
    renderTree();
    return;
  }

  selected = node;
  languageOverride = null;
  mode = 'rendered';
  zoom = 1;
  renderTree();
  try {
    const bytes = await getBytes(node);
    if (!bytes || selected !== node) return;
    // Archives without a telling name (no extension) are caught by renderSelected's sniffing.
    if (node.archive) openArchive(node, bytes);
    else renderSelected();
  } catch (err) {
    if ((err as Error).message === 'cancelled' || selected !== node) return;
    clearView();
    notice(ui.view, `Couldn't open ${node.name}: ${(err as Error).message}`);
  }
}

function openArchive(node: FileNode, bytes: Uint8Array) {
  const format = node.archive ?? sniffArchive(bytes);
  clearView();
  if (!format) return renderSelected();
  if (node.depth >= settings.archiveMaxDepth) {
    notice(ui.view, `Not unpacking ${node.name}: archives nested deeper than ${settings.archiveMaxDepth} levels are skipped (see settings).`);
    return;
  }
  const entries = extractArchive(format, bytes, node.name, {
    maxEntries: settings.archiveMaxEntries,
    maxTotalBytes: settings.archiveMaxTotalMB * 1024 * 1024,
  });
  node.archive = format;
  node.children = entriesToNodes(entries, node.path, node.depth + 1);
  node.extracted = true;
  node.expanded = true;
  renderTree();
  const first = entries.length === 1 ? firstFile(node.children) : null;
  if (first) void activate(first);
  else notice(ui.view, `${node.name}: ${entries.length} file${entries.length === 1 ? '' : 's'}. Choose one on the left.`);
}

// ---- File view -----------------------------------------------------------------------

function clearView() {
  viewToken++;
  for (const url of blobUrls) URL.revokeObjectURL(url);
  blobUrls = [];
  zoomView?.destroy();
  zoomView = null;
  rotatable = null;
  currentText = null;
  ui.view.replaceChildren();
  ui.toolbar.hidden = true;
}

function showLoading(text: string) {
  clearView();
  ui.view.append(Object.assign(document.createElement('div'), { className: 'loading', textContent: text }));
}

function blobUrl(bytes: Uint8Array, type: string): string {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  blobUrls.push(url);
  return url;
}

function rotationsFor(node: FileNode): number[] {
  let turns = rotations.get(node.id);
  if (!turns) rotations.set(node.id, (turns = []));
  return turns;
}

function showImage(node: FileNode, url: string) {
  const turns = rotationsFor(node);
  const image = renderImage(ui.view, url, node.name, turns[0] ?? 0);
  rotatable = { rotate: () => image.setRotation((turns[0] = ((turns[0] ?? 0) + 90) % 360)) };
}

function viewKind(node: FileNode, bytes: Uint8Array, text: DecodedText | null): FileKind | 'svg' {
  if (extensionOf(node.name) === 'svg' && text) return 'svg';
  return detectKind(node.name, bytes, text !== null);
}

function renderSelected() {
  const node = selected;
  if (!node?.data) return;
  const bytes = node.data;
  clearView();
  currentText = decodeText(bytes);
  const kind = viewKind(node, bytes, currentText);
  const showSource = RENDERABLE.has(kind) && mode === 'source';
  const info: string[] = [formatSize(bytes.length)];

  ui.toolbar.hidden = false;
  ui.path.textContent = node.path;
  ui.mode.hidden = !RENDERABLE.has(kind);
  ui.mode.textContent = mode === 'rendered' ? 'Source' : 'Rendered';
  ui.language.hidden = true;
  const isTextView = kind === 'code' || showSource;
  ui.wrap.hidden = !isTextView;
  ui.rotate.hidden = showSource || !(kind === 'image' || kind === 'svg' || kind === 'pdf');
  const waves = kind === 'vcd' && !showSource;
  ui.copy.hidden = !currentText || PAGED.has(kind) || waves;
  ui.smaller.hidden = ui.larger.hidden = kind === 'image' || kind === 'svg' || kind === 'binary' || waves;
  ui.smaller.title = PAGED.has(kind) ? 'Zoom out' : 'Smaller text';
  ui.larger.title = PAGED.has(kind) ? 'Zoom in' : 'Larger text';

  try {
    if (isTextView) {
      const text = currentText?.text ?? '';
      const language = languageOverride ?? languageFor(node.name, settings.languageOverrides);
      const highlightOn = bytes.length <= settings.highlightMaxKB * 1024;
      const result = renderCode(ui.view, text, language, highlightOn);
      if (!highlightOn) notice(ui.view, 'Large file: syntax highlighting is off (adjustable in settings).');
      ui.language.hidden = false;
      ui.language.value = languageOverride ?? (language.startsWith('auto') ? '' : result.language);
      info.unshift(result.language === 'plaintext' ? 'Plain text' : result.language);
      info.push(`${result.lineCount.toLocaleString()} lines`);
      if (currentText) info.push(currentText.encoding);
    } else if (kind === 'markdown') {
      renderMarkdownView(ui.view, currentText?.text ?? '');
    } else if (kind === 'notebook') {
      renderNotebookView(ui.view, currentText?.text ?? '');
    } else if (kind === 'csv') {
      renderCsvView(ui.view, currentText?.text ?? '', extensionOf(node.name) === 'tsv' ? '\t' : ',');
    } else if (kind === 'svg') {
      showImage(node, blobUrl(bytes, 'image/svg+xml'));
    } else if (kind === 'image') {
      showImage(node, blobUrl(bytes, imageMime(node.name)));
    } else if (kind === 'pdf') {
      void showPdf(node, bytes, info);
    } else if (kind === 'docx') {
      void showDocx(node, bytes);
    } else if (kind === 'xlsx') {
      showSheet(bytes, info);
    } else if (kind === 'pptx') {
      showSlides(bytes, info);
    } else if (kind === 'vcd') {
      void showWaves(node, bytes, info);
    } else if (kind === 'archive') {
      openArchive(node, bytes);
      return;
    } else {
      notice(ui.view, 'This looks like a binary file. Showing a hex preview; use Download to open it in another program.');
      renderHex(ui.view, bytes);
    }
  } catch (err) {
    clearView();
    ui.toolbar.hidden = false;
    notice(ui.view, `Couldn't render this file (${(err as Error).message}). Showing the source instead.`);
    renderCode(ui.view, currentText?.text ?? '', 'plaintext', false);
  }
  ui.info.textContent = info.join(' · ');
}

async function showPdf(node: FileNode, bytes: Uint8Array, info: string[]) {
  const holder = document.createElement('div');
  holder.className = 'loading';
  holder.textContent = `Opening ${node.name}…`;
  ui.view.append(holder);
  const token = viewToken;
  try {
    const view = await renderPdfView(ui.view, ui.view, bytes, zoom, rotationsFor(node));
    if (token !== viewToken) return view.destroy();
    holder.remove();
    zoomView = view;
    rotatable = view;
    ui.info.textContent = [...info, `${view.pageCount} page${view.pageCount === 1 ? '' : 's'}`].join(' · ');
  } catch (err) {
    if (token !== viewToken) return;
    const reason = (err as Error).name === 'PasswordException' ? 'it is password-protected' : (err as Error).message;
    holder.className = 'notice';
    holder.textContent = `Couldn't display this PDF (${reason}). Use Download to open it in another program.`;
  }
}

function showSheet(bytes: Uint8Array, info: string[]) {
  try {
    const view = renderSheetView(ui.view, bytes, zoom, settings.archiveMaxTotalMB * 1024 * 1024);
    zoomView = view;
    info.push(`${view.sheetCount} sheet${view.sheetCount === 1 ? '' : 's'}`);
  } catch (err) {
    ui.view.replaceChildren();
    notice(ui.view, `Couldn't display this workbook (${(err as Error).message}). Use Download to open it in Excel.`);
  }
}

function showSlides(bytes: Uint8Array, info: string[]) {
  try {
    const view = renderSlidesView(ui.view, bytes, zoom, settings.archiveMaxTotalMB * 1024 * 1024);
    zoomView = view;
    info.push(`${view.slideCount} slide${view.slideCount === 1 ? '' : 's'}`);
    if (view.hiddenCount) info.push(`${view.hiddenCount} hidden`);
  } catch (err) {
    ui.view.replaceChildren();
    notice(ui.view, `Couldn't display this presentation (${(err as Error).message}). Use Download to open it in PowerPoint.`);
  }
}

// ---- Waveforms ----------------------------------------------------------------------

interface StudentLayout {
  node: FileNode;
  layout: GtkwLayout;
  score: number;
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
const stemOf = (name: string) => name.replace(/\.[^.]*$/, '').toLowerCase();

function* allNodes(nodes: FileNode[]): Generator<FileNode> {
  for (const node of nodes) {
    yield node;
    yield* allNodes(node.children);
  }
}

/** .gtkw files in the submission (attachments and unpacked archives), best match first. */
async function studentLayouts(vcdNode: FileNode): Promise<StudentLayout[]> {
  const found: StudentLayout[] = [];
  for (const node of allNodes(roots)) {
    if (node.type !== 'file' || extensionOf(node.name) !== 'gtkw' || node.size > MAX_LAYOUT_BYTES) continue;
    try {
      if (!node.data && node.remoteUrl) node.data = await requestFile(node.remoteUrl);
      if (!node.data) continue;
      const layout = parseGtkw(decodeText(node.data)?.text ?? '');
      const dumpfile = layout.dumpfile?.split(/[\\/]/).pop()?.toLowerCase();
      const score =
        (dumpfile === vcdNode.name.toLowerCase() ? 4 : 0) +
        (stemOf(node.name) === stemOf(vcdNode.name) ? 2 : 0) +
        (dirOf(node.path) === dirOf(vcdNode.path) ? 1 : 0);
      found.push({ node, layout, score });
    } catch (err) {
      if ((err as Error).message === 'cancelled') throw err;
    }
  }
  return found.sort((a, b) => b.score - a.score || a.node.path.localeCompare(b.node.path));
}

interface MyLayout {
  saved: SavedLayout;
  layout: GtkwLayout;
  /** Share of its signals found in this VCD. */
  coverage: number;
}

const mineId = (saved: SavedLayout) => `mine:${saved.id}`;

function layoutChoices(mine: MyLayout[], students: StudentLayout[]): LayoutChoice[] {
  const choices: LayoutChoice[] = mine.map((m) => ({ id: mineId(m.saved), label: `Mine: ${m.saved.name}`, layout: m.layout, savedId: m.saved.id }));
  students.forEach((s, i) => choices.push({ id: `student:${i}`, label: `Student: ${s.node.name}`, layout: s.layout }));
  choices.push({ id: 'all', label: 'All signals', layout: null });
  return choices;
}

/**
 * The grader's layout that best fits this VCD, then the student's best-matching save file,
 * then the grader's partial fits, then every signal.
 */
function defaultChoice(mine: MyLayout[], students: StudentLayout[]): string {
  if (layoutPreference === 'all') return 'all';
  if (layoutPreference === 'student' && students.length) return 'student:0';
  const best = [...mine].sort((a, b) => b.coverage - a.coverage || b.saved.savedAt - a.saved.savedAt)[0];
  if (best && best.coverage >= 0.5) return mineId(best.saved);
  if (students[0] && (students[0].score > 0 || students.length === 1)) return 'student:0';
  return best && best.coverage > 0 ? mineId(best.saved) : 'all';
}

async function showWaves(node: FileNode, bytes: Uint8Array, info: string[]) {
  const holder = document.createElement('div');
  holder.className = 'loading';
  holder.textContent = `Reading ${node.name}…`;
  ui.view.append(holder);
  const token = viewToken;
  try {
    // Let the message paint before a long parse.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (token !== viewToken) return;
    const vcd: Vcd = parseVcd(bytes);
    const resolver = makeResolver(vcd);
    const loadMine = async (): Promise<MyLayout[]> =>
      (await getAssignmentLayouts(assignment).catch(() => [])).map((saved) => {
        const layout = parseGtkw(saved.text);
        return { saved, layout, coverage: coverage(resolver, layout.entries) };
      });
    let mine = await loadMine();
    const students = await studentLayouts(node);
    if (token !== viewToken) return;
    holder.remove();

    const store = async (target: { id?: string; name: string }, text: string) => {
      const stored = await saveAssignmentLayout(assignment, assignmentLabels, { ...target, text });
      mine = await loadMine();
      layoutPreference = 'mine';
      return mineId(stored);
    };
    const view = renderWaveView(ui.view, vcd, {
      vcdName: node.name,
      choices: layoutChoices(mine, students),
      selected: defaultChoice(mine, students),
      onChoose: (id) => (layoutPreference = id.startsWith('mine:') ? 'mine' : id === 'all' ? 'all' : 'student'),
      onLoadFile: (file) => {
        void (async () => {
          try {
            if (file.size > MAX_LAYOUT_BYTES) throw new Error('it is larger than 512 KB');
            const text = await file.text();
            if (!parseGtkw(text).entries.length) throw new Error('it lists no signals');
            const id = await store({ name: file.name }, text);
            view.setChoices(layoutChoices(mine, students), id, true);
            setStatus(`Added ${file.name} to your layouts for this assignment.`);
          } catch (err) {
            setStatus(`Couldn't load ${file.name}: ${(err as Error).message}`);
          }
        })();
      },
      onSave: async (text, target) => {
        try {
          const id = await store(target, text);
          view.setChoices(layoutChoices(mine, students), id, false);
          setStatus(`Saved “${target.name}” for this assignment.`);
        } catch (err) {
          setStatus(`Couldn't save the layout: ${(err as Error).message}`);
          throw err;
        }
      },
      onDelete: (savedId) => {
        void (async () => {
          const wasCurrent = view.choiceId === `mine:${savedId}`;
          await deleteAssignmentLayout(assignment, savedId);
          mine = await loadMine();
          if (wasCurrent && layoutPreference === 'mine') layoutPreference = null;
          const choices = layoutChoices(mine, students);
          view.setChoices(choices, wasCurrent ? defaultChoice(mine, students) : view.choiceId, wasCurrent);
          setStatus('Layout deleted.');
        })();
      },
      onExport: (text, fileName) => {
        const a = document.createElement('a');
        a.href = blobUrl(new TextEncoder().encode(text), 'application/octet-stream');
        a.download = fileName;
        a.click();
      },
    });
    zoomView = { setZoom: () => {}, destroy: () => view.destroy() };
    const count = vcd.signals.length;
    info.push(`${count.toLocaleString()} signal${count === 1 ? '' : 's'}`, `ends at ${formatTime(vcd.endTime, vcd.timescale)}`, `timescale ${timescaleLabel(vcd.timescale)}`);
    if (vcd.truncatedAt !== null) info.push(`only the first ${formatTime(vcd.truncatedAt, vcd.timescale)} shown (too many changes)`);
    ui.info.textContent = info.join(' · ');
  } catch (err) {
    if (token !== viewToken || (err as Error).message === 'cancelled') return;
    holder.className = 'notice';
    holder.textContent = `Couldn't display this waveform (${(err as Error).message}). Use Source to see the file.`;
  }
}

async function showDocx(node: FileNode, bytes: Uint8Array) {
  const holder = document.createElement('div');
  holder.className = 'loading';
  holder.textContent = `Opening ${node.name}…`;
  ui.view.append(holder);
  const token = viewToken;
  try {
    const view = await renderDocxView(ui.view, ui.view, bytes, zoom);
    if (token !== viewToken) return view.destroy();
    holder.remove();
    zoomView = view;
  } catch (err) {
    if (token !== viewToken) return;
    holder.className = 'notice';
    holder.textContent = `Couldn't display this document (${(err as Error).message}). Use Download to open it in Word.`;
  }
}

function changeSize(direction: 1 | -1) {
  if (zoomView) {
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + direction * ZOOM_STEP));
    zoomView.setZoom(zoom);
    return;
  }
  updateSetting({ fontSize: Math.min(32, Math.max(8, settings.fontSize + direction)) });
}

// ---- Toolbar & settings --------------------------------------------------------------

function applySettings() {
  const root = document.documentElement;
  const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--code-font-size', `${settings.fontSize}px`);
  root.style.setProperty('--tab-size', String(settings.tabWidth));
  root.classList.toggle('wrap', settings.wrap);
  root.classList.toggle('no-line-numbers', !settings.lineNumbers);
  ui.wrap.setAttribute('aria-pressed', String(settings.wrap));
}

function updateSetting(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  applySettings();
  void saveSettings(patch);
}

function download() {
  const node = selected;
  if (!node?.data) return;
  const a = document.createElement('a');
  a.href = blobUrl(node.data, 'application/octet-stream');
  a.download = node.name;
  a.click();
}

async function copy() {
  const text = currentText?.text;
  if (text === undefined) return;
  const button = $('copy');
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => (button.textContent = 'Copy'), 1500);
}

function setupToolbar() {
  ui.language.replaceChildren(new Option('Auto-detect', ''), ...languageNames().map((name) => new Option(name, name)));
  ui.language.addEventListener('change', () => {
    languageOverride = ui.language.value || null;
    renderSelected();
  });
  ui.mode.addEventListener('click', () => {
    mode = mode === 'rendered' ? 'source' : 'rendered';
    languageOverride = null;
    renderSelected();
  });
  ui.wrap.addEventListener('click', () => updateSetting({ wrap: !settings.wrap }));
  ui.rotate.addEventListener('click', () => rotatable?.rotate());
  ui.smaller.addEventListener('click', () => changeSize(-1));
  ui.larger.addEventListener('click', () => changeSize(1));
  $('copy').addEventListener('click', () => void copy());
  $('download').addEventListener('click', download);
  $('close').addEventListener('click', () => postToPage({ type: 'close' }));
  $('open-settings').addEventListener('click', () => void browser.runtime.openOptionsPage());
  $('toggle-tree').addEventListener('click', (e) => {
    const hidden = ui.tree.classList.toggle('collapsed');
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(!hidden));
  });
  ui.attempt.addEventListener('change', () => selectAttempt(Number(ui.attempt.value)));
  ui.tree.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('.node')?.dataset.id;
    const node = id ? findNode(roots, id) : null;
    if (node) void activate(node);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') postToPage({ type: 'close' });
    const typing = (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]');
    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing && rotatable) {
      e.preventDefault();
      rotatable.rotate();
    }
  });
}

async function init() {
  settings = await loadSettings();
  applySettings();
  setupToolbar();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);
  onSettingsChanged((next) => {
    settings = next;
    applySettings();
  });
  window.addEventListener('message', handleMessage);
  postToPage({ type: 'ready' });
}

void init();
