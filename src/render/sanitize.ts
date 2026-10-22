import DOMPurify from 'dompurify';

let hooked = false;

/** Only inline data may be loaded; anything that would hit the network is dropped. */
function isLocalUrl(value: string): boolean {
  return /^(data:image\/|blob:|#)/i.test(value.trim());
}

const REMOTE_CSS_URL = /url\(\s*(?!['"]?\s*(?:data:|blob:|#))[^)]*\)/gi;
const BLOCKED_ELEMENTS = 'script, iframe, frame, object, embed, link, base, meta, form';

/**
 * Same guarantees as sanitizeHtml, for DOM that a library built directly (the Word
 * renderer): removes active content and anything that would load from outside, and
 * makes links open in a new tab. The CSP enforces this in production builds as well.
 */
export function neutralizeDom(root: Element): void {
  for (const node of root.querySelectorAll(BLOCKED_ELEMENTS)) node.remove();
  for (const style of root.querySelectorAll('style')) {
    style.textContent = (style.textContent ?? '').replace(/@import[^;]*;?/gi, '').replace(REMOTE_CSS_URL, 'none');
  }
  for (const node of [root, ...root.querySelectorAll('*')]) {
    for (const { name } of [...node.attributes]) {
      if (name.toLowerCase().startsWith('on')) node.removeAttribute(name);
    }
    for (const attr of ['src', 'srcset', 'poster', 'background', 'xlink:href']) {
      const value = node.getAttribute(attr);
      if (value !== null && !isLocalUrl(value)) node.removeAttribute(attr);
    }
    const style = node.getAttribute('style');
    if (style && /url\s*\(/i.test(style)) node.setAttribute('style', style.replace(REMOTE_CSS_URL, 'none'));
    const href = node.getAttribute('href');
    if (href === null) continue;
    if (node.tagName.toLowerCase() === 'a' && /^(https?:|mailto:)/i.test(href.trim())) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    } else if (!href.trim().startsWith('#') && !isLocalUrl(href)) {
      node.removeAttribute('href');
    }
  }
}

/**
 * Sanitize untrusted HTML (student markdown, notebook HTML outputs). Besides removing
 * scripts, this strips every remote resource reference (images, media, CSS urls) so
 * that rendering a submission can never make a request to an outside server.
 * Links stay, but open in a new tab only when the user clicks them.
 */
export function sanitizeHtml(html: string): string {
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      for (const attr of ['src', 'srcset', 'poster', 'background', 'xlink:href']) {
        const value = node.getAttribute(attr);
        if (value !== null && !isLocalUrl(value)) node.removeAttribute(attr);
      }
      const style = node.getAttribute('style');
      if (style && /url\s*\(/i.test(style)) node.removeAttribute('style');
      if (node.tagName === 'A' && node.getAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'link', 'iframe', 'frame', 'object', 'embed', 'form', 'base', 'meta'],
    FORBID_ATTR: ['ping'],
  });
}
