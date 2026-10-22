import { gunzipSync, unzipSync } from 'fflate';
import { baseName, sniffArchive, type ArchiveFormat } from '../render/detect';
import { parseTar } from './tar';
import { ArchiveLimitError, type ArchiveEntry, type ArchiveLimits } from './types';

export { ArchiveLimitError, type ArchiveEntry, type ArchiveLimits } from './types';

/** OS metadata that clutters student zips. */
const JUNK_RE = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

/** Normalize an entry path for display: no leading slash, no "." or ".." segments, forward slashes. */
export function sanitizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function unzip(bytes: Uint8Array, limits: ArchiveLimits): ArchiveEntry[] {
  let count = 0;
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        if (file.name.endsWith('/') || JUNK_RE.test(file.name)) return false;
        if (++count > limits.maxEntries) throw new ArchiveLimitError(`more than ${limits.maxEntries} files`);
        total += file.originalSize;
        if (total > limits.maxTotalBytes) throw new ArchiveLimitError('unpacked size limit exceeded');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ArchiveLimitError) throw err;
    throw new Error(`Could not read zip (it may be encrypted or damaged): ${(err as Error).message}`);
  }
  return Object.entries(files).map(([path, data]) => ({ path, size: data.length, data }));
}

function gunzip(bytes: Uint8Array, limits: ArchiveLimits): Uint8Array {
  // ISIZE (last 4 bytes) is the uncompressed size mod 2^32; check it before inflating.
  const n = bytes.length;
  const declared = n >= 4 ? (bytes[n - 4]! | (bytes[n - 3]! << 8) | (bytes[n - 2]! << 16) | (bytes[n - 1]! << 24)) >>> 0 : 0;
  if (declared > limits.maxTotalBytes) throw new ArchiveLimitError('unpacked size limit exceeded');
  const out = gunzipSync(bytes);
  if (out.length > limits.maxTotalBytes) throw new ArchiveLimitError('unpacked size limit exceeded');
  return out;
}

/** Extract every regular file from an archive. Junk OS files are skipped. */
export function extractArchive(
  format: ArchiveFormat,
  bytes: Uint8Array,
  archiveName: string,
  limits: ArchiveLimits,
): ArchiveEntry[] {
  let entries: ArchiveEntry[];
  switch (format) {
    case 'zip':
      entries = unzip(bytes, limits);
      break;
    case 'tar':
      entries = parseTar(bytes, limits);
      break;
    case 'tgz':
      entries = parseTar(gunzip(bytes, limits), limits);
      break;
    case 'gz': {
      const inner = gunzip(bytes, limits);
      if (sniffArchive(inner) === 'tar') entries = parseTar(inner, limits);
      else entries = [{ path: baseName(archiveName).replace(/\.gz$/i, '') || 'file', size: inner.length, data: inner }];
      break;
    }
  }
  return entries
    .map((entry) => ({ ...entry, path: sanitizePath(entry.path) }))
    .filter((entry) => entry.path && !JUNK_RE.test(entry.path));
}
