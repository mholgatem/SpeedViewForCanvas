export type Theme = 'auto' | 'light' | 'dark';
export type DrawerSide = 'left' | 'right';

export interface Settings {
  /** Canvas hostnames the extension runs on, e.g. "canvas.asu.edu" or "*.instructure.com". */
  domains: string[];
  theme: Theme;
  fontSize: number;
  tabWidth: number;
  wrap: boolean;
  lineNumbers: boolean;
  autoOpen: boolean;
  /** Left covers SpeedGrader's preview pane and keeps the grading panel visible. */
  drawerSide: DrawerSide;
  drawerWidth: number;
  /** Files larger than this prompt before downloading. */
  confirmSizeMB: number;
  /** Files larger than this are shown as plain text instead of highlighted. */
  highlightMaxKB: number;
  archiveMaxEntries: number;
  archiveMaxTotalMB: number;
  archiveMaxDepth: number;
  /** File extension (lowercase, no dot) -> highlight.js language name. */
  languageOverrides: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  domains: ['*.instructure.com'],
  theme: 'auto',
  fontSize: 13,
  tabWidth: 4,
  wrap: false,
  lineNumbers: true,
  autoOpen: false,
  drawerSide: 'left',
  drawerWidth: 720,
  confirmSizeMB: 25,
  highlightMaxKB: 1024,
  archiveMaxEntries: 5000,
  archiveMaxTotalMB: 200,
  archiveMaxDepth: 3,
  languageOverrides: {},
};
