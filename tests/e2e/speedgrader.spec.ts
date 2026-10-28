import { chromium, expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import path from 'node:path';
import { startServer } from './server';

// Evaluated inside the extension's service worker, where the chrome.* API exists.
declare const chrome: {
  storage: { sync: { set(items: object): Promise<void> } };
  scripting: { getRegisteredContentScripts(): Promise<unknown[]> };
};

const EXTENSION_PATH = path.resolve('.output/e2e-chrome-mv3');

let server: Awaited<ReturnType<typeof startServer>>;
let context: BrowserContext;
const requests: string[] = [];

test.beforeAll(async () => {
  server = await startServer();
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  context.on('request', (req) => requests.push(req.url()));

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // Simulate the user adding the site in settings; the background then registers the content script.
  await worker.evaluate(() => chrome.storage.sync.set({ domains: ['http://localhost'], autoOpen: true }));
  await expect
    .poll(() => worker.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((s) => s.length)))
    .toBe(1);
});

test.afterAll(async () => {
  await context?.close();
  await server?.close();
});

async function openSpeedGrader(page: Page, student = '3'): Promise<Frame> {
  await page.goto(`${server.origin}/courses/1/gradebook/speed_grader?assignment_id=2&student_id=${student}`);
  await expect.poll(() => page.frames().some((f) => f.url().endsWith('/viewer.html'))).toBe(true);
  return page.frames().find((f) => f.url().endsWith('/viewer.html'))!;
}

const row = (viewer: Frame, name: string) => viewer.locator('.tree .node', { hasText: name }).first();

