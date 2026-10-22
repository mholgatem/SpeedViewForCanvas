/** Minimal tar writer for test fixtures. Supports GNU long names via 'L' entries. */
export function makeTar(files: Record<string, string | Uint8Array>, options: { pax?: boolean } = {}): Uint8Array {
  const blocks: Uint8Array[] = [];
  const enc = new TextEncoder();

  const header = (name: string, size: number, type: string) => {
    const h = new Uint8Array(512);
    h.set(enc.encode(name.slice(0, 100)), 0);
    h.set(enc.encode('0000644\0'), 100);
    h.set(enc.encode(size.toString(8).padStart(11, '0') + '\0'), 124);
    h.set(enc.encode('00000000000\0'), 136);
    h[156] = type.charCodeAt(0);
    h.set(enc.encode('ustar\0' + '00'), 257);
    h.fill(0x20, 148, 156);
    const sum = h.reduce((a, b) => a + b, 0);
    h.set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
    return h;
  };
  const data = (bytes: Uint8Array) => {
    const padded = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
    padded.set(bytes);
    return padded;
  };

  for (const [name, content] of Object.entries(files)) {
    const bytes = typeof content === 'string' ? enc.encode(content) : content;
    if (name.length > 100) {
      if (options.pax) {
        const body = (len: number) => `${len} path=${name}\n`;
        let len = body(0).length;
        while (body(len).length !== len) len = body(len).length;
        const pax = enc.encode(body(len));
        blocks.push(header('PaxHeader', pax.length, 'x'), data(pax));
      } else {
        const long = enc.encode(name + '\0');
        blocks.push(header('././@LongLink', long.length, 'L'), data(long));
      }
    }
    blocks.push(header(name, bytes.length, '0'), data(bytes));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}
