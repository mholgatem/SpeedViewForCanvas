/**
 * GTKWave save files (.gtkw): the list of traces with their display flags, comments,
 * blank rows and groups, plus the initial view. Flag bits follow GTKWave's
 * TraceEntFlagBits (analyzer.h); unknown bits are kept so a saved file round-trips.
 */

export const FLAG = {
  highlight: 0,
  hex: 1,
  dec: 2,
  bin: 3,
  oct: 4,
  rjustify: 5,
  invert: 6,
  reverse: 7,
  blank: 9,
  signed: 10,
  ascii: 11,
  collapsed: 12,
  real: 18,
  closed: 22,
  groupBegin: 23,
  groupEnd: 24,
} as const;

export type Radix = 'hex' | 'dec' | 'signed' | 'bin' | 'oct' | 'ascii';
export const RADIXES: Radix[] = ['hex', 'dec', 'signed', 'bin', 'oct', 'ascii'];
const RADIX_BITS = [FLAG.hex, FLAG.dec, FLAG.bin, FLAG.oct, FLAG.signed, FLAG.ascii, FLAG.real];

export interface SignalEntry {
  kind: 'signal';
  /** Hierarchical name as GTKWave writes it, e.g. "tb.dut.count[3:0]". */
  name: string;
  alias?: string;
  flags: number;
  color?: number;
}

export interface ConcatEntry {
  kind: 'concat';
  name: string;
  parts: string[];
  alias?: string;
  flags: number;
  color?: number;
}

export interface CommentEntry {
  kind: 'comment';
  text: string;
}

export interface BlankEntry {
  kind: 'blank';
}

export interface GroupEntry {
  kind: 'group';
  name: string;
  collapsed: boolean;
  children: LayoutEntry[];
}

export type LayoutEntry = SignalEntry | ConcatEntry | CommentEntry | BlankEntry | GroupEntry;
export type TraceEntry = SignalEntry | ConcatEntry;

export interface GtkwLayout {
  /** Path from [dumpfile], as written (only its basename is meaningful elsewhere). */
  dumpfile: string | null;
  /** View start, in GTKWave time units (timescale unit × magnitude ticks). */
  timestart: number | null;
  /** GTKWave zoom: 2^zoom pixels per time unit. */
  zoom: number | null;
  /** Primary marker in time units, or null. */
  marker: number | null;
  entries: LayoutEntry[];
}

// Flags can use bits above 31, so bit tests use arithmetic rather than JS bitwise operators.
export function hasFlag(flags: number, bit: number): boolean {
  return Math.floor(flags / 2 ** bit) % 2 === 1;
}

export function setFlag(flags: number, bit: number, on: boolean): number {
  if (hasFlag(flags, bit) === on) return flags;
  return on ? flags + 2 ** bit : flags - 2 ** bit;
}

/** The radix a trace's flags ask for, or null for GTKWave's default (hex). */
export function radixOf(flags: number): Radix | null {
  if (hasFlag(flags, FLAG.ascii)) return 'ascii';
  if (hasFlag(flags, FLAG.signed)) return 'signed';
  if (hasFlag(flags, FLAG.dec)) return 'dec';
  if (hasFlag(flags, FLAG.bin)) return 'bin';
  if (hasFlag(flags, FLAG.oct)) return 'oct';
  if (hasFlag(flags, FLAG.hex)) return 'hex';
  return null;
}

export function withRadix(flags: number, radix: Radix): number {
  let next = flags;
  for (const bit of RADIX_BITS) next = setFlag(next, bit, false);
  const bit = { hex: FLAG.hex, dec: FLAG.dec, signed: FLAG.signed, bin: FLAG.bin, oct: FLAG.oct, ascii: FLAG.ascii }[radix];
  return setFlag(next, bit, true);
}

/** GTKWave's flags for a newly added trace: binary for 1-bit, hex for vectors. */
export function defaultFlags(width: number, real: boolean): number {
  const base = 2 ** FLAG.rjustify;
  if (real) return base + 2 ** FLAG.real;
  return base + 2 ** (width === 1 ? FLAG.bin : FLAG.hex);
}

const COMMENT_FLAGS = 2 ** FLAG.blank;

