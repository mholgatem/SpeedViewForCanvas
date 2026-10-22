import { describe, expect, it } from 'vitest';
import { normalizeDomain, originPattern, speedGraderPattern } from '../src/settings/domains';
import { formatLanguageOverrides, parseLanguageOverrides } from '../src/settings/overrides';

describe('normalizeDomain', () => {
  it.each([
    ['canvas.asu.edu', 'canvas.asu.edu'],
    ['  Canvas.ASU.edu  ', 'canvas.asu.edu'],
    ['https://canvas.asu.edu/courses/123/gradebook/speed_grader?assignment_id=1', 'canvas.asu.edu'],
    ['https://canvas.asu.edu:443/', 'canvas.asu.edu'],
    ['*.instructure.com', '*.instructure.com'],
    ['http://localhost:5173/courses/1', 'http://localhost'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each(['', 'http://canvas.asu.edu', 'ftp://canvas.asu.edu', 'canvas asu edu', 'canvas.*.edu', '*'])(
    'rejects %s',
    (input) => {
      expect(normalizeDomain(input)).toBeNull();
    },
  );
});

describe('patterns', () => {
  it('builds origin and SpeedGrader patterns', () => {
    expect(originPattern('canvas.asu.edu')).toBe('https://canvas.asu.edu/*');
    expect(speedGraderPattern('canvas.asu.edu')).toBe('https://canvas.asu.edu/courses/*/gradebook/speed_grader*');
    expect(originPattern('http://localhost')).toBe('http://localhost/*');
  });
});

describe('language overrides', () => {
  it('parses lines, ignoring blanks and comments', () => {
    const { overrides, invalidLines } = parseLanguageOverrides('pde = java\n\n# note\n.SV: verilog\nbad line\n');
    expect(overrides).toEqual({ pde: 'java', sv: 'verilog' });
    expect(invalidLines).toEqual([5]);
  });

  it('round-trips', () => {
    const overrides = { pde: 'java', ino: 'cpp' };
    expect(parseLanguageOverrides(formatLanguageOverrides(overrides)).overrides).toEqual(overrides);
  });
});
