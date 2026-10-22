import { decode } from './ooxml';

/**
 * Value Change Dump (IEEE 1364 §18) reader. One pass over the text: the header builds the
 * scope tree and variable list, then value changes are stored per identifier code as a
 * time array plus values (codes for 1-bit signals, bit/number strings for the rest).
 */

export interface Timescale {
  /** 1, 10 or 100. */
  magnitude: number;
  unit: 's' | 'ms' | 'us' | 'ns' | 'ps' | 'fs';
}

export interface VcdSignal {
  /** Name without its range, e.g. "count". */
  name: string;
  /** Enclosing scopes, outermost first, e.g. ["tb", "dut"]. */
  scope: string[];
  /** Declared range such as "[3:0]", or "" for none. */
  range: string;
  width: number;
  /** wire, reg, real, integer, parameter, … */
  type: string;
  /** Identifier code; several signals can share one (aliases). */
  code: string;
}

export interface ScopeNode {
  name: string;
  type: string;
  scopes: ScopeNode[];
  signals: VcdSignal[];
}

/** Scalar value codes. */
export const V0 = 0;
export const V1 = 1;
export const VX = 2;
export const VZ = 3;

export interface Trace {
  width: number;
  /** Real or string values: shown as text, never as bits. */
  real: boolean;
  /** Change times, ascending, in timescale ticks. */
  times: Float64Array;
  /** 1-bit signals: V0/V1/VX/VZ codes. */
  scalars?: Uint8Array;
  /** Vectors: bit strings (MSB first, full width); reals: number text. */
  values?: string[];
}

export interface Vcd {
  timescale: Timescale;
  root: ScopeNode;
  signals: VcdSignal[];
  traces: Map<string, Trace>;
  endTime: number;
  /** Set when parsing stopped at the value-change limit. */
  truncatedAt: number | null;
  changeCount: number;
}

export interface VcdLimits {
  maxChanges: number;
}

export const DEFAULT_MAX_CHANGES = 10_000_000;

const UNITS: Timescale['unit'][] = ['s', 'ms', 'us', 'ns', 'ps', 'fs'];
const SCALAR_CODES: Record<string, number> = { '0': V0, '1': V1, x: VX, X: VX, z: VZ, Z: VZ, h: V1, H: V1, l: V0, L: V0 };

interface Building {
  width: number;
  real: boolean;
  times: number[];
  scalars: number[];
  values: string[];
}

