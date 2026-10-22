import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/render/csv';
import { detectKind, languageFor } from '../src/render/detect';
import { highlight, splitHighlightedLines } from '../src/render/highlight';
import { parseNotebook } from '../src/render/notebook';
import { decodeText } from '../src/render/text';

const u8 = (s: string) => new TextEncoder().encode(s);

describe('languageFor', () => {
  it.each([
    ['main.py', 'python'],
    ['top.v', 'verilog'],
    ['tb.sv', 'verilog'],
    ['alu.vhd', 'vhdl'],
    ['Makefile', 'makefile'],
    ['src/Main.JAVA', 'java'],
    ['constraints.xdc', 'tcl'],
    ['prog.s', 'auto-asm'],
    ['mystery', 'auto'],
  ])('%s -> %s', (name, lang) => {
    expect(languageFor(name)).toBe(lang);
  });

  it('applies user overrides', () => {
    expect(languageFor('sketch.pde', { pde: 'java' })).toBe('java');
  });
});

describe('detectKind', () => {
  it('uses names, then magic bytes', () => {
    expect(detectKind('a.ipynb', u8('{}'), true)).toBe('notebook');
    expect(detectKind('a.zip', u8(''), false)).toBe('archive');
    expect(detectKind('noext', u8('%PDF-1.7'), false)).toBe('pdf');
    expect(detectKind('noext', new Uint8Array([0x50, 0x4b, 3, 4, 0]), false)).toBe('archive');
    expect(detectKind('lab.jar', new Uint8Array([0x50, 0x4b, 3, 4, 0]), false)).toBe('binary');
    expect(detectKind('x.py', u8('print(1)'), true)).toBe('code');
  });
});

describe('decodeText', () => {
  it('decodes UTF-8 and falls back to Windows-1252', () => {
    expect(decodeText(u8('héllo'))?.encoding).toBe('UTF-8');
    const latin = decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    expect(latin).toEqual({ text: 'café', encoding: 'Windows-1252' });
  });

  it('handles BOMs', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))?.text).toBe('hi');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68]))?.text).toBe('h');
  });

  it('detects binary', () => {
    expect(decodeText(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]))).toBeNull();
  });
});

describe('highlight', () => {
  it('keeps spans balanced across lines', () => {
    const lines = splitHighlightedLines('<span class="a">x\ny<span class="b">z\nw</span></span>');
    expect(lines).toEqual([
      '<span class="a">x</span>',
      '<span class="a">y<span class="b">z</span></span>',
      '<span class="a"><span class="b">w</span></span>',
    ]);
  });

  it('highlights a multi-line Python docstring', () => {
    const { lines, language } = highlight('def f():\n    """doc\n    more"""\n    return 1', 'python');
    expect(language).toBe('python');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain('hljs-string');
  });

  it('highlights Verilog', () => {
    const { lines } = highlight('module counter(input clk);\nendmodule', 'verilog');
    expect(lines[0]).toContain('hljs-keyword');
  });

  it('does not add an empty line for a trailing newline', () => {
    expect(highlight('a\nb\n', 'plaintext').lines).toEqual(['a', 'b']);
    expect(highlight('x = 1\r\n', 'python').lines).toHaveLength(1);
  });

  it('escapes HTML in plain text', () => {
    expect(highlight('<script>', 'plaintext').lines[0]).toBe('&lt;script&gt;');
    expect(highlight('<script>', 'python').lines[0]).not.toContain('<script>');
  });
});

describe('parseCsv', () => {
  it('handles quotes, embedded delimiters, and newlines', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n"multi\nline",2\n').rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', '2'],
    ]);
  });

  it('truncates at maxRows', () => {
    const result = parseCsv('1\n2\n3\n4\n', ',', 2);
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('supports TSV and CRLF', () => {
    expect(parseCsv('a\tb\r\n1\t2', '\t').rows).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseNotebook', () => {
  it('parses cells and outputs', () => {
    const nb = parseNotebook(
      JSON.stringify({
        metadata: { kernelspec: { language: 'python' } },
        nbformat: 4,
        cells: [
          { cell_type: 'markdown', source: ['# Title\n', '![x](attachment:p.png)'], attachments: { 'p.png': { 'image/png': 'AAAA' } } },
          {
            cell_type: 'code',
            execution_count: 3,
            source: 'print(1)',
            outputs: [
              { output_type: 'stream', name: 'stdout', text: ['1\n'] },
              { output_type: 'display_data', data: { 'image/png': 'iVBOR\n', 'text/plain': '<Figure>' } },
              { output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['\u001b[31mValueError\u001b[0m: bad'] },
            ],
          },
        ],
      }),
    );
    expect(nb.language).toBe('python');
    expect(nb.cells[0]!.source).toContain('data:image/png;base64,AAAA');
    expect(nb.cells[1]!.executionCount).toBe(3);
    expect(nb.cells[1]!.outputs).toEqual([
      { kind: 'text', text: '1\n', stream: 'stdout' },
      { kind: 'image', src: 'data:image/png;base64,iVBOR' },
      { kind: 'text', text: 'ValueError: bad', stream: 'error' },
    ]);
  });

  it('rejects non-notebooks', () => {
    expect(() => parseNotebook('{"foo":1}')).toThrow(/nbformat/);
  });
});
