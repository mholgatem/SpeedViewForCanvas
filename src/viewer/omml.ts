/**
 * Converts Office Math (OMML, as found in PowerPoint equations) to MathML, which
 * browsers render natively. Only fixed MathML element names are created and all
 * content goes in as text.
 */

const MATHML = 'http://www.w3.org/1998/Math/MathML';

function mk(name: string, ...children: (Node | null)[]): Element {
  const node = document.createElementNS(MATHML, name);
  for (const child of children) if (child) node.append(child);
  return node;
}

function token(name: 'mi' | 'mn' | 'mo' | 'mtext', text: string): Element {
  const node = document.createElementNS(MATHML, name);
  node.textContent = text;
  return node;
}

const kid = (node: Element | null, name: string) => (node ? [...node.children].find((c) => c.localName === name) ?? null : null);
const kidsNamed = (node: Element, name: string) => [...node.children].filter((c) => c.localName === name);
const prop = (node: Element, propsName: string, name: string) => {
  const el = kid(kid(node, propsName), name);
  if (!el) return null;
  for (const a of el.attributes) if (a.localName === 'val') return a.value;
  return null;
};

/** A row of the converted children of an argument element (e, num, sub, ...). */
function row(node: Element | null, plain = false): Element {
  return mk('mrow', ...(node ? convertChildren(node, plain) : []));
}

function convertChildren(node: Element, plain = false): Element[] {
  return [...node.children].flatMap((child) => convert(child, plain));
}

/** Split run text into identifiers, numbers, and operators. */
function runTokens(text: string, plain: boolean): Element[] {
  if (plain) return text.trim() ? [token('mi', text)] : [];
  const out: Element[] = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)|(\p{L})|(\s+)|(.)/gu)) {
    if (m[1]) out.push(token('mn', m[1]));
    else if (m[2]) out.push(token('mi', m[2]));
    else if (m[4]) out.push(token('mo', m[4]));
  }
  return out;
}

function convert(el: Element, plain: boolean): Element[] {
  switch (el.localName) {
    case 'r': {
      const text = kidsNamed(el, 't').map((t) => t.textContent ?? '').join('');
      if (kid(kid(el, 'rPr'), 'nor')) return [token('mtext', text)];
      return runTokens(text, plain);
    }
    case 'f': {
      const type = prop(el, 'fPr', 'type');
      const num = row(kid(el, 'num'));
      const den = row(kid(el, 'den'));
      if (type === 'lin') return [mk('mrow', num, token('mo', '/'), den)];
      const frac = mk('mfrac', num, den);
      if (type === 'noBar') frac.setAttribute('linethickness', '0');
      return [frac];
    }
    case 'sSup':
      return [mk('msup', row(kid(el, 'e')), row(kid(el, 'sup')))];
    case 'sSub':
      return [mk('msub', row(kid(el, 'e')), row(kid(el, 'sub')))];
    case 'sSubSup':
      return [mk('msubsup', row(kid(el, 'e')), row(kid(el, 'sub')), row(kid(el, 'sup')))];
    case 'sPre':
      return [mk('mmultiscripts', row(kid(el, 'e')), mk('mprescripts'), row(kid(el, 'sub')), row(kid(el, 'sup')))];
    case 'rad': {
      const deg = kid(el, 'deg');
      const hidden = prop(el, 'radPr', 'degHide');
      if (!deg || !deg.children.length || (hidden && hidden !== '0' && hidden !== 'off')) return [mk('msqrt', row(kid(el, 'e')))];
      return [mk('mroot', row(kid(el, 'e')), row(deg))];
    }
    case 'nary': {
      const op = token('mo', prop(el, 'naryPr', 'chr') ?? '∫');
      op.setAttribute('largeop', 'true');
      const sub = kid(el, 'sub');
      const sup = kid(el, 'sup');
      const under = prop(el, 'naryPr', 'limLoc') === 'undOvr';
      const hasSub = !!sub?.children.length;
      const hasSup = !!sup?.children.length;
      let base: Element = op;
      if (hasSub && hasSup) base = mk(under ? 'munderover' : 'msubsup', op, row(sub), row(sup));
      else if (hasSub) base = mk(under ? 'munder' : 'msub', op, row(sub));
      else if (hasSup) base = mk(under ? 'mover' : 'msup', op, row(sup));
      return [mk('mrow', base, row(kid(el, 'e')))];
    }
    case 'd': {
      const begin = prop(el, 'dPr', 'begChr') ?? '(';
      const end = prop(el, 'dPr', 'endChr') ?? ')';
      const sep = prop(el, 'dPr', 'sepChr') ?? '|';
      const parts: Element[] = [];
      kidsNamed(el, 'e').forEach((e, i) => {
        if (i) parts.push(token('mo', sep));
        parts.push(row(e));
      });
      return [mk('mrow', begin ? token('mo', begin) : null, ...parts, end ? token('mo', end) : null)];
    }
    case 'func':
      return [mk('mrow', row(kid(el, 'fName'), true), token('mo', '⁡'), row(kid(el, 'e')))];
    case 'limLow':
      return [mk('munder', row(kid(el, 'e')), row(kid(el, 'lim')))];
    case 'limUpp':
      return [mk('mover', row(kid(el, 'e')), row(kid(el, 'lim')))];
    case 'acc': {
      const accent = mk('mover', row(kid(el, 'e')), token('mo', prop(el, 'accPr', 'chr') ?? '̂'));
      accent.setAttribute('accent', 'true');
      return [accent];
    }
    case 'bar':
      return prop(el, 'barPr', 'pos') === 'top'
        ? [mk('mover', row(kid(el, 'e')), token('mo', '¯'))]
        : [mk('munder', row(kid(el, 'e')), token('mo', '_'))];
    case 'groupChr': {
      const chr = token('mo', prop(el, 'groupChrPr', 'chr') ?? '⏟');
      return prop(el, 'groupChrPr', 'pos') === 'top' ? [mk('mover', row(kid(el, 'e')), chr)] : [mk('munder', row(kid(el, 'e')), chr)];
    }
    case 'eqArr':
      return [mk('mtable', ...kidsNamed(el, 'e').map((e) => mk('mtr', mk('mtd', row(e)))))];
    case 'm':
      return [mk('mtable', ...kidsNamed(el, 'mr').map((r) => mk('mtr', ...kidsNamed(r, 'e').map((e) => mk('mtd', row(e))))))];
    case 'e':
    case 'num':
    case 'den':
    case 'sub':
    case 'sup':
    case 'deg':
    case 'lim':
    case 'fName':
    case 'box':
    case 'borderBox':
    case 'phant':
    case 'oMath':
      return [mk('mrow', ...convertChildren(el, plain))];
    default:
      // Property elements (rPr, ctrlPr, fPr, ...) carry no content.
      return [];
  }
}

export function ommlToMathml(oMath: Element): Element {
  return mk('math', ...convertChildren(oMath));
}
