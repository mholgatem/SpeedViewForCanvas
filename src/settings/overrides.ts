/** Parse "ext = language" lines from the settings textarea. Line numbers in `invalidLines` are 1-based. */
export function parseLanguageOverrides(text: string): {
  overrides: Record<string, string>;
  invalidLines: number[];
} {
  const overrides: Record<string, string> = {};
  const invalidLines: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const match = /^\.?([\w+-]+)\s*[=:]\s*([\w+-]+)$/.exec(line);
    if (!match) {
      invalidLines.push(i + 1);
      return;
    }
    overrides[match[1]!.toLowerCase()] = match[2]!.toLowerCase();
  });
  return { overrides, invalidLines };
}

export function formatLanguageOverrides(overrides: Record<string, string>): string {
  return Object.entries(overrides)
    .map(([ext, lang]) => `${ext} = ${lang}`)
    .join('\n');
}