export function parseGtkw(text: string): GtkwLayout {
  const layout: GtkwLayout = { dumpfile: null, timestart: null, zoom: null, marker: null, entries: [] };
  const stack: LayoutEntry[][] = [layout.entries];
  let flags = 0;
  let color: number | undefined;
  const top = () => stack[stack.length - 1]!;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    const c = line[0];
    if (c === '[') {
      const match = /^\[([^\]]+)\]\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, value = ''] = match;
      if (key === 'dumpfile') layout.dumpfile = value.replace(/^"(.*)"$/, '$1');
      else if (key === 'timestart') layout.timestart = Number(value) || 0;
      else if (key === 'color') color = Number.parseInt(value, 10);
      continue;
    }
    if (c === '*') {
      const [zoom, marker] = line.slice(1).trim().split(/\s+/).map(Number);
      if (Number.isFinite(zoom)) layout.zoom = zoom!;
      if (marker !== undefined && Number.isFinite(marker) && marker >= 0) layout.marker = marker;
      continue;
    }
    if (c === '@') {
      flags = Number.parseInt(line.slice(1), 16) || 0;
      continue;
    }
    if (c === '-') {
      const label = line.slice(1);
      if (hasFlag(flags, FLAG.groupBegin)) {
        const group: GroupEntry = { kind: 'group', name: label, collapsed: hasFlag(flags, FLAG.closed), children: [] };
        top().push(group);
        stack.push(group.children);
      } else if (hasFlag(flags, FLAG.groupEnd)) {
        if (stack.length > 1) stack.pop();
      } else {
        top().push(label ? { kind: 'comment', text: label } : { kind: 'blank' });
      }
      color = undefined;
      continue;
    }
    if (c === '+' || c === '#') {
      const match = /^[+#]\{([^}]*)\}\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, braced = '', rest = ''] = match;
      const entry: TraceEntry =
        c === '+'
          ? { kind: 'signal', name: rest.trim(), alias: braced, flags }
          : { kind: 'concat', name: braced, parts: rest.trim().split(/\s+/).filter(Boolean), flags };
      if (color !== undefined) entry.color = color;
      if (entry.kind === 'concat' || entry.name) top().push(entry);
      color = undefined;
      continue;
    }
    if (/^[A-Za-z_\\$]/.test(line)) {
      const entry: SignalEntry = { kind: 'signal', name: line.trim(), flags };
      if (color !== undefined) entry.color = color;
      top().push(entry);
      color = undefined;
    }
    // Anything else (^ filters, > and ! settings, …) is ignored.
  }
  return layout;
}

export function serializeGtkw(layout: GtkwLayout): string {
  const lines = ['[*]', '[*] Saved by SpeedView for Canvas', '[*]'];
  if (layout.dumpfile) lines.push(`[dumpfile] "${layout.dumpfile.replace(/"/g, '')}"`);
  if (layout.timestart !== null) lines.push(`[timestart] ${Math.round(layout.timestart)}`);
  if (layout.zoom !== null) {
    const marker = layout.marker === null ? -1 : Math.round(layout.marker);
    lines.push(`*${layout.zoom.toFixed(6)} ${marker}${' -1'.repeat(26)}`);
  }
  let current: number | null = null;
  const setFlags = (value: number) => {
    if (value !== current) lines.push(`@${value.toString(16)}`);
    current = value;
  };
  const write = (entries: LayoutEntry[]) => {
    for (const entry of entries) {
      switch (entry.kind) {
        case 'comment':
          setFlags(COMMENT_FLAGS);
          lines.push(`-${oneLine(entry.text)}`);
          break;
        case 'blank':
          setFlags(COMMENT_FLAGS);
          lines.push('-');
          break;
        case 'group': {
          const closed = entry.collapsed ? 2 ** FLAG.closed : 0;
          setFlags(COMMENT_FLAGS + 2 ** FLAG.groupBegin + closed);
          lines.push(`-${oneLine(entry.name)}`);
          write(entry.children);
          setFlags(COMMENT_FLAGS + 2 ** FLAG.groupEnd + (entry.collapsed ? closed + 2 ** FLAG.collapsed : 0));
          lines.push(`-${oneLine(entry.name)}`);
          break;
        }
        case 'signal':
        case 'concat':
          if (entry.color !== undefined) lines.push(`[color] ${entry.color}`);
          setFlags(entry.flags);
          if (entry.kind === 'concat') lines.push(`#{${oneLine(entry.name)}} ${entry.parts.join(' ')}`);
          else if (entry.alias) lines.push(`+{${oneLine(entry.alias)}} ${entry.name}`);
          else lines.push(entry.name);
          break;
      }
    }
  };
  write(layout.entries);
  lines.push('[pattern_trace] 1', '[pattern_trace] 0', '');
  return lines.join('\n');
}

const oneLine = (text: string) => text.replace(/[\r\n{}]/g, ' ');
