// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { detectKind } from '../src/render/detect';
import { formatGeneral, formatNumber, isDateCode } from '../src/render/numfmt';
import { columnName, displayValue, parseRef, readWorkbook, shiftFormula } from '../src/render/xlsx';
import { makeXlsx } from './helpers/xlsx';

describe('formatNumber', () => {
  it.each([
    [1234.567, '#,##0.00', '1,234.57'],
    [0.5, '0%', '50%'],
    [0.1234, '0.00%', '12.34%'],
    [1234.5, '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)', '$1,234.50 '],
    [-1234.5, '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)', '($1,234.50)'],
    [1234.5, '[$€-407]#,##0.00', '€1,234.50'],
    [5, '000', '005'],
    [0.123, '#.00', '.12'],
    [1234567, '#,##0,,"M"', '1M'],
    [3, '0 "items"', '3 items'],
    [0, '0;-0;"zero"', 'zero'],
    [-5, '0;-0', '-5'],
    [-5, '0', '-5'],
    [7, '[>5]"big";"small"', 'big'],
    [3, '[>5]"big";"small"', 'small'],
    [12345, '0.00E+00', '1.23E+04'],
    [0.000123, '0.00E+00', '1.23E-04'],
    [12345, '##0.0E+0', '12.3E+3'],
    [44927, 'm/d/yyyy', '1/1/2023'],
    [44927, 'dddd, mmmm d, yyyy', 'Sunday, January 1, 2023'],
    [45000.5, 'yyyy-mm-dd hh:mm', '2023-03-15 12:00'],
    [0.75, 'h:mm AM/PM', '6:00 PM'],
    [1.5, '[h]:mm:ss', '36:00:00'],
    [0.0000578703704, 'mm:ss.0', '00:05.0'],
    [42, '@', '42'],
    [42, 'General', '42'],
  ])('%s with %s → %s', (value, code, expected) => {
    expect(formatNumber(value, code).text).toBe(expected);
  });

  it('reports section colors', () => {
    expect(formatNumber(-1, '0;[Red]-0').color).toBe('#ff0000');
    expect(formatNumber(1, '0;[Red]-0').color).toBeUndefined();
  });

  it('uses the 1904 date system when asked', () => {
    expect(formatNumber(0, 'yyyy-mm-dd', true).text).toBe('1904-01-01');
  });

  it('recognizes date formats', () => {
    expect(isDateCode('m/d/yyyy')).toBe(true);
    expect(isDateCode('[h]:mm')).toBe(true);
    expect(isDateCode('0.00 "days"')).toBe(false);
    expect(isDateCode('General')).toBe(false);
  });
});

describe('formatGeneral', () => {
  it.each([
    [100, '100'],
    [-2.5, '-2.5'],
    [0.1 + 0.2, '0.3'],
    [1 / 3, '0.333333333'],
    [Math.PI, '3.141592654'],
    [123456789012, '1.23457E+11'],
    [1e-10, '1E-10'],
  ])('%s → %s', (value, expected) => {
    expect(formatGeneral(value)).toBe(expected);
  });
});

describe('references', () => {
  it('parse and name columns', () => {
    expect(parseRef('AB12')).toEqual({ row: 12, col: 28 });
    expect(parseRef('$C$3')).toEqual({ row: 3, col: 3 });
    expect(columnName(1)).toBe('A');
    expect(columnName(26)).toBe('Z');
    expect(columnName(27)).toBe('AA');
    expect(columnName(16384)).toBe('XFD');
  });

  it('shift shared formulas like Excel fills them', () => {
    expect(shiftFormula('B2/100', 1, 0)).toBe('B3/100');
    expect(shiftFormula('SUM(A1:B2)*$C$1+$D1+E$1', 2, 1)).toBe('SUM(B3:C4)*$C$1+$D3+F$1');
    expect(shiftFormula('LOG10(A1)&"A1"', 1, 0)).toBe('LOG10(A2)&"A1"');
    expect(shiftFormula("'Sheet A1'!A1", 1, 0)).toBe("'Sheet A1'!A2");
    expect(shiftFormula('A1', -1, 0)).toBe('#REF!');
  });
});

describe('readWorkbook', () => {
  const workbook = readWorkbook(makeXlsx());
  const sheet = workbook.loadSheet(0);
  const cell = (ref: string) => {
    const { row, col } = parseRef(ref)!;
    return sheet.rows.get(row)?.find((c) => c.col === col);
  };
  const shown = (ref: string) => {
    const c = cell(ref)!;
    return displayValue(c, workbook.styles[c.style], workbook.date1904);
  };

  it('lists sheets, including hidden ones', () => {
    expect(workbook.sheets.map((s) => [s.name, s.hidden])).toEqual([['Results', false], ['Key', true]]);
    expect(workbook.activeSheet).toBe(0);
    const key = workbook.loadSheet(1);
    expect(key.rows.get(1)?.[0]?.value).toBe('secret');
  });

  it('reads values with their number formats', () => {
    expect(shown('A2').text).toBe('alice');
    expect(shown('B2').text).toBe('90');
    expect(shown('C2').text).toBe('90.0%');
    expect(shown('D2').text).toBe('1/1/2023');
    expect(shown('B3')).toEqual({ text: '($1,234.50)', color: '#ff0000' });
    expect(shown('A4').text).toBe('TRUE');
    expect(shown('B4').text).toBe('#DIV/0!');
  });

  it('reads formulas, expanding shared ones and keeping ones without a saved result', () => {
    expect(cell('C2')?.formula).toBe('B2/100');
    expect(cell('C3')?.formula).toBe('B3/100');
    expect(shown('C3').text).toBe('-1234.5%');
    expect(cell('C4')).toMatchObject({ formula: 'SUM(B2:B3)', type: 'empty' });
  });

  it('reads styles, merges, and sizes', () => {
    const header = workbook.styles[cell('A1')!.style]!;
    expect(header).toMatchObject({ bold: true, color: '#1f4e79', fill: '#ffff00', hAlign: 'center' });
    expect(header.borders.bottom).toBe('2px solid #000000');
    expect(workbook.styles[0]!.fill).toBeUndefined(); // gray125 is Excel's placeholder, not a fill
    expect(sheet.merges).toEqual([{ r1: 1, c1: 4, r2: 1, c2: 5 }]);
    expect(sheet.colWidths.get(1)).toBe(14);
    expect(sheet.rowHeights.get(3)).toBe(20);
    expect([sheet.maxRow, sheet.maxCol]).toEqual([4, 5]);
  });

  it('is detected by extension', () => {
    expect(detectKind('grades.xlsx', makeXlsx(), false)).toBe('xlsx');
    expect(detectKind('lab/data.XLSM', new Uint8Array(), false)).toBe('xlsx');
    expect(detectKind('old.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0]), false)).toBe('binary');
  });

  it('rejects files that are not workbooks', () => {
    expect(() => readWorkbook(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
