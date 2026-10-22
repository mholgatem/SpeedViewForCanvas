import { syncContentScripts } from '@/src/settings/registration';

export default defineBackground(() => {
  const resync = () => void syncContentScripts().catch((err) => console.error('[SpeedView] sync failed', err));

  browser.runtime.onInstalled.addListener(({ reason }) => {
    resync();
    if (reason === 'install') void browser.runtime.openOptionsPage();
  });
  browser.runtime.onStartup.addListener(resync);
  browser.permissions.onAdded.addListener(resync);
  browser.permissions.onRemoved.addListener(resync);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && 'domains' in changes) resync();
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-drawer') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    // Fails harmlessly when the active tab isn't SpeedGrader (no content script listening).
    if (tab?.id !== undefined) await browser.tabs.sendMessage(tab.id, { type: 'toggle-drawer' }).catch(() => {});
  });
});
