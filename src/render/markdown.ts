import { Marked } from 'marked';
import { highlight } from './highlight';
import { sanitizeHtml } from './sanitize';

const marked = new Marked({
  gfm: true,
  async: false,
  renderer: {
    // Highlight fenced code blocks with the same engine as the code viewer.
    code({ text, lang }) {
      const language = lang?.split(/\s/)[0]?.toLowerCase() || 'plaintext';
      return `<pre><code class="hljs">${highlight(text, language).lines.join('\n')}</code></pre>\n`;
    },
  },
});

/** Render untrusted markdown to sanitized HTML. */
export function renderMarkdown(source: string): string {
  return sanitizeHtml(marked.parse(source, { async: false }));
}
