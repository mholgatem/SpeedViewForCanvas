import { describe, expect, it } from 'vitest';
import { FLAG, defaultFlags, hasFlag, parseGtkw, radixOf, serializeGtkw, setFlag, withRadix, type LayoutEntry } from '../src/render/gtkw';
import { COUNTER_GTKW, outline } from './helpers/vcd';

describe('parseGtkw', () => {
  const layout = parseGtkw(COUNTER_GTKW);

  it('reads the header and view', () => {
    expect(layout.dumpfile).toBe('C:\\Users\\student\\lab4\\counter.vcd');
    expect(layout.timestart).toBe(5);
    expect(layout.zoom).toBe(-3);
    expect(layout.marker).toBe(20);
  });

  it('reads traces, comments, blanks, nested and closed groups', () => {
    expect(outline(layout.entries)).toEqual([
      'tb.clk',
      'tb.rst',
      '-Counter outputs',
      'tb.count[3:0]',
      '+{count (dec)} tb.count[3:0]',
      '-',
      {
        group: 'Internals',
        collapsed: false,
        children: ['tb.dut.bus[7:0]', 'tb.dut.bus[0]', { group: 'Closed group', collapsed: true, children: ['tb.dut.vout'] }],
      },
      '#{nibbles} tb.count[3:0] tb.dut.bus[3:0]',
      'tb.missing_signal',
    ]);
  });

  it('maps flags to radixes and keeps colors', () => {
    const [clk, , , count, countDec] = layout.entries as Array<Extract<LayoutEntry, { kind: 'signal' }>>;
    expect(radixOf(clk!.flags)).toBe('bin');
    expect(radixOf(count!.flags)).toBe('hex');
    expect(count!.color).toBe(3);
    expect(radixOf(countDec!.flags)).toBe('dec');
    expect(clk!.color).toBeUndefined();
  });

  it('handles flag bits above 31', () => {
    const flags = setFlag(0x22, 33, true);
    expect(hasFlag(flags, 33)).toBe(true);
    expect(hasFlag(flags, FLAG.hex)).toBe(true);
    const signed = withRadix(flags, 'signed');
    expect(radixOf(signed)).toBe('signed');
    expect(hasFlag(signed, 33)).toBe(true);
    expect(hasFlag(signed, FLAG.hex)).toBe(false);
  });

  it('gives new traces GTKWave’s default flags', () => {
    expect(defaultFlags(1, false).toString(16)).toBe('28');
    expect(defaultFlags(8, false).toString(16)).toBe('22');
  });

  it('round-trips through serializeGtkw', () => {
    const text = serializeGtkw(layout);
    const again = parseGtkw(text);
    expect(again.entries).toEqual(layout.entries);
    expect([again.timestart, again.zoom, again.marker]).toEqual([5, -3, 20]);
    expect(text).toContain('@800200\n-Internals');
    expect(text).toContain('@c00200\n-Closed group');
    expect(text).toContain('[color] 3\n');
  });

  it('ignores lines it does not understand', () => {
    const odd = parseGtkw('[*] x\n^1 filter.txt\n>12\n!foo\n@28\ntb.a\n');
    expect(outline(odd.entries)).toEqual(['tb.a']);
  });
});
