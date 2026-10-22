/** Which submission SpeedGrader is currently showing, parsed from its URL. */
export interface SpeedGraderContext {
  origin: string;
  courseId: string;
  assignmentId: string;
  /** Set for normal grading. */
  studentId?: string;
  /** Set when the assignment is graded anonymously (student_id is then absent). */
  anonymousId?: string;
}

const PATH_RE = /^\/courses\/(\d+)\/gradebook\/speed_grader\/?$/;
const ID_RE = /^[\w-]+$/;

export function parseSpeedGraderUrl(href: string): SpeedGraderContext | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const courseId = PATH_RE.exec(url.pathname)?.[1];
  const assignmentId = url.searchParams.get('assignment_id');
  if (!courseId || !assignmentId || !ID_RE.test(assignmentId)) return null;

  const studentId = url.searchParams.get('student_id') || undefined;
  const anonymousId = url.searchParams.get('anonymous_id') || undefined;
  if (studentId && !ID_RE.test(studentId)) return null;
  if (anonymousId && !ID_RE.test(anonymousId)) return null;

  return { origin: url.origin, courseId, assignmentId, studentId, anonymousId };
}

/** Identifies the assignment (not the student), for settings saved per assignment. */
export function assignmentKey(ctx: SpeedGraderContext): string {
  return [ctx.origin, ctx.courseId, ctx.assignmentId].join('|');
}

/** Stable key used to detect when SpeedGrader switches to a different submission. */
export function contextKey(ctx: SpeedGraderContext | null): string {
  if (!ctx) return '';
  return [ctx.origin, ctx.courseId, ctx.assignmentId, ctx.studentId ?? '', ctx.anonymousId ?? ''].join('|');
}
