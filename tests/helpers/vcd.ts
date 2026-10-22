import type { LayoutEntry } from '../../src/render/gtkw';

/**
 * A small counter testbench dump and a GTKWave save file for it: a clock, reset, a 4-bit
 * count, an 8-bit bus with x and z values, a real, and a clock aliased into a submodule.
 */
export const COUNTER_VCD = `$date Tue Oct 20 2026 $end
$version Icarus Verilog $end
$timescale 1ns $end
$scope module tb $end
$var reg 1 ! clk $end
$var reg 1 " rst $end
$var wire 4 # count [3:0] $end
$scope module dut $end
$var wire 1 ! clk $end
$var wire 4 # q [3:0] $end
$var wire 8 $ bus [7:0] $end
$var real 64 % vout $end
$upscope $end
$upscope $end
$enddefinitions $end
#0
$dumpvars
0!
1"
bx #
bz $
r0 %
$end
#5
1!
#10
0!
0"
b0 #
b10100101 $
#15
1!
b1 #
r1.5 %
#20
0!
#25
1!
b10 #
bx1 $
#30
0!
#35
1!
b11 #
#40
0!
`;

export const COUNTER_GTKW = `[*]
[*] GTKWave Analyzer v3.3.118 (w)1999-2023 BSI
[*] Tue Oct 20 12:00:00 2026
[*]
[dumpfile] "C:\\Users\\student\\lab4\\counter.vcd"
[dumpfile_mtime] "Tue Oct 20 12:00:00 2026"
[savefile] "C:\\Users\\student\\lab4\\counter.gtkw"
[timestart] 5
[size] 1200 600
[pos] -1 -1
*-3.000000 20 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1
[treeopen] tb.
[sst_width] 200
[signals_width] 150
@28
tb.clk
tb.rst
@200
-Counter outputs
@22
[color] 3
tb.count[3:0]
@24
+{count (dec)} tb.count[3:0]
@200
-
@800200
-Internals
@22
tb.dut.bus[7:0]
@28
tb.dut.bus[0]
@c00200
-Closed group
@420
tb.dut.vout
@1401200
-Closed group
@1000200
-Internals
@22
#{nibbles} tb.count[3:0] tb.dut.bus[3:0]
tb.missing_signal
[pattern_trace] 1
[pattern_trace] 0
`;

/** Compact, comparable view of a layout's entries. */
export const outline = (entries: LayoutEntry[]): unknown[] =>
  entries.map((e) => {
    switch (e.kind) {
      case 'group':
        return { group: e.name, collapsed: e.collapsed, children: outline(e.children) };
      case 'comment':
        return `-${e.text}`;
      case 'blank':
        return '-';
      case 'concat':
        return `#{${e.name}} ${e.parts.join(' ')}`;
      default:
        return e.alias ? `+{${e.alias}} ${e.name}` : e.name;
    }
  });
