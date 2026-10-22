import { describe, expect, it } from 'vitest';
import { detectKind } from '../src/render/detect';
import { extendBits, formatTime, fullName, indexAt, parseVcd, valueAt, V0, V1, VX, VZ } from '../src/render/vcd';
import { COUNTER_VCD } from './helpers/vcd';

describe('parseVcd', () => {
  const vcd = parseVcd(new TextEncoder().encode(COUNTER_VCD));

  it('reads the timescale, scopes, and variables', () => {
    expect(vcd.timescale).toEqual({ magnitude: 1, unit: 'ns' });
    expect(vcd.root.scopes.map((s) => s.name)).toEqual(['tb']);
    expect(vcd.root.scopes[0]!.scopes.map((s) => s.name)).toEqual(['dut']);
    expect(vcd.signals.map((s) => `${fullName(s)}${s.range}:${s.width}`)).toEqual([
      'tb.clk:1',
      'tb.rst:1',
      'tb.count[3:0]:4',
      'tb.dut.clk:1',
      'tb.dut.q[3:0]:4',
      'tb.dut.bus[7:0]:8',
      'tb.dut.vout:1',
    ]);
    expect(vcd.endTime).toBe(40);
    expect(vcd.truncatedAt).toBeNull();
  });

  it('shares one trace between aliased variables', () => {
    const clk = vcd.signals.find((s) => fullName(s) === 'tb.clk')!;
    const dutClk = vcd.signals.find((s) => fullName(s) === 'tb.dut.clk')!;
    expect(clk.code).toBe(dutClk.code);
    expect(vcd.traces.size).toBe(5);
  });

  it('stores scalar, vector, and real changes', () => {
    const clk = vcd.traces.get('!')!;
    expect([...clk.times]).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40]);
    expect(valueAt(clk, 7)).toBe(V1);
    expect(valueAt(clk, 10)).toBe(V0);
    const count = vcd.traces.get('#')!;
    expect(count.values).toEqual(['xxxx', '0000', '0001', '0010', '0011']);
    expect(valueAt(count, 12)).toBe('0000');
    const bus = vcd.traces.get('$')!;
    expect(bus.values).toEqual(['zzzzzzzz', '10100101', 'xxxxxxx1']);
    const vout = vcd.traces.get('%')!;
    expect(vout.real).toBe(true);
    expect(vout.values).toEqual(['0', '1.5']);
  });

  it('left-extends vector values per the VCD rules', () => {
    expect(extendBits('1', 4)).toBe('0001');
    expect(extendBits('x1', 4)).toBe('xxx1');
    expect(extendBits('z', 3)).toBe('zzz');
    expect(extendBits('101', 3)).toBe('101');
  });

  it('keeps the last value when a signal changes twice in one time step', () => {
    const v = parseVcd('$timescale 10 ps $end $var wire 1 a x $end $enddefinitions $end #0 0a 1a #3 xa #4 za');
    const trace = v.traces.get('a')!;
    expect([...trace.times]).toEqual([0, 3, 4]);
    expect([...trace.scalars!]).toEqual([V1, VX, VZ]);
    expect(v.timescale).toEqual({ magnitude: 10, unit: 'ps' });
  });

  it('stops at the change limit and says where', () => {
    const v = parseVcd(COUNTER_VCD, { maxChanges: 6 });
    expect(v.truncatedAt).not.toBeNull();
    expect(v.changeCount).toBeLessThanOrEqual(7);
  });

  it('finds values at the edges of the trace', () => {
    const times = Float64Array.from([0, 10, 20]);
    expect(indexAt(times, -1)).toBe(-1);
    expect(indexAt(times, 0)).toBe(0);
    expect(indexAt(times, 19.9)).toBe(1);
    expect(indexAt(times, 1000)).toBe(2);
  });

  it('reports files that are not VCDs', () => {
    expect(() => parseVcd('hello world')).toThrow(/doesn’t look like a VCD/);
    expect(() => parseVcd('$timescale 3 ns $end $enddefinitions $end')).toThrow(/timescale/);
    expect(() => parseVcd('$var wire 1 $end $enddefinitions $end')).toThrow(/incomplete/);
  });

  it('formats times in readable units', () => {
    const ns = { magnitude: 1, unit: 'ns' } as const;
    expect(formatTime(0, ns)).toBe('0');
    expect(formatTime(15, ns)).toBe('15 ns');
    expect(formatTime(1500, ns)).toBe('1.5 µs');
    expect(formatTime(5, { magnitude: 100, unit: 'ps' })).toBe('500 ps');
  });

  it('is detected by extension', () => {
    expect(detectKind('lab4/counter.vcd', new Uint8Array(), true)).toBe('vcd');
  });
});
