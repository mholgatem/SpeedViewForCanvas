export interface ArchiveEntry {
  /** Path inside the archive, '/'-separated, sanitized. */
  path: string;
  size: number;
  data: Uint8Array;
}

export interface ArchiveLimits {
  maxEntries: number;
  maxTotalBytes: number;
}

/** Thrown when an archive exceeds the configured safety limits (e.g. a zip bomb). */
export class ArchiveLimitError extends Error {
  constructor(reason: string) {
    super(`Archive not opened: ${reason}. You can raise the limits in SpeedView settings.`);
    this.name = 'ArchiveLimitError';
  }
}
