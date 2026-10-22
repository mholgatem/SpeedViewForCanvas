// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/render/markdown';
import { sanitizeHtml } from '../src/render/sanitize';

describe('sanitizeHtml', () => {
  it('removes scripts and event handlers', () => {
    const out = sanitizeHtml('<p onclick="x()">hi</p><script>alert(1)</script><img src=x onerror="alert(1)">');
    expect(out).not.toMatch(/script|onclick|onerror/);
  });

  it('strips remote resources so nothing is fetched from outside servers', () => {
    const out = sanitizeHtml(
      '<img src="https://tracker.example/p.gif"><img srcset="https://a/b 1x"><video poster="http://x/y"></video>' +
        '<div style="background:url(https://x/y)">a</div><iframe src="https://x"></iframe><link rel=stylesheet href="https://x">',
    );
    expect(out).not.toMatch(/https?:/);
  });

  it('keeps inline data images', () => {
    expect(sanitizeHtml('<img src="data:image/png;base64,AAAA">')).toContain('data:image/png;base64,AAAA');
  });

  it('opens links in a new tab without opener', () => {
    const out = sanitizeHtml('<a href="https://docs.python.org">docs</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

describe('renderMarkdown', () => {
  it('renders and sanitizes markdown with highlighted code', () => {
    const html = renderMarkdown('# Hi\n\n```python\nx = 1\n```\n\n<script>bad()</script>\n\n![t](https://evil.example/t.png)');
    expect(html).toContain('<h1>Hi</h1>');
    expect(html).toContain('hljs-number');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('evil.example');
  });
});