test('views code, archives, notebooks, csv, pdf, word, excel, and powerpoint without leaving the browser', async () => {
  const page = await context.newPage();
  const viewer = await openSpeedGrader(page);

  await expect(viewer.locator('.tree .node')).toHaveCount(8);

  await row(viewer, 'hello.py').click();
  await expect(viewer.locator('.code.language-python .hljs-keyword').first()).toHaveText('def');
  await expect(viewer.locator('#file-info')).toContainText('python');

  await row(viewer, 'counter.v').click();
  await expect(viewer.locator('.code.language-verilog .hljs-keyword').first()).toHaveText('module');

  await row(viewer, 'project.zip').click();
  await expect(row(viewer, 'main.c')).toBeVisible();
  await row(viewer, 'main.c').click();
  await expect(viewer.locator('.code.language-c')).toContainText('int main');

  await row(viewer, 'inner.tar.gz').click();
  await row(viewer, 'notes.md').click();
  await expect(viewer.locator('.markdown h1')).toHaveText('Notes');
  await viewer.locator('#mode').click();
  await expect(viewer.locator('.code.language-markdown')).toContainText('**bold**');

  await row(viewer, 'analysis.ipynb').click();
  await expect(viewer.locator('.notebook .markdown h1')).toHaveText('Analysis');
  await expect(viewer.locator('.notebook .stream-stdout')).toHaveText('42\n');

  await row(viewer, 'data.csv').click();
  await expect(viewer.locator('table.csv th').first()).toHaveText('name');
  await expect(viewer.locator('table.csv tbody tr')).toHaveCount(2);

  await row(viewer, 'program.bin').click();
  await expect(viewer.locator('.hex')).toContainText('7f 45 4c 46');

  // PDFs render with the bundled pdf.js (canvas + selectable text layer), not the browser viewer.
  await row(viewer, 'report.pdf').click();
  await expect(viewer.locator('.pdf-page canvas')).toHaveCount(1);
  await expect(viewer.locator('.pdf-page .textLayer')).toContainText('Hello PDF');
  await expect(viewer.locator('#file-info')).toContainText('1 page');
  const before = await viewer.locator('.pdf-page').evaluate((el) => el.getBoundingClientRect().width);
  await viewer.locator('#font-up').click();
  await expect
    .poll(() => viewer.locator('.pdf-page').evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(before);

  // Word documents inside archives render as pages, with equations as MathML. The
  // remotely linked image in the fixture must not be fetched (checked below).
  await row(viewer, 'lab-report.docx').click();
  const page1 = viewer.locator('.docx-view section.docx').first();
  await expect(page1).toContainText('Lab Report');
  await expect(page1.locator('table td')).toHaveCount(4);
  await expect(page1.locator('math mfrac')).toHaveCount(1);
  await expect(page1.locator('a[href^="https://example.com"]')).toHaveAttribute('target', '_blank');
  await expect(page1.locator('img[src^="data:image/png"]')).toHaveCount(1);
  await expect(viewer.locator('#copy')).toBeHidden();
  const docBefore = await page1.evaluate((el) => el.getBoundingClientRect().width);
  await viewer.locator('#font-down').click();
  await expect.poll(() => page1.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(docBefore);

  // Excel workbooks render as a styled grid with sheet tabs, a formula bar, and formulas on demand.
  await row(viewer, 'grades.xlsx').click();
  const sheet = viewer.locator('table.sheet');
  const cellAt = (ref: string) => sheet.locator(`td[data-ref="${ref}"]`);
  await expect(cellAt('A1')).toHaveText('Student');
  await expect(cellAt('A1')).toHaveCSS('font-weight', '700');
  await expect(cellAt('C2')).toHaveText('90.0%');
  await expect(cellAt('D2')).toHaveText('1/1/2023');
  // Too wide for its column: Excel-style ####, with the value on hover.
  await expect(cellAt('B3')).toHaveText(/^#+$/);
  await expect(cellAt('B3')).toHaveAttribute('title', '($1,234.50)');
  await expect(cellAt('B3')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(cellAt('D1')).toHaveAttribute('colspan', '2');
  await expect(cellAt('E1')).toHaveCount(0);
  await expect(viewer.locator('#file-info')).toContainText('2 sheets');
  await cellAt('C3').click();
  await expect(viewer.locator('.sheet-bar .cell-ref')).toHaveText('C3');
  await expect(viewer.locator('.sheet-bar .cell-content')).toHaveText('=B3/100');
  await viewer.getByRole('button', { name: 'Show formulas' }).click();
  await expect(cellAt('C2')).toHaveText('=B2/100');
  const sheetBefore = await sheet.evaluate((el) => el.getBoundingClientRect().width);
  await viewer.locator('#font-up').click();
  await expect.poll(() => sheet.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(sheetBefore);
  await viewer.locator('.sheet-tabs button.hidden-sheet', { hasText: 'Key' }).click();
  await expect(cellAt('A1')).toHaveText('secret');

  // PowerPoint decks: each slide drawn at its real layout (pictures and captions where they
  // sit on the slide), with notes, plus a text outline mode. The fixture's remotely linked
  // picture must not be fetched (checked below).
  await row(viewer, 'talk.pptx').click();
  const slides = viewer.locator('.slide-card');
  await expect(slides).toHaveCount(4);
  await expect(viewer.locator('.slides-disclaimer')).toContainText('PowerPoint viewer is experimental');
  await expect(viewer.locator('#file-info')).toContainText('4 slides · 1 hidden');
  await expect(viewer.locator('.slide-stage')).toHaveCount(4);
  await expect(slides.nth(0).locator('.slide-notes')).toContainText('Remember to mention error bars');
  await expect(slides.nth(0).locator('math mfrac')).toHaveCount(1);
  await expect(slides.nth(0).locator('img[src^="blob:"]')).toHaveCount(1);
  await expect(slides.nth(0).locator('img')).toHaveJSProperty('complete', true);
  // On the gallery slide each caption is centered under its picture.
  const gallery = slides.nth(3);
  for (const [i, caption] of ['Figure 1: Breadboard', 'Figure 2: Scope trace', 'Figure 3: Final build'].entries()) {
    const picture = await gallery.locator('.sl-image').nth(i).boundingBox();
    const text = await gallery.locator('.sl-shape', { hasText: caption }).locator('.slide-runs').boundingBox();
    expect(text!.y).toBeGreaterThan(picture!.y + picture!.height - 1);
    expect(Math.abs(text!.x + text!.width / 2 - (picture!.x + picture!.width / 2))).toBeLessThan(3);
  }
  await expect(viewer.locator('#copy')).toBeHidden();
  const deckBefore = await slides.nth(0).evaluate((el) => el.getBoundingClientRect().width);
  await viewer.locator('#font-up').click();
  await expect.poll(() => slides.nth(0).evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(deckBefore);
  await viewer.getByRole('button', { name: 'Text outline' }).click();
  await expect(viewer.locator('.slide-stage')).toHaveCount(0);
  await expect(slides.nth(0).locator('.slide-title')).toHaveText('Lab 3 Results');
  await expect(slides.nth(1).locator('table.chart-data')).toContainText('5.10');
  await expect(slides.nth(2)).toHaveClass(/hidden-slide/);
  await viewer.getByRole('button', { name: 'Slides' }).click();

  // Every request stayed on the fake Canvas origins or inside the extension.
  const allowed = [server.origin, server.storageOrigin, 'chrome-extension://', 'blob:', 'data:'];
  const external = requests.filter((url) => !allowed.some((prefix) => url.startsWith(prefix)));
  expect(external).toEqual([]);
  await page.close();
});

test('shows VCD waveforms laid out by a .gtkw, and keeps an edited layout for the assignment', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 800 });
  const viewer = await openSpeedGrader(page);
  const names = () => viewer.locator('.wave-name').evaluateAll((rows) => rows.map((r) => r.querySelector('.wave-label')?.textContent ?? ''));

  await row(viewer, 'waves.zip').click();
  await row(viewer, 'counter.vcd').click();
  await expect(viewer.locator('.wave-view')).toBeVisible();
  // The student's save file next to the VCD is used automatically.
  await expect(viewer.locator('.wave-layout')).toHaveValue('student:0');
  await expect(viewer.locator('.wave-layout option:checked')).toHaveText('Student: counter.gtkw');
  expect(await names()).toEqual(['clk', 'rst', 'Counter outputs', 'count[3:0]', 'count (dec)', '', 'Internals', 'bus[7:0]', 'bus[0]', 'Closed group', 'nibbles', 'missing_signal']);
  await expect(viewer.locator('#file-info')).toContainText('7 signals · ends at 40 ns · timescale 1 ns');
  await expect(viewer.locator('.wave-cursor-time')).toHaveText('@ 20 ns');
  await expect(viewer.locator('#font-up')).toBeHidden();

  // Clicking the waves moves the cursor and updates the values.
  await viewer.locator('.wave-bar button', { hasText: 'Fit' }).click();
  const canvas = viewer.locator('.wave-canvas');
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * (37 / 40), y: 5 } });
  await expect(viewer.locator('.wave-cursor-time')).toHaveText(/^@ 3[6-8] ns$/);
  await expect(viewer.locator('.wave-value').nth(3)).toHaveText('3');
  await page.screenshot({ path: 'test-results/waveform.png' });

  // Add a signal from the browser and change a radix.
  await viewer.locator('.wave-name', { hasText: 'rst' }).click();
  await viewer.getByRole('button', { name: 'Signals' }).click();
  await viewer.locator('.wave-search').fill('q[');
  await viewer.locator('.wave-browser-row.signal').first().dblclick();
  await expect.poll(async () => (await names()).slice(0, 3)).toEqual(['clk', 'rst', 'q[3:0]']);
  await viewer.locator('.wave-name', { hasText: 'bus[7:0]' }).click({ button: 'right' });
  await viewer.getByRole('menuitemcheckbox', { name: 'Decimal', exact: true }).click();
  await expect(viewer.locator('.wave-value').nth(8)).toHaveText('X');
  await expect(viewer.locator('.wave-edited')).toBeVisible();
  await page.screenshot({ path: 'test-results/waveform-editing.png' });

  await viewer.getByRole('button', { name: 'Save as my layout…' }).click();
  await viewer.locator('.wave-confirm input').fill('Counter view');
  await viewer.locator('.wave-confirm input').press('Enter');
  await expect(viewer.locator('#status')).toHaveText('Saved “Counter view” for this assignment.');
  await expect(viewer.locator('.wave-edited')).toBeHidden();
  await expect(viewer.locator('.wave-layout option:checked')).toHaveText('Mine: Counter view');

  // Another student (whose testbench has a different name) gets the saved layout.
  await page.locator('#student-5').click();
  await expect(viewer.locator('.tree .node')).toHaveCount(1);
  await expect(viewer.locator('.wave-layout option:checked')).toHaveText('Mine: Counter view');
  await expect.poll(async () => (await names()).slice(0, 4)).toEqual(['clk', 'rst', 'q[3:0]', 'Counter outputs']);
  await expect(viewer.locator('.wave-name.missing')).toHaveCount(1);

  // A second layout for the same assignment, loaded from the grader's computer.
  await viewer.locator('.wave-view input[type="file"]').setInputFiles({
    name: 'alu.gtkw',
    mimeType: 'text/plain',
    buffer: Buffer.from('@22\ntb.alu.result[7:0]\n'),
  });
  await expect(viewer.locator('.wave-layout option:checked')).toHaveText('Mine: alu.gtkw');
  await expect(viewer.locator('.wave-layout option')).toHaveText(['Mine: Counter view', 'Mine: alu.gtkw', 'All signals', 'Load .gtkw from computer…']);

  // Hovering "My layouts" lists them; deleting takes two clicks.
  await viewer.getByRole('button', { name: 'My layouts ▾' }).hover();
  const saved = viewer.locator('.wave-saved-item');
  await expect(saved).toHaveCount(2);
  await saved.nth(1).locator('.wave-saved-delete').click();
  await expect(saved).toHaveCount(2);
  await saved.nth(1).locator('.wave-saved-delete').click();
  await expect(saved).toHaveCount(1);
  // The deleted layout was showing, so the best remaining fit takes over.
  await expect(viewer.locator('.wave-layout option:checked')).toHaveText('Mine: Counter view');
  await page.screenshot({ path: 'test-results/waveform-layouts.png' });

  // Settings lists saved layouts by course and assignment, and can delete them.
  const settings = await context.newPage();
  const extensionId = new URL(context.serviceWorkers()[0]!.url()).host;
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  const card = settings.locator('.layout-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Lab 4: Counters');
  await expect(card).toContainText('EEE 120: Digital Design');
  await expect(card).toContainText('Counter view');
  await settings.screenshot({ path: 'test-results/settings-layouts.png', fullPage: true });
  await card.getByRole('button', { name: 'Delete' }).click();
  await card.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(settings.locator('#layouts')).toContainText('No saved layouts yet');
  await settings.close();

  const allowed = [server.origin, server.storageOrigin, 'chrome-extension://', 'blob:', 'data:'];
  expect(requests.filter((url) => !allowed.some((prefix) => url.startsWith(prefix)))).toEqual([]);
  await page.close();
});

