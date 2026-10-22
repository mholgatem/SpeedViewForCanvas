import { describe, expect, it } from 'vitest';
import { parseGtkw, withRadix, type SignalEntry } from '../src/render/gtkw';
import { parseVcd } from '../src/render/vcd';
import { defaultLayout, displayValue, formatValue, layoutRows, makeResolver, type Row } from '../src/render/waveLayout';
import { COUNTER_GTKW, COUNTER_VCD, outline } from './helpers/vcd';

type TraceRow = Extract<Row, { kind: 'trace' }>;
const vcd = parseVcd(COUNTER_VCD);
const resolver = makeResolver(vcd);
const valueAtTime = (row: TraceRow, t: number) => {
  let i = -1;
  row.trace!.times.forEach((time, index) => {
    if (time <= t) i = index;
  });
  return i < 0 ? null : displayValue(row, i);
};

describe('makeResolver', () => {
  it('matches exact names, with or without the range', () => {
    expect(resolver.resolve('tb.count[3:0]')?.signal.name).toBe('count');
    expect(resolver.resolve('tb.count')?.signal.name).toBe('count');
    expect(resolver.resolve('tb.dut.bus[7:0]')?.trace.width).toBe(8);
  });

  it('selects bits and slices of a vector', () => {
    const bit0 = resolver.resolve('tb.dut.bus[0]')!.trace;
    expect(bit0.width).toBe(1);
    expect([...bit0.scalars!]).toEqual([3, 1]); // z, then 1 (x1 keeps bit 0 at 1)
    const low = resolver.resolve('tb.dut.bus[3:0]')!.trace;
    expect(low.values).toEqual(['zzzz', '0101', 'xxx1']);
  });

  it('falls back to a unique suffix when the testbench is named differently', () => {
    expect(resolver.resolve('top_tb.dut.bus[7:0]')?.signal.scope).toEqual(['tb', 'dut']);
    expect(resolver.resolve('my_tb.rst')?.signal.name).toBe('rst');
    // "clk" exists in both tb and tb.dut: the one at the same depth wins.
    expect(resolver.resolve('other.clk')?.signal.scope).toEqual(['tb']);
    expect(resolver.resolve('x.y.clk')?.signal.scope).toEqual(['tb', 'dut']);
    // Same depth and still several candidates: not guessed.
    const twins = makeResolver(parseVcd('$scope module a $end $var wire 1 ! clk $end $upscope $end $scope module b $end $var wire 1 " clk $end $upscope $end $enddefinitions $end'));
    expect(twins.resolve('c.clk')).toBeNull();
    expect(resolver.resolve('tb.nothing')).toBeNull();
  });
});

describe('layoutRows', () => {
  const rows = layoutRows(parseGtkw(COUNTER_GTKW).entries, resolver);

  it('lists rows from the save file, hiding the contents of closed groups', () => {
    expect(rows.map((r) => (r.kind === 'trace' ? r.label : r.kind === 'blank' ? '-' : `${r.kind}:${r.label}`))).toEqual([
      'clk',
      'rst',
      'comment:Counter outputs',
      'count[3:0]',
      'count (dec)',
      '-',
      'group:Internals',
      'bus[7:0]',
      'bus[0]',
      'group:Closed group',
      'nibbles',
      'missing_signal',
    ]);
    expect(rows.find((r) => r.kind === 'group' && r.label === 'Closed group')!.depth).toBe(1);
  });

  it('formats values in each row’s radix and marks missing signals', () => {
    const traces = rows.filter((r): r is TraceRow => r.kind === 'trace');
    const byLabel = (label: string) => traces.find((r) => r.label === label)!;
    expect(valueAtTime(byLabel('count[3:0]'), 36)).toBe('3');
    expect(valueAtTime(byLabel('count (dec)'), 36)).toBe('3');
    expect(valueAtTime(byLabel('bus[7:0]'), 12)).toBe('A5');
    expect(valueAtTime(byLabel('bus[7:0]'), 30)).toBe('xX');
    expect(valueAtTime(byLabel('nibbles'), 12)).toBe('05');
    expect(byLabel('missing_signal').trace).toBeNull();
  });

  it('applies radix changes made while editing', () => {
    const entries = parseGtkw(COUNTER_GTKW).entries;
    const count = entries[3] as SignalEntry;
    count.flags = withRadix(count.flags, 'bin');
    const row = layoutRows(entries, resolver).find((r): r is TraceRow => r.kind === 'trace' && r.entry === count)!;
    expect(valueAtTime(row, 36)).toBe('0011');
  });
});

describe('defaultLayout', () => {
  it('groups every signal by scope', () => {
    expect(outline(defaultLayout(vcd))).toEqual([
      {
        group: 'tb',
        collapsed: false,
        children: [
          'tb.clk',
          'tb.rst',
          'tb.count[3:0]',
          { group: 'dut', collapsed: false, children: ['tb.dut.clk', 'tb.dut.q[3:0]', 'tb.dut.bus[7:0]', 'tb.dut.vout'] },
        ],
      },
    ]);
  });

  it('collapses scopes when there are too many signals to show at once', () => {
    const vars = Array.from({ length: 150 }, (_, i) => `$var wire 1 a${i} s${i} $end`).join('\n');
    const big = parseVcd(`$scope module a $end ${vars} $upscope $end $scope module b $end ${vars.replace(/a(\d+)/g, 'b$1')} $upscope $end $enddefinitions $end`);
    const groups = defaultLayout(big) as Array<{ collapsed: boolean }>;
    expect(groups.map((g) => g.collapsed)).toEqual([false, true]);
  });
});

describe('formatValue', () => {
  it('formats known values in every radix', () => {
    expect(formatValue('10100101', 'hex')).toBe('A5');
    expect(formatValue('10100101', 'dec')).toBe('165');
    expect(formatValue('10100101', 'signed')).toBe('-91');
    expect(formatValue('10100101', 'bin')).toBe('10100101');
    expect(formatValue('10100101', 'oct')).toBe('245');
    expect(formatValue('0100100001101001', 'ascii')).toBe('Hi');
    expect(formatValue('1', 'hex')).toBe('1');
  });

  it('shows unknown and floating bits', () => {
    expect(formatValue('xxxxxxxx', 'hex')).toBe('xx');
    expect(formatValue('xxxx0101', 'hex')).toBe('x5');
    expect(formatValue('xx010101', 'hex')).toBe('X5');
    expect(formatValue('zzzz', 'hex')).toBe('z');
    expect(formatValue('z101', 'hex')).toBe('Z');
    expect(formatValue('x101', 'dec')).toBe('X');
    expect(formatValue('zzzz', 'dec')).toBe('z');
  });

  it('handles values wider than 53 bits', () => {
    expect(formatValue('1'.repeat(64), 'dec')).toBe('18446744073709551615');
    expect(formatValue('1'.repeat(64), 'signed')).toBe('-1');
  });
});
