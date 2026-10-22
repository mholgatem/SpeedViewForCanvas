// @vitest-environment jsdom
import { renderAsync } from 'docx-preview';
import { describe, expect, it } from 'vitest';
import { detectKind } from '../src/render/detect';
import { neutralizeDom } from '../src/render/sanitize';
import { makeDocx } from './helpers/docx';

describe('Word documents', () => {
  it('are detected by extension, including inside archives', () => {
    expect(detectKind('report.docx', makeDocx(), false)).toBe('docx');
    expect(detectKind('project/notes.DOCM', new Uint8Array(), false)).toBe('docx');
    expect(detectKind('old.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0]), false)).toBe('binary');
  });

  // Equations are covered by the e2e test: jsdom's MathML elements have no .style, which docx-preview needs.
  it('render text, tables, links and embedded images, with nothing remote', async () => {
    // Same structure as the viewer: separate containers for styles and pages.
    const root = document.createElement('div');
    const styles = document.createElement('div');
    const body = document.createElement('div');
    root.append(styles, body);
    await renderAsync(makeDocx({ equation: false }), body, styles, { useBase64URL: true, ignoreFonts: true, renderAltChunks: false });
    neutralizeDom(root);

    expect(body.textContent).toContain('Lab Report');
    const bold = [...body.querySelectorAll('span')].find((s) => s.textContent === 'synchronous');
    expect(bold?.style.fontWeight).toBe('bold');
    expect(body.querySelectorAll('table td')).toHaveLength(4);

    const link = body.querySelector('a[href^="https:"]')!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');

    const sources = [...body.querySelectorAll('img')].map((img) => img.getAttribute('src')).filter(Boolean);
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) expect(src).toMatch(/^data:image\/png/);
    expect(root.innerHTML).not.toContain('tracker.example');
  });
});

describe('neutralizeDom', () => {
  it('removes active content and remote references', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<style>@import "https://x/a.css"; p { background: url(https://x/bg.png) } q { background: url(data:image/png;base64,AA) }</style>' +
      '<p onclick="x()" style="background:url(\'http://x/y\')">a</p><iframe src="https://x"></iframe><script>1</script>' +
      '<img src="https://x/p.gif"><a href="javascript:alert(1)">j</a><a href="#bookmark">b</a>' +
      '<svg><image href="https://x/i.png"></image></svg>';
    neutralizeDom(root);
    const html = root.innerHTML;
    expect(html).not.toMatch(/https?:|javascript:|onclick|<iframe|<script|@import/);
    expect(html).toContain('url(data:image/png;base64,AA)');
    expect(root.querySelector('a[href="#bookmark"]')).not.toBeNull();
  });
});