test('rotates images and PDF pages', async () => {
  const page = await context.newPage();
  const viewer = await openSpeedGrader(page, '6');
  await expect(viewer.locator('.tree .node')).toHaveCount(2);
  const box = (selector: string, index = 0) =>
    viewer.locator(selector).nth(index).evaluate((el) => {
      const { width, height } = el.getBoundingClientRect();
      return width > height ? 'wide' : 'tall';
    });

  // An image: the toolbar button and the R key each turn it 90° clockwise.
  await row(viewer, 'sideways.svg').click();
  await expect.poll(() => box('.image-frame')).toBe('wide');
  await viewer.locator('#rotate').click();
  await expect.poll(() => box('.image-frame')).toBe('tall');
  // The picture keeps its own proportions (before the turn) and fills the frame once turned.
  const picture = () => viewer.locator('.image-view').evaluate((el: HTMLElement) => [el.offsetWidth, el.offsetHeight]);
  const frame = () => viewer.locator('.image-frame').evaluate((el: HTMLElement) => [el.offsetHeight, el.offsetWidth]);
  expect(await picture()).toEqual(await frame());
  await page.screenshot({ path: 'test-results/rotate-image.png' });
  await viewer.locator('body').press('r');
  await expect.poll(() => box('.image-frame')).toBe('wide');
  await expect(viewer.locator('.image-frame')).toHaveAttribute('style', /--rotation: 180deg/);

  // A PDF: one page on its own, or every page from the toolbar.
  await row(viewer, 'scan.pdf').click();
  await expect(viewer.locator('.pdf-page')).toHaveCount(2);
  await expect.poll(() => box('.pdf-page', 1)).toBe('tall');
  await viewer.locator('.pdf-page').nth(1).hover();
  await viewer.getByRole('button', { name: 'Rotate page 2' }).click();
  await expect.poll(() => box('.pdf-page', 1)).toBe('wide');
  await expect.poll(() => box('.pdf-page', 0)).toBe('tall');
  await expect(viewer.locator('.pdf-page').nth(1).locator('.textLayer')).toContainText('Page two');
  await viewer.locator('#rotate').click();
  await expect.poll(() => box('.pdf-page', 0)).toBe('wide');
  await expect.poll(() => box('.pdf-page', 1)).toBe('tall');
  await page.screenshot({ path: 'test-results/rotate-pdf.png' });

  // Going back to a file keeps how it was turned.
  await row(viewer, 'sideways.svg').click();
  await expect(viewer.locator('.image-frame')).toHaveAttribute('style', /--rotation: 180deg/);
  await row(viewer, 'scan.pdf').click();
  await expect.poll(() => box('.pdf-page', 0)).toBe('wide');
  await page.close();
});

test('reloads when SpeedGrader switches students and auto-opens a single file', async () => {
  const page = await context.newPage();
  const viewer = await openSpeedGrader(page);
  await expect(viewer.locator('.tree .node')).toHaveCount(8);

  await page.locator('#next-student').click();
  await expect(viewer.locator('.tree .node')).toHaveCount(1);
  await expect(viewer.locator('.code.language-python')).toContainText('x = 1');
  await page.close();
});

test('close button hides the drawer', async () => {
  const page = await context.newPage();
  const viewer = await openSpeedGrader(page, '4');
  await viewer.locator('#close').click();
  // The drawer lives in a closed shadow root, so check the frame element's box directly.
  await expect.poll(async () => (await viewer.frameElement()).boundingBox()).toBeNull();
  await page.close();
});
