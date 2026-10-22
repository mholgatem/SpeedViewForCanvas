import { fetchAssignmentLabels, fetchAttempts } from '@/src/canvas/api';
import { assignmentKey, contextKey, parseSpeedGraderUrl, type SpeedGraderContext } from '@/src/canvas/context';
import { Drawer } from '@/src/content/drawer';
import { unwrap, wrap, type ToContent, type ToViewer } from '@/src/messaging';
import { loadSettings, onSettingsChanged, saveSettings } from '@/src/settings/storage';

const URL_POLL_MS = 500;

// Registered at runtime (see src/settings/registration.ts) for each Canvas domain the
// user has approved. The match below also grants static access to Instructure-hosted Canvas.
export default defineContentScript({
  matches: ['https://*.instructure.com/courses/*/gradebook/speed_grader*'],
  registration: 'runtime',
  async main(ctx) {
    if (document.querySelector('speedview-drawer')) return; // already injected
    const settings = await loadSettings();
    const viewerUrl = browser.runtime.getURL('/viewer.html');
    const viewerOrigin = new URL(viewerUrl).origin;

    let current: SpeedGraderContext | null = null;
    let currentKey = '';
    let generation = 0;
    let viewerReady = false;
    let aborter = new AbortController();
    // Course and assignment names by assignment key, fetched once per assignment.
    const labels = new Map<string, ReturnType<typeof fetchAssignmentLabels>>();

    const post = (message: ToViewer, transfer: Transferable[] = []) => {
      drawer.iframe?.contentWindow?.postMessage(wrap(message), viewerOrigin, transfer);
    };

    const loadSubmission = async () => {
      if (!viewerReady || !drawer.isOpen) return;
      const gen = generation;
      if (!current || (!current.studentId && !current.anonymousId)) {
        post({ type: 'submission', generation: gen, status: 'none' });
        return;
      }
      post({ type: 'submission', generation: gen, status: 'loading' });
      const key = assignmentKey(current);
      if (!labels.has(key)) labels.set(key, fetchAssignmentLabels(current));
      try {
        const [attempts, names] = await Promise.all([fetchAttempts(current, aborter.signal), labels.get(key)!]);
        if (gen === generation) post({ type: 'submission', generation: gen, status: 'ready', attempts, assignmentKey: key, labels: names });
      } catch (err) {
        if (gen === generation && !aborter.signal.aborted) {
          post({ type: 'submission', generation: gen, status: 'error', message: (err as Error).message });
        }
      }
    };

    // SpeedGrader switches students without a page load, so watch the URL.
    const checkUrl = () => {
      const next = parseSpeedGraderUrl(location.href);
      const key = contextKey(next);
      if (key === currentKey) return;
      current = next;
      currentKey = key;
      generation++;
      aborter.abort();
      aborter = new AbortController();
      void loadSubmission();
    };

    const fetchFile = async (requestId: number, gen: number, url: string) => {
      try {
        // Only fetch Canvas download links for the page's own origin.
        const target = new URL(url, location.origin);
        if (target.origin !== location.origin) throw new Error('Refusing to fetch a file from another site');
        const response = await fetch(target, { credentials: 'same-origin', signal: aborter.signal });
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        const bytes = await response.arrayBuffer();
        if (gen === generation) post({ type: 'file', requestId, bytes }, [bytes]);
      } catch (err) {
        if (gen === generation) post({ type: 'file-error', requestId, message: (err as Error).message });
      }
    };

    const drawer = new Drawer({
      side: settings.drawerSide,
      width: settings.drawerWidth,
      viewerUrl,
      onOpen: () => void loadSubmission(),
      onResize: (width) => void saveSettings({ drawerWidth: width }),
    });

    ctx.addEventListener(window, 'message', (event: MessageEvent) => {
      if (event.origin !== viewerOrigin || event.source !== drawer.iframe?.contentWindow) return;
      const message = unwrap<ToContent>(event.data);
      if (!message) return;
      switch (message.type) {
        case 'ready':
          viewerReady = true;
          void loadSubmission();
          break;
        case 'fetch':
          void fetchFile(message.requestId, message.generation, message.url);
          break;
        case 'close':
          drawer.close();
          break;
      }
    });

    browser.runtime.onMessage.addListener((message: unknown) => {
      if ((message as { type?: string })?.type === 'toggle-drawer') drawer.toggle();
    });

    const stopSettings = onSettingsChanged((next) => {
      drawer.setSide(next.drawerSide);
      drawer.setWidth(next.drawerWidth);
    });

    ctx.addEventListener(window, 'popstate', checkUrl);
    ctx.setInterval(checkUrl, URL_POLL_MS);
    ctx.onInvalidated(() => {
      aborter.abort();
      stopSettings();
      drawer.destroy();
    });

    checkUrl();
    if (settings.autoOpen) drawer.open();
  },
});
