import { FLAG, defaultFlags, hasFlag, radixOf, type GroupEntry, type LayoutEntry, type Radix, type SignalEntry, type TraceEntry } from './gtkw';
import { fullName, indexAt, type ScopeNode, type Trace, type Vcd, type VcdSignal } from './vcd';

/**
 * Turns layout entries (from a .gtkw, or one group per scope) into display rows, matching
 * trace names against the VCD's signals, and formats values in each radix.
 */

export type Row =
  | { kind: 'trace'; entry: TraceEntry; depth: number; label: string; scope: string; trace: Trace | null; radix: Radix; invert: boolean; highlight: boolean }
  | { kind: 'comment'; entry: LayoutEntry; depth: number; label: string }
  | { kind: 'blank'; entry: LayoutEntry; depth: number }
  | { kind: 'group'; entry: GroupEntry; depth: number; label: string };

/** Above this many rows, scopes in the default layout start collapsed. */
const DEFAULT_EXPANDED_ROWS = 200;

const clean = (name: string) => name.replace(/\\/g, '');

/** Splits "tb.bus[7:0]" into base "tb.bus" and the bracket indices. */
function splitRange(name: string): { base: string; hi: number | null; lo: number | null } {
  const match = /^(.*?)\[(\d+)(?::(\d+))?\]$/.exec(name);
  if (!match) return { base: name, hi: null, lo: null };
  return { base: match[1]!, hi: Number(match[2]), lo: match[3] === undefined ? null : Number(match[3]) };
}

function declaredRange(signal: VcdSignal): [number, number] | null {
  const match = /^\[(\d+)(?::(\d+))?\]$/.exec(signal.range);
  if (!match) return null;
  const msb = Number(match[1]);
  return [msb, match[2] === undefined ? msb : Number(match[2])];
}

export interface Resolver {
  /** The trace for a gtkw name (whole signal, bit-select, or slice), or null. */
  resolve(name: string): { trace: Trace; signal: VcdSignal } | null;
}

export function makeResolver(vcd: Vcd): Resolver {
  const byName = new Map<string, VcdSignal[]>();
  const byLeaf = new Map<string, VcdSignal[]>();
  const add = (map: Map<string, VcdSignal[]>, key: string, signal: VcdSignal) => {
    const list = map.get(key);
    if (list) list.push(signal);
    else map.set(key, [signal]);
  };
  for (const signal of vcd.signals) {
    add(byName, clean(fullName(signal)), signal);
    add(byLeaf, clean(signal.name), signal);
  }
  const derived = new Map<string, Trace>();

  const pick = (candidates: VcdSignal[], hi: number | null, lo: number | null): { signal: VcdSignal; bits: [number, number] | null } | null => {
    if (hi === null) return candidates[0] ? { signal: candidates[0], bits: null } : null;
    for (const signal of candidates) {
      const range = declaredRange(signal);
      const low = lo ?? hi;
      if (!range) continue;
      if (range[0] === hi && range[1] === low) return { signal, bits: null };
      const [msb, lsb] = range;
      const inside = (n: number) => n <= Math.max(msb, lsb) && n >= Math.min(msb, lsb);
      if (inside(hi) && inside(low)) return { signal, bits: [hi, low] };
    }
    return null;
  };

  const lookup = (name: string): { signal: VcdSignal; bits: [number, number] | null } | null => {
    const cleaned = clean(name);
    // Bit-blasted signals keep the index in their VCD name ("data[3]").
    const literal = byName.get(cleaned);
    if (literal) return { signal: literal[0]!, bits: null };
    const { base, hi, lo } = splitRange(cleaned);
    const exact = byName.get(base);
    if (exact) return pick(exact, hi, lo);
    // A grader's save file used for a student who named scopes differently: match the
    // longest unique trailing part of the path.
    const parts = base.split('.');
    const leafCandidates = byLeaf.get(parts[parts.length - 1]!) ?? [];
    for (let keep = parts.length - 1; keep >= 1; keep--) {
      const suffix = parts.slice(parts.length - keep).join('.');
      const matches = leafCandidates.filter((s) => {
        const full = clean(fullName(s));
        return full === suffix || full.endsWith(`.${suffix}`);
      });
      if (!matches.length) continue;
      const distinct = (list: VcdSignal[]) => new Set(list.map((s) => clean(fullName(s)))).size;
      if (distinct(matches) === 1) return pick(matches, hi, lo);
      // Several signals end the same way: a renamed top scope keeps the depth (tb.clk ->
      // testbench.clk, not testbench.dut.clk). Otherwise don't guess.
      const sameDepth = matches.filter((s) => s.scope.length + 1 === parts.length);
      return distinct(sameDepth) === 1 ? pick(sameDepth, hi, lo) : null;
    }
    return null;
  };

  return {
    resolve(name) {
      const found = lookup(name);
      if (!found) return null;
      const trace = vcd.traces.get(found.signal.code);
      if (!trace) return null;
      if (!found.bits) return { trace, signal: found.signal };
      const key = `${found.signal.code}|${found.bits.join(':')}`;
      let slice = derived.get(key);
      if (!slice) {
        const [msb, lsb] = declaredRange(found.signal)!;
        const pos = (n: number) => (msb >= lsb ? msb - n : n - msb);
        const [hi, lo] = found.bits;
        const start = Math.min(pos(hi), pos(lo));
        const end = Math.max(pos(hi), pos(lo)) + 1;
        slice = sliceTrace(trace, start, end, pos(hi) > pos(lo));
        derived.set(key, slice);
      }
      return { trace: slice, signal: found.signal };
    },
  };
}

