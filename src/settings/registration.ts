import { originPattern, speedGraderPattern } from './domains';
import { loadSettings } from './storage';

const SCRIPT_ID = 'speedview-speedgrader';
const SCRIPT_FILE = '/content-scripts/speedgrader.js';

/** Domains from settings that the user has actually granted host access to. */
export async function grantedDomains(domains: string[]): Promise<string[]> {
  const granted: string[] = [];
  for (const domain of domains) {
    if (await browser.permissions.contains({ origins: [originPattern(domain)] })) granted.push(domain);
  }
  return granted;
}

let queue: Promise<void> = Promise.resolve();

/**
 * Re-register the SpeedGrader content script so it matches exactly the configured,
 * permission-granted domains. Called on startup and whenever settings or permissions change.
 * Calls are serialized: overlapping unregister/register pairs would otherwise race.
 */
export function syncContentScripts(): Promise<void> {
  queue = queue.then(doSync, doSync);
  return queue;
}

async function doSync(): Promise<void> {
  const { domains } = await loadSettings();
  const matches = (await grantedDomains(domains)).map(speedGraderPattern);

  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing.length) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (!matches.length) return;

  await browser.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      js: [SCRIPT_FILE],
      matches,
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
}