export function parseVcd(input: Uint8Array | string, limits: VcdLimits = { maxChanges: DEFAULT_MAX_CHANGES }): Vcd {
  const text = typeof input === 'string' ? input : decode(input);
  const length = text.length;
  let pos = 0;

  const next = (): string | null => {
    while (pos < length && text.charCodeAt(pos) <= 32) pos++;
    if (pos >= length) return null;
    const start = pos;
    while (pos < length && text.charCodeAt(pos) > 32) pos++;
    return text.slice(start, pos);
  };
  /** Tokens up to the next $end. */
  const untilEnd = (what: string): string[] => {
    const tokens: string[] = [];
    for (;;) {
      const token = next();
      if (token === null) throw new Error(`the file ends inside ${what}`);
      if (token === '$end') return tokens;
      tokens.push(token);
    }
  };

  const timescale: Timescale = { magnitude: 1, unit: 's' };
  const root: ScopeNode = { name: '', type: '', scopes: [], signals: [] };
  const stack: ScopeNode[] = [root];
  const signals: VcdSignal[] = [];
  const building = new Map<string, Building>();
  let sawTimescale = false;

  // ---- Header ----
  for (;;) {
    const token = next();
    if (token === null) throw new Error('this doesn’t look like a VCD file (no $enddefinitions)');
    if (token === '$enddefinitions') {
      untilEnd('$enddefinitions');
      break;
    }
    if (token === '$timescale') {
      const match = /^(1|10|100)\s*(s|ms|us|ns|ps|fs)$/.exec(untilEnd('$timescale').join(''));
      if (!match) throw new Error('the $timescale is not valid');
      timescale.magnitude = Number(match[1]);
      timescale.unit = match[2] as Timescale['unit'];
      sawTimescale = true;
    } else if (token === '$scope') {
      const [type = '', name = ''] = untilEnd('$scope');
      const scope: ScopeNode = { name, type, scopes: [], signals: [] };
      stack[stack.length - 1]!.scopes.push(scope);
      stack.push(scope);
    } else if (token === '$upscope') {
      untilEnd('$upscope');
      if (stack.length > 1) stack.pop();
    } else if (token === '$var') {
      const [type = '', size = '', code = '', ...rest] = untilEnd('$var');
      let name = rest[0] ?? '';
      let range = rest.slice(1).join('');
      if (!code || !name) throw new Error('a $var declaration is incomplete');
      const inline = /^(.+?)(\[\d+(?::\d+)?\])$/.exec(name);
      if (!range && inline && !/^\\/.test(name)) {
        name = inline[1]!;
        range = inline[2]!;
      }
      const real = type === 'real' || type === 'realtime' || type === 'shortreal' || type === 'string';
      const width = real ? 1 : Math.max(1, Number.parseInt(size, 10) || 1);
      const signal: VcdSignal = { name, scope: stack.slice(1).map((s) => s.name), range, width, type, code };
      signals.push(signal);
      stack[stack.length - 1]!.signals.push(signal);
      if (!building.has(code)) building.set(code, { width, real, times: [], scalars: [], values: [] });
    } else if (token.startsWith('$')) {
      untilEnd(token); // $date, $version, $comment and unknown sections
    } else {
      throw new Error('this doesn’t look like a VCD file (unexpected text in the header)');
    }
  }
  if (!sawTimescale) {
    // Default from the standard's examples; most simulators always write one.
    timescale.magnitude = 1;
    timescale.unit = 'ns';
  }

  // ---- Value changes ----
  let time = 0;
  let endTime = 0;
  let changes = 0;
  let truncatedAt: number | null = null;

  const record = (code: string, scalar: number, value: string | null) => {
    const trace = building.get(code);
    if (!trace) return;
    const last = trace.times.length - 1;
    if (last >= 0 && trace.times[last] === time) {
      // Several changes at one time step: keep the last.
      if (value === null) trace.scalars[last] = scalar;
      else trace.values[last] = value;
      return;
    }
    trace.times.push(time);
    if (value === null) trace.scalars.push(scalar);
    else trace.values.push(value);
    changes++;
  };

  for (;;) {
    const token = next();
    if (token === null) break;
    const c = token[0]!;
    if (c === '#') {
      const t = Number(token.slice(1));
      if (Number.isFinite(t) && t >= time) time = t;
      if (time > endTime) endTime = time;
      if (changes >= limits.maxChanges) {
        truncatedAt = time;
        break;
      }
    } else if (c === '$') {
      if (token === '$comment') untilEnd('$comment');
      // $dumpvars/$dumpon/$dumpoff/$dumpall list values like the body does; their $end is ignored.
    } else if (c === 'b' || c === 'B') {
      const code = next();
      if (code === null) break;
      const trace = building.get(code);
      if (!trace) continue;
      if (trace.real) {
        record(code, 0, token.slice(1));
        continue;
      }
      const bits = extendBits(token.slice(1).toLowerCase(), trace.width);
      if (trace.width === 1) record(code, SCALAR_CODES[bits] ?? VX, null);
      else record(code, 0, bits);
    } else if (c === 'r' || c === 'R' || c === 's' || c === 'S') {
      const code = next();
      if (code === null) break;
      const trace = building.get(code);
      if (!trace) continue;
      record(code, 0, trace.real ? token.slice(1) : extendBits('x', trace.width));
    } else if (c in SCALAR_CODES || c === 'u' || c === 'U' || c === 'w' || c === 'W' || c === '-') {
      const code = token.slice(1);
      const trace = building.get(code);
      if (!trace) continue;
      const scalar = SCALAR_CODES[c] ?? VX;
      if (trace.width === 1 && !trace.real) record(code, scalar, null);
      else if (!trace.real) record(code, 0, extendBits(c.toLowerCase(), trace.width));
    }
  }

  const traces = new Map<string, Trace>();
  for (const [code, b] of building) {
    const trace: Trace = { width: b.width, real: b.real, times: Float64Array.from(b.times) };
    if (b.width === 1 && !b.real) trace.scalars = Uint8Array.from(b.scalars);
    else trace.values = b.values;
    traces.set(code, trace);
  }
  return { timescale, root, signals, traces, endTime, truncatedAt, changeCount: changes };
}

/** Left-extend a VCD vector value to `width` bits: 0/1 extend with 0, x and z with themselves. */
export function extendBits(bits: string, width: number): string {
  if (bits.length >= width) return bits.length === width ? bits : bits.slice(bits.length - width);
  const lead = bits[0] === 'x' || bits[0] === 'z' ? bits[0] : '0';
  return lead.repeat(width - bits.length) + bits;
}

/** Index of the last change at or before `t`, or -1 if `t` is before the first change. */
export function indexAt(times: Float64Array, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Index of the first change strictly after `t` (times.length if none). */
export function indexAfter(times: Float64Array, t: number): number {
  return indexAt(times, t) + 1;
}

/** Value at time `t`: a scalar code, a bit/number string, or null before the first change. */
export function valueAt(trace: Trace, t: number): number | string | null {
  const i = indexAt(trace.times, t);
  if (i < 0) return null;
  return trace.scalars ? trace.scalars[i]! : trace.values![i]!;
}

/** Full hierarchical name, e.g. "tb.dut.count". */
export function fullName(signal: VcdSignal): string {
  return [...signal.scope, signal.name].join('.');
}

const UNIT_EXP: Record<Timescale['unit'], number> = { s: 0, ms: -3, us: -6, ns: -9, ps: -12, fs: -15 };
const UNIT_LABEL: Record<Timescale['unit'], string> = { s: 's', ms: 'ms', us: 'µs', ns: 'ns', ps: 'ps', fs: 'fs' };

export function timescaleLabel(ts: Timescale): string {
  return `${ts.magnitude} ${UNIT_LABEL[ts.unit]}`;
}

/** Ticks as a readable time, choosing the largest unit where the value is at least 1. */
export function formatTime(ticks: number, ts: Timescale): string {
  if (ticks === 0) return '0';
  const seconds = ticks * ts.magnitude * 10 ** UNIT_EXP[ts.unit];
  const unit = UNITS.find((u) => Math.abs(seconds) >= 10 ** UNIT_EXP[u] * (1 - 1e-9)) ?? 'fs';
  const value = seconds / 10 ** UNIT_EXP[unit];
  const rounded = Math.round(value * 1000) / 1000;
  return `${rounded.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${UNIT_LABEL[unit]}`;
}
