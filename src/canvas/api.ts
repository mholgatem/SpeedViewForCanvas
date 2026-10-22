import type { SpeedGraderContext } from './context';

export interface Attachment {
  id: string;
  name: string;
  size: number;
  contentType: string;
  /** Canvas download URL; redirects to Canvas file storage. */
  url: string;
}

export interface Attempt {
  attempt: number;
  submittedAt: string | null;
  attachments: Attachment[];
}

interface RawAttachment {
  id: number | string;
  display_name?: string;
  filename?: string;
  size?: number;
  'content-type'?: string;
  url?: string;
}

interface RawSubmission {
  attempt?: number | null;
  submitted_at?: string | null;
  attachments?: RawAttachment[];
  submission_history?: RawSubmission[];
}

export function submissionApiPath(ctx: SpeedGraderContext): string | null {
  const base = `/api/v1/courses/${ctx.courseId}/assignments/${ctx.assignmentId}`;
  if (ctx.studentId) return `${base}/submissions/${ctx.studentId}?include[]=submission_history`;
  if (ctx.anonymousId) return `${base}/anonymous_submissions/${ctx.anonymousId}?include[]=submission_history`;
  return null;
}

function toAttachment(raw: RawAttachment): Attachment | null {
  if (!raw.url) return null;
  return {
    id: String(raw.id),
    name: raw.display_name || raw.filename || `file-${raw.id}`,
    size: raw.size ?? 0,
    contentType: raw['content-type'] ?? '',
    url: raw.url,
  };
}

/** Attempts that have file attachments, newest first. */
export function parseAttempts(sub: RawSubmission): Attempt[] {
  const history = sub.submission_history?.length ? sub.submission_history : [sub];
  const attempts: Attempt[] = [];
  for (const entry of history) {
    const attachments = (entry.attachments ?? []).map(toAttachment).filter((a): a is Attachment => a !== null);
    if (!attachments.length) continue;
    attempts.push({ attempt: entry.attempt ?? 0, submittedAt: entry.submitted_at ?? null, attachments });
  }
  return attempts.sort((a, b) => b.attempt - a.attempt);
}

/** Canvas may prefix JSON with "while(1);" as an anti-hijacking guard. */
export function parseCanvasJson(text: string): unknown {
  return JSON.parse(text.replace(/^while\(1\);/, ''));
}

/** Same-origin request using the teacher's existing Canvas session. Must run in the Canvas page. */
export async function fetchAttempts(ctx: SpeedGraderContext, signal?: AbortSignal): Promise<Attempt[]> {
  const path = submissionApiPath(ctx);
  if (!path) return [];
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) throw new Error(`Canvas returned ${response.status} for the submission`);
  return parseAttempts(parseCanvasJson(await response.text()) as RawSubmission);
}

/**
 * Course and assignment names, so saved waveform layouts can be listed by name in settings.
 * Not essential: anything that fails comes back as null.
 */
export async function fetchAssignmentLabels(
  ctx: SpeedGraderContext,
  signal?: AbortSignal,
): Promise<{ course: string | null; assignment: string | null }> {
  const name = async (path: string): Promise<string | null> => {
    try {
      const response = await fetch(path, { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal });
      if (!response.ok) return null;
      const body = parseCanvasJson(await response.text()) as { name?: unknown };
      return typeof body.name === 'string' ? body.name : null;
    } catch {
      return null;
    }
  };
  const [course, assignment] = await Promise.all([
    name(`/api/v1/courses/${ctx.courseId}`),
    name(`/api/v1/courses/${ctx.courseId}/assignments/${ctx.assignmentId}`),
  ]);
  return { course, assignment };
}
