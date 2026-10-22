export type FileKind =
  | 'code'
  | 'markdown'
  | 'notebook'
  | 'csv'
  | 'image'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'vcd'
  | 'archive'
  | 'binary';

export type ArchiveFormat = 'zip' | 'tar' | 'tgz' | 'gz';

/** File extension -> highlight.js language. 'auto' means guess from content within a subset. */
export const EXTENSION_LANGUAGES: Record<string, string> = {
  py: 'python', pyw: 'python', pyi: 'python',
  v: 'verilog', vh: 'verilog', sv: 'verilog', svh: 'verilog', vg: 'verilog',
  vhd: 'vhdl', vhdl: 'vhdl',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', ino: 'arduino',
  cs: 'csharp', java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', groovy: 'groovy', gradle: 'gradle',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  go: 'go', rs: 'rust', swift: 'swift', m: 'matlab', r: 'r', jl: 'julia',
  rb: 'ruby', php: 'php', pl: 'perl', pm: 'perl', lua: 'lua', dart: 'dart',
  hs: 'haskell', ml: 'ocaml', mli: 'ocaml', fs: 'fsharp', ex: 'elixir', exs: 'elixir', erl: 'erlang',
  lisp: 'lisp', lsp: 'lisp', cl: 'lisp', el: 'lisp', scm: 'scheme', ss: 'scheme', rkt: 'scheme', clj: 'clojure',
  pro: 'prolog', f: 'fortran', f90: 'fortran', f95: 'fortran', for: 'fortran', pas: 'delphi',
  asm: 'auto-asm', s: 'auto-asm', mips: 'mipsasm', ll: 'llvm',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', bat: 'dos', cmd: 'dos',
  sql: 'sql', tcl: 'tcl', xdc: 'tcl', sdc: 'tcl', ucf: 'plaintext', awk: 'awk',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', xhtml: 'xml', css: 'css', scss: 'scss', less: 'less',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'properties',
  mk: 'makefile', cmake: 'cmake', dockerfile: 'dockerfile', tex: 'latex', bib: 'latex', sty: 'latex',
  diff: 'diff', patch: 'diff', glsl: 'glsl', vert: 'glsl', frag: 'glsl', proto: 'protobuf', graphql: 'graphql',
  md: 'markdown', markdown: 'markdown', ipynb: 'json', csv: 'plaintext', tsv: 'plaintext',
  gtkw: 'ini', vcd: 'plaintext',
  txt: 'plaintext', text: 'plaintext', log: 'plaintext', out: 'plaintext', rst: 'plaintext',
};

/** Files identified by their whole name rather than extension. */
const FILENAME_LANGUAGES: Record<string, string> = {
  makefile: 'makefile', gnumakefile: 'makefile', dockerfile: 'dockerfile', 'cmakelists.txt': 'cmake',
  '.gitignore': 'plaintext', '.bashrc': 'bash', '.zshrc': 'bash', 'readme': 'plaintext',
};

/** Language subsets tried by auto-detection. */
export const AUTO_SUBSETS: Record<string, string[]> = {
  'auto-asm': ['mipsasm', 'armasm', 'x86asm', 'avrasm'],
  auto: ['python', 'c', 'cpp', 'java', 'javascript', 'verilog', 'vhdl', 'bash', 'json', 'xml', 'sql', 'matlab', 'makefile'],
};

/** Word formats (Office Open XML); legacy binary .doc is not supported. */
const DOCX_EXTS = new Set(['docx', 'docm', 'dotx']);
/** Excel formats (Office Open XML); legacy .xls and binary .xlsb are not supported. */
const XLSX_EXTS = new Set(['xlsx', 'xlsm', 'xltx', 'xltm']);
/** PowerPoint formats (Office Open XML); legacy binary .ppt is not supported. */
const PPTX_EXTS = new Set(['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'avif']);
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
  webp: 'image/webp', ico: 'image/x-icon', avif: 'image/avif', svg: 'image/svg+xml',
};

export function baseName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

export function extensionOf(path: string): string {
  const name = baseName(path).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

export function archiveFormat(path: string): ArchiveFormat | null {
  const name = baseName(path).toLowerCase();
  if (name.endsWith('.zip')) return 'zip';
  if (name.endsWith('.tar')) return 'tar';
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'tgz';
  if (name.endsWith('.gz')) return 'gz';
  return null;
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

/** Sniff archive type from magic bytes (used for files whose name doesn't say). */
export function sniffArchive(bytes: Uint8Array): ArchiveFormat | null {
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return 'zip';
  if (startsWith(bytes, [0x1f, 0x8b])) return 'gz';
  if (bytes.length > 262 && String.fromCharCode(...bytes.subarray(257, 262)) === 'ustar') return 'tar';
  return null;
}

/** Kind of viewer to use, based on name alone (before bytes are available). */
export function kindFromName(path: string): FileKind | null {
  const ext = extensionOf(path);
  if (archiveFormat(path)) return 'archive';
  if (ext === 'ipynb') return 'notebook';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'pdf') return 'pdf';
  if (DOCX_EXTS.has(ext)) return 'docx';
  if (XLSX_EXTS.has(ext)) return 'xlsx';
  if (PPTX_EXTS.has(ext)) return 'pptx';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === 'vcd') return 'vcd';
  return null;
}

/** Final kind once bytes are known. `isText` comes from decodeText(). */
export function detectKind(path: string, bytes: Uint8Array, isText: boolean): FileKind {
  const byName = kindFromName(path);
  if (byName) return byName;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image';
  // Only sniff archives without an extension: .docx/.jar/.xlsx are zips too, but users
  // want those downloaded, not unpacked.
  if (!extensionOf(path) && sniffArchive(bytes)) return 'archive';
  return isText ? 'code' : 'binary';
}

/** highlight.js language for a text file; may be an AUTO_SUBSETS key. */
export function languageFor(path: string, overrides: Record<string, string> = {}): string {
  const name = baseName(path).toLowerCase();
  const ext = extensionOf(path);
  if (ext && overrides[ext]) return overrides[ext];
  if (FILENAME_LANGUAGES[name]) return FILENAME_LANGUAGES[name];
  if (ext && EXTENSION_LANGUAGES[ext]) return EXTENSION_LANGUAGES[ext];
  return 'auto';
}

export function imageMime(path: string): string {
  return IMAGE_MIME[extensionOf(path)] ?? 'application/octet-stream';
}
