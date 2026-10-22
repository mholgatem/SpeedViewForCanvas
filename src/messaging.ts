import type { Attempt } from './canvas/api';
import type { AssignmentLabels } from './settings/savedLayouts';

/**
 * Messages between the content script (in the Canvas page) and the viewer iframe
 * (an extension page). All file bytes travel only over this in-browser channel.
 */
export type ToViewer =
  | { type: 'submission'; generation: number; status: 'loading' | 'none' }
  | { type: 'submission'; generation: number; status: 'ready'; attempts: Attempt[]; assignmentKey: string; labels: AssignmentLabels }
  | { type: 'submission'; generation: number; status: 'error'; message: string }
  | { type: 'file'; requestId: number; bytes: ArrayBuffer }
  | { type: 'file-error'; requestId: number; message: string };

export type ToContent =
  | { type: 'ready' }
  | { type: 'fetch'; requestId: number; generation: number; url: string }
  | { type: 'close' };

export const MESSAGE_TAG = 'speedview';

export interface Envelope<T> {
  tag: typeof MESSAGE_TAG;
  message: T;
}

export function wrap<T>(message: T): Envelope<T> {
  return { tag: MESSAGE_TAG, message };
}

export function unwrap<T>(data: unknown): T | null {
  const envelope = data as Envelope<T> | null;
  return envelope && typeof envelope === 'object' && envelope.tag === MESSAGE_TAG ? envelope.message : null;
}
