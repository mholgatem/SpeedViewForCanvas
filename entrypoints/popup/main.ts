import { parseSpeedGraderUrl } from '@/src/canvas/context';
import { normalizeDomain, originMatchesDomain, originPattern } from '@/src/settings/domains';
import { grantedDomains } from '@/src/settings/registration';
import { loadSettings, saveSettings } from '@/src/settings/storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const message = $('message');
const enable = $<HTMLButtonElement>('enable');
const toggle = $<HTMLButtonElement>('toggle');

$('settings').addEventListener('click', () => {
  void browser.runtime.openOptionsPage();
  window.close();
});

async function init() {
  // activeTab gives access to this tab's URL while the popup is open.
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ? new URL(tab.url) : null;
  if (!url || url.protocol !== 'https:') {
    message.textContent = 'Open your Canvas site to use SpeedView here.';
    return;
  }

  const settings = await loadSettings();
  const active = (await grantedDomains(settings.domains)).some((d) => originMatchesDomain(url.origin, d));
  const onSpeedGrader = parseSpeedGraderUrl(url.href) !== null;

  if (active) {
    message.textContent = onSpeedGrader
      ? `SpeedView is active on ${url.hostname}.`
      : `SpeedView is enabled on ${url.hostname}. Open an assignment in SpeedGrader to view files.`;
    if (onSpeedGrader && tab?.id !== undefined) {
      toggle.hidden = false;
      toggle.addEventListener('click', () => {
        void browser.tabs.sendMessage(tab.id!, { type: 'toggle-drawer' }).catch(() => {});
        window.close();
      });
    }
    return;
  }

  const domain = normalizeDomain(url.hostname)!;
  message.textContent = onSpeedGrader
    ? `SpeedView isn't enabled on ${url.hostname} yet.`
    : `Is ${url.hostname} your school's Canvas site? Enable SpeedView here to use it in SpeedGrader.`;
  enable.textContent = `Enable on ${url.hostname}`;
  enable.hidden = false;
  enable.addEventListener('click', () => {
    // Request inside the click (Firefox requires it). Save the domain in the same tick:
    // Firefox may close the popup when the permission prompt appears, and the
    // background re-registers the content script once the permission is granted.
    const request = browser.permissions.request({ origins: [originPattern(domain)] });
    if (!settings.domains.includes(domain)) void saveSettings({ domains: [...settings.domains, domain] });
    void request.then((granted) => {
      message.textContent = granted
        ? `Enabled. Reload the page to start using SpeedView on ${url.hostname}.`
        : `Access wasn't granted, so SpeedView can't run on ${url.hostname}.`;
      enable.hidden = true;
    });
  });
}

void init();
