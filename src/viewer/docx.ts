import { neutralizeDom } from '../render/sanitize';
import type { ZoomableView } from './views';

/**
 * Word documents are rendered with docx-preview (loaded on first use): page-sized
 * sections with the document's styles, tables, images, headers/footers, footnotes, and
 * equations (as MathML). Images become data: URLs read from the file itself; fonts
 * embedded in the document and embedded HTML chunks are not loaded.
 */

const SIDE_PADDING = 32;

export async function renderDocxView(scroller: HTMLElement, container: HTMLElement, bytes: Uint8Array, zoom: number): Promise<ZoomableView> {
  const { renderAsync } = await import('docx-preview');
  const root = document.createElement('div');
  root.className = 'docx-view';
  const styles = document.createElement('div');
  const body = document.createElement('div');
  root.append(styles, body);

  await renderAsync(bytes, body, styles, {
    className: 'docx',
    inWrapper: true,
    breakPages: true,
    ignoreFonts: true,
    useBase64URL: true,
    renderAltChunks: false,
    renderChanges: false,
    renderComments: false,
    experimental: false,
  });
  neutralizeDom(root);
  container.append(root);

  const wrapper = body.querySelector<HTMLElement>('.docx-wrapper') ?? body;
  const pageWidth = body.querySelector<HTMLElement>('section.docx')?.offsetWidth || 816;

  const layout = () => {
    // The wrapper's padding scales with the zoom too, so fit page + padding.
    const fit = Math.max(200, scroller.clientWidth) / (pageWidth + SIDE_PADDING);
    wrapper.style.setProperty('zoom', String(fit * zoom));
  };
  layout();

  return {
    setZoom(next) {
      zoom = next;
      layout();
    },
    destroy() {
      root.remove();
    },
  };
}
