export interface CsvResult {
  rows: string[][];
  /** True if parsing stopped at maxRows. */
  truncated: boolean;
}

/** RFC 4180 parser: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string, delimiter = ',', maxRows = 1000): CsvResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') inQuotes = false;
      else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      if (rows.length >= maxRows) return { rows, truncated: i + 1 < text.length };
    } else field += ch;
    i++;
  }
  if (field !== '' || row.length) pushRow();
  return { rows, truncated: false };
}
