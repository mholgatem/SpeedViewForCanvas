import { DEFAULT_SETTINGS, type Settings } from './schema';

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get({ ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await browser.storage.sync.set(patch);
}

export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  const listener = (_changes: unknown, area: string) => {
    if (area === 'sync') void loadSettings().then(callback);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
