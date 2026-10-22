import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'wxt';
import type { ResolvedPublicFile } from 'wxt';

/** Copy the pdf.js worker and data files into the extension (served as /pdfjs/...). */
function addPdfJsAssets(files: ResolvedPublicFile[]) {
  const root = path.resolve('node_modules/pdfjs-dist');
  const add = (src: string, dest = src) => files.push({ absoluteSrc: path.join(root, src), relativeDest: `pdfjs/${dest}` });
  add('build/pdf.worker.min.mjs', 'pdf.worker.min.mjs');
  add('LICENSE');
  for (const dir of ['cmaps', 'standard_fonts', 'iccs']) {
    for (const file of fs.readdirSync(path.join(root, dir))) add(`${dir}/${file}`);
  }
  // JS image decoders; the .wasm versions would need 'wasm-unsafe-eval' in the CSP.
  for (const file of ['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js', 'LICENSE_OPENJPEG', 'LICENSE_JBIG2']) {
    add(`wasm/${file}`);
  }
}

/**
 * Extension-page CSP. Besides blocking remote code, connect-src 'self' means the viewer,
 * settings page, and background can never send data to any server, and img-src only allows
 * inline data (rendered submissions can't load remote images or trackers).
 * Dev mode keeps WXT's default so hot reload can reach the local dev server.
 */
const EXTENSION_PAGES_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "frame-src 'none'",
  "connect-src 'self'",
  "font-src 'self'",
].join('; ');

/**
 * E2E test builds (SPEEDVIEW_E2E=1) go to a separate folder and pre-grant localhost, since
 * Playwright can't click the browser's permission prompt. Never set for store builds.
 */
const E2E = !!process.env.SPEEDVIEW_E2E;

// No remote code, analytics, or third-party endpoints are allowed anywhere in this
// extension. Student submission data must never leave the browser (FERPA).
export default defineConfig({
  manifestVersion: 3,
  ...(E2E && { outDirTemplate: 'e2e-{{browser}}-mv{{manifestVersion}}' }),
  // Playwright output (screenshots of the fake Canvas) doesn't belong in the AMO source upload.
  zip: { excludeSources: ['test-results/**', 'playwright-report/**'] },
  hooks: {
    'build:publicAssets': (_wxt, files) => addPdfJsAssets(files),
  },
  manifest: ({ browser, command }) => ({
    ...(E2E && { host_permissions: ['http://localhost/*'] }),
    name: 'SpeedView for Canvas',
    description:
      'View code, notebooks, and archives directly in Canvas SpeedGrader. Everything stays in your browser.',
    // activeTab lets the toolbar popup read the current tab's URL ("Enable on this site").
    permissions: ['storage', 'scripting', 'activeTab'],
    // Custom Canvas domains (e.g. canvas.asu.edu) are requested at runtime from the
    // settings page, so the extension only gets access to sites the user approves.
    optional_host_permissions: ['https://*/*'],
    // The drawer iframes the viewer page into SpeedGrader.
    web_accessible_resources: [
      {
        resources: ['viewer.html'],
        matches: E2E ? ['https://*/*', 'http://localhost/*'] : ['https://*/*'],
      },
    ],
    commands: {
      'toggle-drawer': {
        suggested_key: { default: 'Alt+Shift+V' },
        description: 'Open or close the SpeedView drawer',
      },
    },
    ...(command === 'build' && {
      content_security_policy: { extension_pages: EXTENSION_PAGES_CSP },
    }),
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'speedview@mholgatem.github.io',
          strict_min_version: '128.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
