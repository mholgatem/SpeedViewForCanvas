import type { ArchiveEntry, ArchiveLimits } from './types';
import { ArchiveLimitError } from './types';

const BLOCK = 512;
const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

function readString(bytes: Uint8Array, offset: number, length: number): string {
  const field = bytes.subarray(offset, offset + length);
  const end = field.indexOf(0);
  const slice = end === -1 ? field : field.subarray(0, end);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(slice);
  } catch {
    return latin1.decode(slice);
  }
}

function readSize(bytes: Uint8Array, offset: number): number {
  // GNU base-256 encoding for large files: high bit of first byte set.
  if (bytes[offset]! & 0x80) {
    let value = bytes[offset]! & 0x7f;
    for (let i = 1; i < 12; i++) value = value * 256 + bytes[offset + i]!;
    return value;
  }
  const text = readString(bytes, offset, 12).trim();
  return text ? parseInt(text, 8) : 0;
}

function isZeroBlock(bytes: Uint8Array, offset: number): boolean {
  for (let i = offset; i < offset + BLOCK; i++) if (bytes[i] !== 0) return false;
  return true;
}

/** Parse "len key=value\n" records from a pax extended header. */
function parsePax(data: Uint8Array): Record<string, string> {
  const text = utf8.decode(data);
  const records: Record<string, string> = {};
  let pos = 0;
  while (pos < text.length) {
    const space = text.indexOf(' ', pos);
    if (space === -1) break;
    const len = parseInt(text.slice(pos, space), 10);
    if (!len) break;
    const record = text.slice(space + 1, pos + len - 1);
    const eq = record.indexOf('=');
    if (eq > 0) records[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return records;
}

/** Extract regular files from a tar archive (ustar, GNU long names, pax paths). */
export function parseTar(bytes: Uint8Array, limits: ArchiveLimits): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let total = 0;
  let pendingName: string | null = null;
  let offset = 0;

  while (offset + BLOCK <= bytes.length) {
    if (isZeroBlock(bytes, offset)) break;
    const headerStart = offset;
    const size = readSize(bytes, headerStart + 124);
    const type = String.fromCharCode(bytes[headerStart + 156] ?? 0);
    const dataStart = headerStart + BLOCK;
    const data = bytes.subarray(dataStart, dataStart + size);
    if (data.length < size) throw new Error('Tar archive is truncated');
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {
      pendingName = readString(data, 0, data.length);
      continue;
    }
    if (type === 'x') {
      pendingName = parsePax(data).path ?? pendingName;
      continue;
    }
    if (type === 'g') continue;

    let name = readString(bytes, headerStart, 100);
    if (readString(bytes, headerStart + 257, 5) === 'ustar') {
      const prefix = readString(bytes, headerStart + 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    if (pendingName) name = pendingName;
    pendingName = null;

    if (type !== '0' && type !== '\0' && type !== '7') continue; // dirs, links, devices
    if (entries.length >= limits.maxEntries) throw new ArchiveLimitError(`more than ${limits.maxEntries} files`);
    total += size;
    if (total > limits.maxTotalBytes) throw new ArchiveLimitError('unpacked size limit exceeded');
    entries.push({ path: name, size, data });
  }
  return entries;
}