function bitsOf(trace: Trace, i: number): string {
  if (trace.scalars) return '01xz'[trace.scalars[i]!]!;
  return trace.values![i]!;
}

function buildTrace(times: number[], values: string[]): Trace {
  const width = values[0]?.length ?? 1;
  if (width === 1) {
    return { width, real: false, times: Float64Array.from(times), scalars: Uint8Array.from(values, (v) => '01xz'.indexOf(v)) };
  }
  return { width, real: false, times: Float64Array.from(times), values };
}

/** Bits [start, end) of a vector (MSB-first positions), reversed if the select is ascending. */
function sliceTrace(trace: Trace, start: number, end: number, reverse: boolean): Trace {
  const times: number[] = [];
  const values: string[] = [];
  for (let i = 0; i < trace.times.length; i++) {
    let value = bitsOf(trace, i).slice(start, end);
    if (reverse) value = [...value].reverse().join('');
    if (values.length && values[values.length - 1] === value) continue;
    times.push(trace.times[i]!);
    values.push(value);
  }
  return buildTrace(times, values);
}

/** Concatenation of several traces, first part most significant. */
export function concatTraces(parts: Trace[]): Trace | null {
  if (!parts.length || parts.some((p) => p.real)) return null;
  const all = new Set<number>();
  for (const part of parts) for (const t of part.times) all.add(t);
  const sorted = [...all].sort((a, b) => a - b);
  const times: number[] = [];
  const values: string[] = [];
  for (const t of sorted) {
    const value = parts
      .map((p) => {
        const i = indexAt(p.times, t);
        return i < 0 ? 'x'.repeat(p.width) : bitsOf(p, i);
      })
      .join('');
    if (values.length && values[values.length - 1] === value) continue;
    times.push(t);
    values.push(value);
  }
  return buildTrace(times, values);
}

export function traceFor(resolver: Resolver, entry: TraceEntry): Trace | null {
  if (entry.kind === 'signal') return resolver.resolve(entry.name)?.trace ?? null;
  const parts = entry.parts.map((p) => resolver.resolve(p)?.trace ?? null);
  return parts.every((p): p is Trace => p !== null) ? concatTraces(parts) : null;
}

/** Splits a display name into the dimmed scope part and the signal itself. */
export function splitLabel(name: string): { scope: string; label: string } {
  const { base } = splitRange(name);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? { scope: '', label: name } : { scope: name.slice(0, dot + 1), label: name.slice(dot + 1) };
}

/** Visible rows, skipping the contents of collapsed groups. */
export function layoutRows(entries: LayoutEntry[], resolver: Resolver): Row[] {
  const rows: Row[] = [];
  const walk = (list: LayoutEntry[], depth: number) => {
    for (const entry of list) {
      switch (entry.kind) {
        case 'group':
          rows.push({ kind: 'group', entry, depth, label: entry.name });
          if (!entry.collapsed) walk(entry.children, depth + 1);
          break;
        case 'comment':
          rows.push({ kind: 'comment', entry, depth, label: entry.text });
          break;
        case 'blank':
          rows.push({ kind: 'blank', entry, depth });
          break;
        default: {
          const trace = traceFor(resolver, entry);
          const named = entry.alias ? { scope: '', label: entry.alias } : splitLabel(entry.name);
          rows.push({
            kind: 'trace',
            entry,
            depth,
            label: named.label,
            scope: named.scope,
            trace,
            radix: radixOf(entry.flags) ?? 'hex',
            invert: hasFlag(entry.flags, FLAG.invert),
            highlight: hasFlag(entry.flags, FLAG.highlight),
          });
        }
      }
    }
  };
  walk(entries, 0);
  return rows;
}

/** GTKWave-style name for a signal: full path plus its range. */
export function gtkwName(signal: VcdSignal): string {
  return fullName(signal) + signal.range;
}

