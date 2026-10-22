import { gzipSync, strToU8, zipSync } from 'fflate';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeDocx } from '../helpers/docx';
import { makeTar } from '../helpers/tar';
import { makePptx } from '../helpers/pptx';
import { makeXlsx } from '../helpers/xlsx';
import { COUNTER_GTKW, COUNTER_VCD } from '../helpers/vcd';

/**
 * Fake Canvas for e2e tests. The SpeedGrader page and API are served from
 * http://localhost:PORT; file downloads redirect to http://127.0.0.1:PORT (a different
 * origin, with CORS) to mimic Canvas redirecting to its file-storage CDN.
 */

const notebook = JSON.stringify({
  nbformat: 4,
  metadata: { kernelspec: { language: 'python' } },
  cells: [
    { cell_type: 'markdown', source: '# Analysis' },
    { cell_type: 'code', execution_count: 1, source: 'print(42)', outputs: [{ output_type: 'stream', name: 'stdout', text: '42\n' }] },
  ],
});

const pdf = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
  '4 0 obj<</Length 44>>stream',
  'BT /F1 24 Tf 40 70 Td (Hello PDF) Tj ET',
  'endstream endobj',
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
].join('\n');

const innerTgz = gzipSync(makeTar({ 'docs/notes.md': '# Notes\n\nSome **bold** text.' }));

export const FILES: Record<string, { name: string; data: Uint8Array }> = {
  '10': { name: 'hello.py', data: strToU8('def greet(name):\n    """Say hi."""\n    return f"hi {name}"\n') },
  '11': { name: 'counter.v', data: strToU8('module counter(input clk, output reg [3:0] q);\n  always @(posedge clk) q <= q + 1;\nendmodule\n') },
  '12': {
    name: 'project.zip',
    data: zipSync({
      'project/src/main.c': strToU8('#include <stdio.h>\nint main(void) { return 0; }\n'),
      'project/inner.tar.gz': innerTgz,
      'project/lab-report.docx': makeDocx(),
      'project/grades.xlsx': makeXlsx(),
      'project/talk.pptx': makePptx(),
    }),
  },
  '13': { name: 'analysis.ipynb', data: strToU8(notebook) },
  '14': { name: 'data.csv', data: strToU8('name,score\nalice,90\nbob,85\n') },
  '15': { name: 'program.bin', data: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 3]) },
  '16': { name: 'report.pdf', data: strToU8(pdf) },
  '17': {
    name: 'waves.zip',
    data: zipSync({ 'lab4/counter.vcd': strToU8(COUNTER_VCD), 'lab4/counter.gtkw': strToU8(COUNTER_GTKW) }),
  },
  '20': { name: 'solo.py', data: strToU8('x = 1\n') },
  '30': { name: 'lab4_dump.vcd', data: strToU8(COUNTER_VCD.replace(/module tb/, 'module testbench')) },
};

const SUBMISSIONS: Record<string, string[]> = {
  '3': ['10', '11', '12', '13', '14', '15', '16', '17'],
  '4': ['20'],
  '5': ['30'],
};

function speedGraderHtml(): string {
  return `<!doctype html><html><head><title>SpeedGrader</title><style>
    body { margin: 0; font-family: sans-serif; display: flex; height: 100vh; }
    #left_side { flex: 1; background: #eee; } #right_side { width: 320px; padding: 12px; }
  </style></head><body>
    <div id="left_side">Preview not available. Download the file.</div>
    <div id="right_side">
      <label>Grade <input id="grading-box" /></label>
      <button id="next-student" onclick="history.pushState({}, '', location.pathname + '?assignment_id=2&student_id=4')">Next</button>
      <button id="student-5" onclick="history.pushState({}, '', location.pathname + '?assignment_id=2&student_id=5')">Student 5</button>
    </div>
  </body></html>`;
}

export async function startServer(listenPort = 0): Promise<{ origin: string; storageOrigin: string; close(): Promise<void> }> {
  let port = 0;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pageOrigin = `http://localhost:${port}`;

    if (url.pathname === '/courses/1/gradebook/speed_grader') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(speedGraderHtml());
      return;
    }
    if (url.pathname === '/api/v1/courses/1' || url.pathname === '/api/v1/courses/1/assignments/2') {
      const name = url.pathname.endsWith('/2') ? 'Lab 4: Counters' : 'EEE 120: Digital Design';
      res.writeHead(200, { 'content-type': 'application/json' }).end(`while(1);${JSON.stringify({ id: 1, name })}`);
      return;
    }
    const api = /^\/api\/v1\/courses\/1\/assignments\/2\/submissions\/(\d+)$/.exec(url.pathname);
    if (api) {
      const ids = SUBMISSIONS[api[1]!] ?? [];
      const attachments = ids.map((id) => ({
        id: Number(id),
        display_name: FILES[id]!.name,
        size: FILES[id]!.data.length,
        'content-type': 'application/octet-stream',
        url: `${pageOrigin}/files/${id}/download?verifier=abc`,
      }));
      const body = { attempt: 1, submission_history: [{ attempt: 1, submitted_at: '2026-10-01T12:00:00Z', attachments }] };
      res.writeHead(200, { 'content-type': 'application/json' }).end(`while(1);${JSON.stringify(body)}`);
      return;
    }
    const download = /^\/files\/(\d+)\/download$/.exec(url.pathname);
    if (download) {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/storage/${download[1]}` }).end();
      return;
    }
    const storage = /^\/storage\/(\d+)$/.exec(url.pathname);
    if (storage && FILES[storage[1]!]) {
      res
        .writeHead(200, { 'content-type': 'application/octet-stream', 'access-control-allow-origin': pageOrigin })
        .end(Buffer.from(FILES[storage[1]!]!.data));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(listenPort, '0.0.0.0', resolve));
  port = (server.address() as AddressInfo).port;
  return {
    origin: `http://localhost:${port}`,
    storageOrigin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
