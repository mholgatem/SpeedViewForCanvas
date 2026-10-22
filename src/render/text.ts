export interface DecodedText {
  text: string;
  encoding: string;
}

const SNIFF_BYTES = 8192;

/**
 * Decode bytes as text, or return null if the data looks binary.
 * Order: BOM (UTF-8/UTF-16) -> strict UTF-8 -> windows-1252.
 */
export function decodeText(bytes: Uint8Array): DecodedText | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8 (BOM)' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16LE' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16BE' };
  }
  if (looksBinary(bytes)) return null;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' };
  }
}

/** NUL bytes or a high share of control characters in the first 8 KB means binary. */
export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, SNIFF_BYTES);
  let control = 0;
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) control++;
  }
  return sample.length > 0 && control / sample.length > 0.1;
}
