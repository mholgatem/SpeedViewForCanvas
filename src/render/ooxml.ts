import { unzipSync } from 'fflate';

/**
 * Helpers shared by the Office Open XML readers (Excel and PowerPoint): unzipping only
 * the parts needed within a size limit, namespace-agnostic element lookups, and
 * relationship (.rels) resolution.
 */

export type Parts = Record<string, Uint8Array>;

export interface Relationship {
  target: string;
  type: string;
  external: boolean;
}

/**
 * Decompress the parts whose names match `keep`, failing once their expanded size passes
 * `maxTotalBytes` (zip-bomb guard; the limit comes from the archive settings).
 */
export function unzipParts(bytes: Uint8Array, maxTotalBytes: number, keep: RegExp): Parts {
  let total = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      if (!keep.test(file.name)) return false;
      total += file.originalSize;
      if (total > maxTotalBytes) throw new Error(`it expands to more than ${Math.round(maxTotalBytes / 1048576)} MB (the archive size limit in settings)`);
      return true;
    },
  });
}

const decoder = new TextDecoder();
export const decode = (bytes: Uint8Array) => decoder.decode(bytes);

export function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('the file’s XML is malformed');
  return doc;
}

export const all = (node: Document | Element, name: string) => [...node.getElementsByTagNameNS('*', name)];
export const first = (node: Document | Element, name: string) => node.getElementsByTagNameNS('*', name)[0] ?? null;
export const kids = (node: Element, name: string) => [...node.children].filter((c) => c.localName === name);
export const kid = (node: Element, name: string) => [...node.children].find((c) => c.localName === name) ?? null;

/** Attribute by local name, ignoring namespace prefixes (r:id etc.). */
export function attr(node: Element | null, name: string): string | null {
  if (!node) return null;
  if (node.hasAttribute(name)) return node.getAttribute(name);
  for (const a of node.attributes) if (a.localName === name) return a.value;
  return null;
}

/**
 * The r:id attribute, for elements that also have a plain id (p:sldId). Matches any
 * namespace, since Strict-format files use a different one for relationships.
 */
export function relId(node: Element | null): string | null {
  if (!node) return null;
  for (const a of node.attributes) if (a.localName === 'id' && a.namespaceURI) return a.value;
  return attr(node, 'id');
}

export const flag = (node: Element | null, name: string, fallback = false) => {
  const value = attr(node, name);
  return value === null ? fallback : value !== '0' && value !== 'false';
};

export function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

/** Relationships of a part, by id, with internal targets resolved to part paths. */
export function relsFor(files: Parts, part: string): Map<string, Relationship> {
  const slash = part.lastIndexOf('/');
  const relsPath = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
  const map = new Map<string, Relationship>();
  const bytes = files[relsPath];
  if (!bytes) return map;
  for (const rel of all(parseXml(decode(bytes)), 'Relationship')) {
    const external = attr(rel, 'TargetMode') === 'External';
    const target = attr(rel, 'Target') ?? '';
    map.set(attr(rel, 'Id') ?? '', { target: external ? target : resolvePath(part, target), type: attr(rel, 'Type') ?? '', external });
  }
  return map;
}
