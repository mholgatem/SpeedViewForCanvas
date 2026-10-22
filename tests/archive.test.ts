import { gzipSync, strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ArchiveLimitError, extractArchive, sanitizePath } from '../src/archive';
import { makeTar } from './helpers/tar';

const limits = { maxEntries: 100, maxTotalBytes: 10 * 1024 * 1024 };
const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe('zip', () => {
  it('extracts files and skips directories and OS junk', () => {
    const zip = zipSync({
      'proj/': new Uint8Array(),
      'proj/main.py': strToU8('print("hi")'),
      'proj/sub/util.v': strToU8('module m; endmodule'),
      '__MACOSX/proj/._main.py': strToU8('junk'),
      'proj/.DS_Store': strToU8('junk'),
    });
    const entries = extractArchive('zip', zip, 'proj.zip', limits);
    expect(entries.map((e) => e.path).sort()).toEqual(['proj/main.py', 'proj/sub/util.v']);
    expect(text(entries.find((e) => e.path === 'proj/main.py')!.data)).toBe('print("hi")');
  });

  it('enforces the entry limit', () => {
    const files = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}.txt`, strToU8('x')]));
    expect(() => extractArchive('zip', zipSync(files), 'a.zip', { ...limits, maxEntries: 3 })).toThrow(ArchiveLimitError);
  });

  it('enforces the total size limit (zip bomb)', () => {
    const zip = zipSync({ 'big.txt': new Uint8Array(2 * 1024 * 1024) }, { level: 9 });
    expect(zip.length).toBeLessThan(20_000);
    expect(() => extractArchive('zip', zip, 'bomb.zip', { ...limits, maxTotalBytes: 1024 * 1024 })).toThrow(ArchiveLimitError);
  });

  it('reports damaged zips', () => {
    expect(() => extractArchive('zip', strToU8('PK\x03\x04garbage'), 'bad.zip', limits)).toThrow(/Could not read zip/);
  });
});

describe('tar', () => {
  it('extracts ustar files', () => {
    const tar = makeTar({ 'a/b.c': 'int main(){}', 'readme.md': '# hi' });
    const entries = extractArchive('tar', tar, 'x.tar', limits);
    expect(entries.map((e) => [e.path, text(e.data)])).toEqual([
      ['a/b.c', 'int main(){}'],
      ['readme.md', '# hi'],
    ]);
  });

  it('handles GNU long names and pax paths', () => {
    const long = `${'d'.repeat(60)}/${'f'.repeat(60)}.py`;
    expect(extractArchive('tar', makeTar({ [long]: 'x' }), 'l.tar', limits)[0]!.path).toBe(long);
    expect(extractArchive('tar', makeTar({ [long]: 'x' }, { pax: true }), 'p.tar', limits)[0]!.path).toBe(long);
  });

  it('extracts .tar.gz and plain .gz', () => {
    const tgz = gzipSync(makeTar({ 'src/x.v': 'module x; endmodule' }));
    expect(extractArchive('tgz', tgz, 'x.tgz', limits)[0]!.path).toBe('src/x.v');
    const gz = gzipSync(strToU8('hello'));
    const [entry] = extractArchive('gz', gz, 'notes.txt.gz', limits);
    expect(entry!.path).toBe('notes.txt');
    expect(text(entry!.data)).toBe('hello');
  });

  it('rejects oversized gzip before inflating', () => {
    const gz = gzipSync(new Uint8Array(2 * 1024 * 1024));
    expect(() => extractArchive('gz', gz, 'big.gz', { ...limits, maxTotalBytes: 1024 })).toThrow(ArchiveLimitError);
  });
});

describe('sanitizePath', () => {
  it('removes traversal and leading slashes', () => {
    expect(sanitizePath('/../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizePath('a\\b\\.\\c.txt')).toBe('a/b/c.txt');
  });
});