export function signalEntry(signal: VcdSignal): SignalEntry {
  return { kind: 'signal', name: gtkwName(signal), flags: defaultFlags(signal.width, isReal(signal)) };
}

export const isReal = (signal: VcdSignal) => ['real', 'realtime', 'shortreal', 'string'].includes(signal.type);

/** Layout used without a save file: every signal, one group per scope. */
export function defaultLayout(vcd: Vcd): LayoutEntry[] {
  let budget = DEFAULT_EXPANDED_ROWS;
  const build = (scope: ScopeNode): LayoutEntry[] => {
    const entries: LayoutEntry[] = scope.signals.map(signalEntry);
    for (const child of scope.scopes) {
      const group: GroupEntry = { kind: 'group', name: child.name, collapsed: false, children: [] };
      entries.push(group);
      group.children = build(child);
    }
    return entries;
  };
  const entries = build(vcd.root);
  // Expand breadth-first until the row budget runs out.
  const queue: GroupEntry[] = entries.filter((e): e is GroupEntry => e.kind === 'group');
  for (const e of entries) if (e.kind !== 'group') budget--;
  while (queue.length) {
    const group = queue.shift()!;
    budget -= 1;
    if (budget - group.children.length < 0) {
      group.collapsed = true;
      continue;
    }
    budget -= group.children.filter((c) => c.kind !== 'group').length;
    queue.push(...group.children.filter((c): c is GroupEntry => c.kind === 'group'));
  }
  return entries;
}

// ---- Values ----

/** Bit string for a value; real traces return their number text. */
export function valueBits(trace: Trace, i: number): string {
  return bitsOf(trace, i);
}

function invertBits(bits: string): string {
  let out = '';
  for (const b of bits) out += b === '0' ? '1' : b === '1' ? '0' : b;
  return out;
}

function groupDigits(bits: string, size: number): string {
  const padded = bits.padStart(Math.ceil(bits.length / size) * size, bits[0] === 'x' || bits[0] === 'z' ? bits[0] : '0');
  let out = '';
  for (let i = 0; i < padded.length; i += size) {
    const chunk = padded.slice(i, i + size);
    if (/^[01]+$/.test(chunk)) out += Number.parseInt(chunk, 2).toString(16).toUpperCase();
    else if (/^x+$/.test(chunk)) out += 'x';
    else if (/^z+$/.test(chunk)) out += 'z';
    else out += /x/.test(chunk) ? 'X' : 'Z';
  }
  return out;
}

/** A bit string (MSB first) in the given radix. */
export function formatValue(bits: string, radix: Radix): string {
  if (bits.length === 1) return bits;
  const known = /^[01]+$/.test(bits);
  switch (radix) {
    case 'bin':
      return bits;
    case 'oct':
      return groupDigits(bits, 3);
    case 'hex':
      return groupDigits(bits, 4);
    case 'dec':
    case 'signed': {
      if (!known) return /^z+$/.test(bits) ? 'z' : /^x+$/.test(bits) ? 'x' : 'X';
      const value = BigInt(`0b${bits}`);
      if (radix === 'signed' && bits[0] === '1') return (value - (1n << BigInt(bits.length))).toString();
      return value.toString();
    }
    case 'ascii': {
      if (!known) return groupDigits(bits, 4);
      const padded = bits.padStart(Math.ceil(bits.length / 8) * 8, '0');
      let out = '';
      for (let i = 0; i < padded.length; i += 8) {
        const code = Number.parseInt(padded.slice(i, i + 8), 2);
        if (code === 0 && !out) continue; // leading NULs from padding
        out += code >= 32 && code < 127 ? String.fromCharCode(code) : '.';
      }
      return out;
    }
  }
}

/** Text for a row's value at change index `i`. */
export function displayValue(row: Extract<Row, { kind: 'trace' }>, i: number): string {
  const trace = row.trace!;
  if (trace.real) return trace.values![i]!;
  let bits = bitsOf(trace, i);
  if (row.invert) bits = invertBits(bits);
  if (hasFlag(row.entry.flags, FLAG.reverse)) bits = [...bits].reverse().join('');
  return formatValue(bits, row.radix);
}

/** Share of a layout's traces found in the VCD (0–1), used to pick a layout for each dump. */
export function coverage(resolver: Resolver, entries: LayoutEntry[]): number {
  let total = 0;
  let found = 0;
  const walk = (list: LayoutEntry[]) => {
    for (const entry of list) {
      if (entry.kind === 'group') walk(entry.children);
      else if (entry.kind === 'signal' || entry.kind === 'concat') {
        total++;
        if (traceFor(resolver, entry)) found++;
      }
    }
  };
  walk(entries);
  return total ? found / total : 0;
}
