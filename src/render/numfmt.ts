/**
 * Excel number formats (the "Format Cells" codes, e.g. `#,##0.00`, `0%`, `m/d/yyyy`,
 * `"$"#,##0_);[Red]("$"#,##0)`), applied to numeric cell values the way Excel displays
 * them. Covers sections, colors, literals, grouping, scaling, percent, scientific, and
 * dates/times including elapsed time. Fractions and locale-specific calendars fall back
 * to General.
 */

export interface Formatted {
  text: string;
  /** CSS color from a [Red]-style section tag. */
  color?: string;
}

export const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  5: '"$"#,##0_);\\("$"#,##0\\)', 6: '"$"#,##0_);[Red]\\("$"#,##0\\)',
  7: '"$"#,##0.00_);\\("$"#,##0.00\\)', 8: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
  18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 48: '##0.0E+0', 49: '@',
};

const COLORS: Record<string, string> = {
  black: '#000000', blue: '#0000ff', cyan: '#00ffff', green: '#00ff00',
  magenta: '#ff00ff', red: '#ff0000', white: '#ffffff', yellow: '#ffff00',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Excel's General format: up to ~11 characters, switching to scientific when needed. */
export function formatGeneral(value: number): string {
  if (!Number.isFinite(value)) return '#NUM!';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const intDigits = Math.floor(Math.log10(abs)) + 1;
  if (abs >= 1e11 || abs < 1e-9 || (intDigits < -3 && abs.toPrecision(6).length > 11)) return scientificGeneral(value);
  const decimals = Math.max(0, intDigits >= 1 ? 10 - intDigits : 9);
  const text = trimZeros(abs.toFixed(decimals));
  if (text === '0') return scientificGeneral(value);
  return (value < 0 ? '-' : '') + text;
}

function scientificGeneral(value: number): string {
  const [mantissa, exp] = value.toExponential(5).split('e') as [string, string];
  const sign = exp.startsWith('-') ? '-' : '+';
  return `${trimZeros(mantissa)}E${sign}${exp.replace(/^[-+]/, '').padStart(2, '0')}`;
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** Split a format code into its ;-separated sections, respecting quotes and escapes. */
function splitSections(code: string): string[] {
  const sections: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === '\\' && !quoted) {
      current += ch + (code[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    if (ch === ';' && !quoted) {
      sections.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  sections.push(current);
  return sections;
}

const CONDITION = /\[(<=|>=|<>|<|>|=)\s*(-?\d+(?:\.\d+)?)\]/;

function conditionHolds(value: number, op: string, limit: number): boolean {
  switch (op) {
    case '<': return value < limit;
    case '<=': return value <= limit;
    case '>': return value > limit;
    case '>=': return value >= limit;
    case '=': return value === limit;
    default: return value !== limit;
  }
}

/** Pick the section for a value; `signShown` means the section itself shows the sign. */
function pickSection(sections: string[], value: number): { section: string; signShown: boolean } {
  const conditional = sections.map((s) => CONDITION.exec(s));
  if (conditional.some(Boolean)) {
    const index = conditional.findIndex((c) => c && conditionHolds(value, c[1]!, Number(c[2])));
    if (index >= 0) return { section: sections[index]!, signShown: index > 0 };
    const fallback = sections.findIndex((s, i) => !conditional[i]);
    return { section: sections[fallback >= 0 ? fallback : sections.length - 1]!, signShown: fallback > 0 };
  }
  if (value < 0 && sections.length >= 2 && sections[1] !== '') return { section: sections[1]!, signShown: true };
  if (value === 0 && sections.length >= 3 && sections[2] !== '') return { section: sections[2]!, signShown: false };
  return { section: sections[0]!, signShown: false };
}

type Token = { lit: string } | { ph: string };

/**
 * Turn one section into tokens: literals (quoted text, escapes, padding, plain
 * characters) and placeholders. Bracket tags are handled before this.
 */
function tokenize(section: string, placeholders: RegExp): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < section.length; i++) {
    const ch = section[i]!;
    if (ch === '"') {
      const end = section.indexOf('"', i + 1);
      tokens.push({ lit: section.slice(i + 1, end < 0 ? undefined : end) });
      i = end < 0 ? section.length : end;
    } else if (ch === '\\') {
      tokens.push({ lit: section[++i] ?? '' });
    } else if (ch === '_') {
      i++;
      tokens.push({ lit: ' ' });
    } else if (ch === '*') {
      i++;
    } else {
      const match = placeholders.exec(section.slice(i));
      if (match && match.index === 0) {
        tokens.push({ ph: match[0] });
        i += match[0].length - 1;
      } else {
        tokens.push({ lit: ch });
      }
    }
  }
  return tokens;
}

/** Remove bracket tags, returning the color and whether elapsed-time tags were present. */
function stripTags(section: string): { body: string; color?: string } {
  let color: string | undefined;
  const body = section.replace(/\[([^\]]*)\]/g, (whole, inner: string) => {
    const lower = inner.toLowerCase();
    if (COLORS[lower]) {
      color = COLORS[lower];
      return '';
    }
    if (/^(h+|m+|s+)$/i.test(inner)) return whole; // elapsed time, handled by the date formatter
    const currency = /^\$([^-]*)/.exec(inner);
    if (currency) return currency[1] ? `"${currency[1]}"` : '';
    return ''; // conditions, locale tags, [ColorN], etc.
  });
  return { body, color };
}

/** True when a format code shows numbers as dates or times. */
export function isDateCode(code: string): boolean {
  const { section } = pickSection(splitSections(code), 1);
  return isDateFormat(stripTags(section).body);
}

function isDateFormat(body: string): boolean {
  const bare = body.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/_.|\*./g, '');
  return /[ymdhs]/i.test(bare.replace(/\[(h+|m+|s+)\]/gi, 'h'));
}

export function formatNumber(value: number, code: string, date1904 = false): Formatted {
  if (!code || /^general$/i.test(code.trim())) return { text: formatGeneral(value) };
  const sections = splitSections(code);
  const { section, signShown } = pickSection(sections, value);
  const { body, color } = stripTags(section);
  if (/^@?$/.test(body.trim()) && !/[0#?]/.test(body)) return { text: formatGeneral(value), color };
  const text = isDateFormat(body) ? formatDate(value, body, date1904) : formatDigits(signShown ? Math.abs(value) : value, body);
  return { text, color };
}

// ---- Numbers ---------------------------------------------------------------------------

function formatDigits(value: number, body: string): string {
  if (/general/i.test(body)) {
    return body.replace(/"([^"]*)"/g, '$1').replace(/general/i, formatGeneral(Math.abs(value))).replace(/^/, value < 0 ? '-' : '');
  }
  if (/[0#?]\s*\/\s*[0-9#?]/.test(body)) return formatGeneral(value); // fractions
  const tokens = tokenize(body, /^(?:[Ee][+-]|[0#?.,%])/);
  const negative = value < 0;
  let abs = Math.abs(value);

  const percents = tokens.filter((t) => 'ph' in t && t.ph === '%').length;
  abs *= 100 ** percents;

  const expIndex = tokens.findIndex((t) => 'ph' in t && /^[Ee]/.test(t.ph));
  const mainEnd = expIndex >= 0 ? expIndex : tokens.length;
  const pointIndex = tokens.findIndex((t, i) => i < mainEnd && 'ph' in t && t.ph === '.');
  const intEnd = pointIndex >= 0 ? pointIndex : mainEnd;
  const isDigit = (t: Token) => 'ph' in t && /^[0#?]$/.test(t.ph);

  // Commas right after the last integer digit scale by 1000 each; others mean grouping.
  let lastIntDigit = -1;
  for (let i = 0; i < intEnd; i++) if (isDigit(tokens[i]!)) lastIntDigit = i;
  let grouping = false;
  for (let i = 0; i < intEnd; i++) {
    const t = tokens[i]!;
    if (!('ph' in t) || t.ph !== ',') continue;
    if (i > lastIntDigit) abs /= 1000;
    else grouping = true;
  }

  const fracPh = tokens.slice(pointIndex >= 0 ? pointIndex + 1 : mainEnd, mainEnd).filter(isDigit).map((t) => (t as { ph: string }).ph);
  const intPh = tokens.slice(0, intEnd).filter(isDigit).map((t) => (t as { ph: string }).ph);

  let exponent = 0;
  if (expIndex >= 0 && abs !== 0) {
    exponent = Math.floor(Math.log10(abs));
    // Engineering notation (e.g. ##0.0E+0): exponent is a multiple of the integer width.
    if (intPh.length > 1 && intPh.includes('#')) exponent = Math.floor(exponent / intPh.length) * intPh.length;
    abs /= 10 ** exponent;
    if (Number(abs.toFixed(fracPh.length)) >= 10 ** Math.max(1, intPh.length) && !(intPh.length > 1 && intPh.includes('#'))) {
      abs /= 10;
      exponent++;
    }
  }

  const fixed = abs.toFixed(fracPh.length);
  const [intDigitsRaw, fracDigitsRaw = ''] = fixed.split('.') as [string, string?];
  let intDigits = intDigitsRaw === '0' ? '' : intDigitsRaw;
  const roundedToZero = Number(fixed) === 0;

  // Fraction: drop trailing zeros held by # and pad ? with spaces.
  const frac = fracDigitsRaw.split('');
  for (let i = frac.length - 1; i >= 0 && frac[i] === '0' && fracPh[i] !== '0'; i--) frac[i] = fracPh[i] === '?' ? ' ' : '';

  const minInt = intPh.filter((p) => p === '0').length;
  if (intDigits.length < minInt) intDigits = intDigits.padStart(minInt, '0');
  if (grouping) intDigits = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // Fill integer placeholders from the right; extra digits go to the leftmost one.
  let out = '';
  const intTokens = tokens.slice(0, intEnd);
  const digitSlots = intTokens.map((t, i) => (isDigit(t) ? i : -1)).filter((i) => i >= 0);
  const assigned = new Map<number, string>();
  if (grouping) {
    if (digitSlots.length) assigned.set(digitSlots[0]!, intDigits);
  } else {
    let remaining = intDigits;
    for (let k = digitSlots.length - 1; k >= 0; k--) {
      const slot = digitSlots[k]!;
      const ph = (intTokens[slot] as { ph: string }).ph;
      if (k === 0) assigned.set(slot, remaining || (ph === '?' ? ' ' : ''));
      else {
        assigned.set(slot, remaining ? remaining.slice(-1) : ph === '?' ? ' ' : '');
        remaining = remaining.slice(0, -1);
      }
    }
  }
  intTokens.forEach((t, i) => {
    if ('lit' in t) out += t.lit;
    else if (t.ph === '%') out += '%';
    else if (assigned.has(i)) out += assigned.get(i);
  });

  if (pointIndex >= 0) {
    out += '.';
    let f = 0;
    for (const t of tokens.slice(pointIndex + 1, mainEnd)) {
      if ('lit' in t) out += t.lit;
      else if (t.ph === '%') out += '%';
      else if (isDigit(t)) out += frac[f++] ?? '';
    }
  }

  if (expIndex >= 0) {
    const expTokens = tokens.slice(expIndex + 1);
    const expPh = expTokens.filter(isDigit).length;
    const sign = exponent < 0 ? '-' : (tokens[expIndex] as { ph: string }).ph.endsWith('+') ? '+' : '';
    out += (tokens[expIndex] as { ph: string }).ph[0]! + sign + String(Math.abs(exponent)).padStart(expPh, '0');
    for (const t of expTokens) if ('lit' in t) out += t.lit;
  }

  return (negative && !roundedToZero ? '-' : '') + out;
}

// ---- Dates and times ---------------------------------------------------------------------

function formatDate(serial: number, body: string, date1904: boolean): string {
  const tokens = tokenize(body, /^(?:\[(?:h+|m+|s+)\]|AM\/PM|am\/pm|A\/P|a\/p|y+|Y+|m+|M+|d+|D+|h+|H+|s+|S+|\.0+)/);
  const fracDigits = Math.max(0, ...tokens.map((t) => ('ph' in t && t.ph.startsWith('.') ? t.ph.length - 1 : 0)));
  const twelveHour = tokens.some((t) => 'ph' in t && /^(AM\/PM|A\/P)$/i.test(t.ph));

  // Excel's 1900 system counts a nonexistent Feb 29, 1900 (serial 60).
  let days = Math.floor(serial);
  const scale = 86400 * 10 ** fracDigits;
  let ticks = Math.round((serial - days) * scale);
  if (ticks >= scale) {
    days++;
    ticks -= scale;
  }
  if (!date1904 && days < 61 && days > 0) days++;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + days * 86400000);
  const seconds = Math.floor(ticks / 10 ** fracDigits);
  const subsecond = ticks % 10 ** fracDigits;
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor(seconds / 60) % 60;
  const second = seconds % 60;
  const totalSeconds = Math.round(serial * 86400);

  const kinds = tokens.map((t) => ('ph' in t ? t.ph.toLowerCase() : null));
  const isMinute = (i: number) => {
    for (let j = i - 1; j >= 0; j--) {
      const k = kinds[j];
      if (!k || k.startsWith('.')) continue;
      if (k.startsWith('h') || k.startsWith('[h')) return true;
      break;
    }
    for (let j = i + 1; j < kinds.length; j++) {
      const k = kinds[j];
      if (!k || k.startsWith('.')) continue;
      return k.startsWith('s') || k.startsWith('[s');
    }
    return false;
  };

  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return tokens
    .map((t, i) => {
      if ('lit' in t) return t.lit;
      const p = t.ph;
      const k = p.toLowerCase();
      if (k.startsWith('[h')) return pad(Math.floor(totalSeconds / 3600), k.length - 2);
      if (k.startsWith('[m')) return pad(Math.floor(totalSeconds / 60), k.length - 2);
      if (k.startsWith('[s')) return pad(totalSeconds, k.length - 2);
      if (k === 'am/pm') return hour < 12 ? 'AM' : 'PM';
      if (k === 'a/p') return hour < 12 ? 'A' : 'P';
      if (k.startsWith('.')) return '.' + pad(subsecond, k.length - 1);
      if (k[0] === 'y') return k.length <= 2 ? pad(date.getUTCFullYear() % 100, 2) : String(date.getUTCFullYear());
      if (k[0] === 'd') {
        if (k.length >= 4) return DAYS[date.getUTCDay()]!;
        if (k.length === 3) return DAYS[date.getUTCDay()]!.slice(0, 3);
        return pad(date.getUTCDate(), k.length);
      }
      if (k[0] === 'h') {
        const h = twelveHour ? hour % 12 || 12 : hour;
        return pad(h, Math.min(2, k.length));
      }
      if (k[0] === 's') return pad(second, Math.min(2, k.length));
      if (k[0] === 'm') {
        if (k.length <= 2 && isMinute(i)) return pad(minute, k.length);
        const month = date.getUTCMonth();
        if (k.length >= 5) return MONTHS[month]![0]!;
        if (k.length === 4) return MONTHS[month]!;
        if (k.length === 3) return MONTHS[month]!.slice(0, 3);
        return pad(month + 1, k.length);
      }
      return p;
    })
    .join('');
}
