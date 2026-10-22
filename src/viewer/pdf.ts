import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { ZoomableView } from './views';

/**
 * PDFs are rendered with a bundled copy of pdf.js instead of the browser's own viewer:
 * Firefox's viewer won't render a blob: PDF inside an extension frame, and this gives
 * the same result in every browser. All pdf.js assets ship inside the extension.
 */

export interface PdfView extends ZoomableView {
  pageCount: number;
}

const PAGE_GAP = 12;
const SIDE_PADDING = 32;

export async function renderPdfView(scroller: HTMLElement, container: HTMLElement, bytes: Uint8Array, zoom: number): Promise<PdfView> {
  const pdfjs = await import('pdfjs-dist');
  // The viewer is an extension page, so this resolves inside the extension package.
  const base = new URL('/pdfjs/', location.href).href;
  pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;

  const doc: PDFDocumentProxy = await pdfjs.getDocument({
    // pdf.js transfers the buffer to its worker; pass a copy so the file stays downloadable.
    data: bytes.slice(),
    cMapUrl: `${base}cmaps/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    iccUrl: `${base}iccs/`,
    wasmUrl: `${base}wasm/`,
    // Use the JS image decoders so the CSP doesn't need 'wasm-unsafe-eval'.
    useWasm: false,
    enableXfa: false,
  }).promise;

  const pagesEl = document.createElement('div');
  pagesEl.className = 'pdf-pages';
  container.append(pagesEl);

  const first = await doc.getPage(1);
  const baseWidth = first.getViewport({ scale: 1 }).width;
  const pages: { el: HTMLDivElement; page?: PDFPageProxy; rendered: boolean; cancel?: () => void }[] = [];
  let scale = 1;

  const fitScale = () => (Math.max(200, scroller.clientWidth - SIDE_PADDING) / baseWidth) * zoom;

  const renderPage = async (index: number) => {
    const slot = pages[index]!;
    if (slot.rendered) return;
    slot.rendered = true;
    slot.page ??= await doc.getPage(index + 1);
    const viewport = slot.page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    slot.el.replaceChildren(canvas, textLayer);
    sizePage(slot.el, viewport.width, viewport.height);

    const task = slot.page.render({
      canvas,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    slot.cancel = () => task.cancel();
    try {
      await task.promise;
      const text = new pdfjs.TextLayer({
        textContentSource: slot.page.streamTextContent(),
        container: textLayer,
        viewport,
      });
      await text.render();
    } catch (err) {
      if ((err as Error).name !== 'RenderingCancelledException') throw err;
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) void renderPage(Number((entry.target as HTMLElement).dataset.index));
      }
    },
    { root: scroller, rootMargin: '600px 0px' },
  );

  const layout = () => {
    scale = fitScale();
    const firstViewport = first.getViewport({ scale });
    for (const slot of pages) {
      slot.cancel?.();
      slot.rendered = false;
      slot.el.replaceChildren();
      // Pages not yet loaded borrow page 1's size until rendered.
      const vp = slot.page?.getViewport({ scale }) ?? firstViewport;
      sizePage(slot.el, vp.width, vp.height);
    }
  };

  for (let i = 0; i < doc.numPages; i++) {
    const el = document.createElement('div');
    el.className = 'pdf-page';
    el.dataset.index = String(i);
    el.style.marginBottom = `${PAGE_GAP}px`;
    pagesEl.append(el);
    pages.push({ el, page: i === 0 ? first : undefined, rendered: false });
  }
  layout();
  for (const slot of pages) observer.observe(slot.el);

  return {
    pageCount: doc.numPages,
    setZoom(next) {
      zoom = next;
      layout();
      // Re-observe so visible pages render again at the new scale.
      for (const slot of pages) {
        observer.unobserve(slot.el);
        observer.observe(slot.el);
      }
    },
    destroy() {
      observer.disconnect();
      for (const slot of pages) slot.cancel?.();
      void doc.loadingTask.destroy();
      pagesEl.remove();
    },
  };

  function sizePage(el: HTMLElement, width: number, height: number) {
    el.style.width = `${Math.floor(width)}px`;
    el.style.height = `${Math.floor(height)}px`;
    el.style.setProperty('--total-scale-factor', String(scale));
  }
}
