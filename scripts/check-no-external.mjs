// FERPA guard: fail if a built extension contains any absolute URL that isn't on the
// reviewed allowlist below. Every allowed entry is an identifier or text in a library,
// not something the extension connects to. (The extension-page CSP's connect-src 'self'
// enforces this at runtime too; this check catches new endpoints at review time.)
//   node scripts/check-no-external.mjs [build-dir ...]   (default: every dir in .output)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ALLOWED = [
  // XML namespaces (used as identifiers, never fetched)
  /^http:\/\/www\.w3\.org\//,
  /^http:\/\/www\.xfa\.org\/schema\//,
  /^http:\/\/ns\.adobe\.com\//,
  // Office Open XML namespaces and relationship types (docx-preview)
  /^http:\/\/schemas\.openxmlformats\.org\//,
  /^http:\/\/schemas\.microsoft\.com\/office\//,
  // docx-preview's base for resolving paths inside the .docx with new URL()
  /^http:\/\/docx\/$/,
  // Links inside library error messages, license headers, and doc examples
  /^https:\/\/github\.com\/(markedjs\/marked|highlightjs\/highlight\.js)\b/,
  /^https:\/\/stuk\.github\.io\/jszip\/documentation\//,
  /^https:\/\/rolldown\.rs\/in-depth\/bundling-cjs\b/,
  /^http:\/\/www\.apache\.org\/licenses\//,
  /^https?:\/\/(example\.com|foo\.bar)\b/,
];

const SCANNED = new Set(['.js', '.mjs', '.html', '.css', '.json']);
const URL_RE = /https?:\/\/[a-zA-Z0-9.-]+[^\s"'`)<>\\]*/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (SCANNED.has(path.extname(name))) yield full;
  }
}

const dirs = process.argv.slice(2);
if (!dirs.length) {
  for (const name of readdirSync('.output')) {
    if (statSync(path.join('.output', name)).isDirectory()) dirs.push(path.join('.output', name));
  }
}

let failures = 0;
for (const dir of dirs) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const match of new Set(text.match(URL_RE) ?? [])) {
      if (ALLOWED.some((re) => re.test(match))) continue;
      console.error(`${file}: unreviewed URL ${match}`);
      failures++;
    }
  }
}

if (failures) {
  console.error(`\n${failures} unreviewed URL(s). Student data must never leave the browser: remove the URL, or, if it is`);
  console.error('provably not contacted (e.g. an XML namespace), add it to ALLOWED in scripts/check-no-external.mjs.');
  process.exit(1);
}
console.log(`No external URLs in ${dirs.join(', ')}`);
