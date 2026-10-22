export type NotebookOutput =
  | { kind: 'text'; text: string; stream: 'stdout' | 'stderr' | 'error' | 'result' }
  | { kind: 'image'; src: string }
  | { kind: 'html'; html: string };

export interface NotebookCell {
  type: 'code' | 'markdown' | 'raw';
  source: string;
  executionCount: number | null;
  outputs: NotebookOutput[];
}

export interface Notebook {
  language: string;
  cells: NotebookCell[];
}

type MultilineString = string | string[];

interface RawOutput {
  output_type?: string;
  name?: string;
  text?: MultilineString;
  data?: Record<string, MultilineString>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

interface RawCell {
  cell_type?: string;
  source?: MultilineString;
  execution_count?: number | null;
  outputs?: RawOutput[];
  attachments?: Record<string, Record<string, MultilineString>>;
}

interface RawNotebook {
  cells?: RawCell[];
  metadata?: { kernelspec?: { language?: string }; language_info?: { name?: string } };
}

const join = (value: MultilineString | undefined) => (Array.isArray(value) ? value.join('') : value ?? '');

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
export const stripAnsi = (text: string) => text.replace(ANSI_RE, '');

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif'];

function mimeOutput(data: Record<string, MultilineString>): NotebookOutput | null {
  for (const type of IMAGE_TYPES) {
    if (data[type]) return { kind: 'image', src: `data:${type};base64,${join(data[type]).replace(/\s/g, '')}` };
  }
  if (data['image/svg+xml']) {
    // Rendered via <img> so scripts inside the SVG never run.
    const svg = join(data['image/svg+xml']);
    return { kind: 'image', src: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}` };
  }
  if (data['text/html']) return { kind: 'html', html: join(data['text/html']) };
  if (data['text/plain']) return { kind: 'text', text: stripAnsi(join(data['text/plain'])), stream: 'result' };
  return null;
}

function parseOutput(raw: RawOutput): NotebookOutput | null {
  switch (raw.output_type) {
    case 'stream':
      return { kind: 'text', text: stripAnsi(join(raw.text)), stream: raw.name === 'stderr' ? 'stderr' : 'stdout' };
    case 'error': {
      const trace = raw.traceback?.length ? raw.traceback.join('\n') : `${raw.ename}: ${raw.evalue}`;
      return { kind: 'text', text: stripAnsi(trace), stream: 'error' };
    }
    case 'execute_result':
    case 'display_data':
      return raw.data ? mimeOutput(raw.data) : null;
    default:
      return null;
  }
}

/** Replace `attachment:name.png` references in a markdown cell with inline data URLs. */
function inlineAttachments(source: string, attachments: RawCell['attachments']): string {
  if (!attachments) return source;
  return source.replace(/attachment:([^\s)"']+)/g, (match, name: string) => {
    const bundle = attachments[name];
    const type = bundle && Object.keys(bundle).find((t) => t.startsWith('image/'));
    return type ? `data:${type};base64,${join(bundle[type]).replace(/\s/g, '')}` : match;
  });
}

export function parseNotebook(text: string): Notebook {
  const raw = JSON.parse(text) as RawNotebook;
  if (!Array.isArray(raw.cells)) throw new Error('Unsupported notebook format (expected nbformat 4)');
  const language = raw.metadata?.kernelspec?.language ?? raw.metadata?.language_info?.name ?? 'python';
  const cells = raw.cells.map((cell): NotebookCell => {
    const type = cell.cell_type === 'markdown' || cell.cell_type === 'raw' ? cell.cell_type : 'code';
    let source = join(cell.source);
    if (type === 'markdown') source = inlineAttachments(source, cell.attachments);
    return {
      type,
      source,
      executionCount: cell.execution_count ?? null,
      outputs: (cell.outputs ?? []).map(parseOutput).filter((o): o is NotebookOutput => o !== null),
    };
  });
  return { language: language.toLowerCase(), cells };
}
