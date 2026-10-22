import { describe, expect, it } from 'vitest';
import { parseAttempts, parseCanvasJson, submissionApiPath } from '../src/canvas/api';
import { contextKey, parseSpeedGraderUrl } from '../src/canvas/context';

describe('parseSpeedGraderUrl', () => {
  it('parses classic SpeedGrader URLs', () => {
    const ctx = parseSpeedGraderUrl('https://canvas.asu.edu/courses/123/gradebook/speed_grader?assignment_id=456&student_id=789');
    expect(ctx).toEqual({ origin: 'https://canvas.asu.edu', courseId: '123', assignmentId: '456', studentId: '789', anonymousId: undefined });
  });

  it('parses anonymous grading URLs', () => {
    const ctx = parseSpeedGraderUrl('https://canvas.asu.edu/courses/1/gradebook/speed_grader?assignment_id=2&anonymous_id=aB3xY');
    expect(ctx?.anonymousId).toBe('aB3xY');
    expect(ctx?.studentId).toBeUndefined();
  });

  it('allows a URL with no student selected yet', () => {
    expect(parseSpeedGraderUrl('https://x.instructure.com/courses/1/gradebook/speed_grader?assignment_id=2')?.studentId).toBeUndefined();
  });

  it.each([
    'https://canvas.asu.edu/courses/1/gradebook',
    'https://canvas.asu.edu/courses/1/gradebook/speed_grader',
    'https://canvas.asu.edu/courses/1/gradebook/speed_grader?assignment_id=2&student_id=../x',
    'not a url',
  ])('rejects %s', (url) => {
    expect(parseSpeedGraderUrl(url)).toBeNull();
  });

  it('changes key when the student changes', () => {
    const a = parseSpeedGraderUrl('https://c.edu/courses/1/gradebook/speed_grader?assignment_id=2&student_id=3');
    const b = parseSpeedGraderUrl('https://c.edu/courses/1/gradebook/speed_grader?assignment_id=2&student_id=4');
    expect(contextKey(a)).not.toBe(contextKey(b));
  });
});

describe('submission API', () => {
  it('builds paths for named and anonymous grading', () => {
    const base = { origin: 'https://c.edu', courseId: '1', assignmentId: '2' };
    expect(submissionApiPath({ ...base, studentId: '3' })).toBe('/api/v1/courses/1/assignments/2/submissions/3?include[]=submission_history');
    expect(submissionApiPath({ ...base, anonymousId: 'ab' })).toBe('/api/v1/courses/1/assignments/2/anonymous_submissions/ab?include[]=submission_history');
    expect(submissionApiPath(base)).toBeNull();
  });

  it('collects attempts with attachments, newest first', () => {
    const attempts = parseAttempts({
      attempt: 2,
      submission_history: [
        { attempt: 1, submitted_at: '2026-01-01T00:00:00Z', attachments: [{ id: 10, display_name: 'old.py', size: 5, 'content-type': 'text/x-python', url: '/files/10/download' }] },
        { attempt: 2, submitted_at: '2026-01-02T00:00:00Z', attachments: [{ id: 11, filename: 'new.zip', url: '/files/11/download' }] },
        { attempt: 3, attachments: [] },
      ],
    });
    expect(attempts.map((a) => a.attempt)).toEqual([2, 1]);
    expect(attempts[0]!.attachments[0]).toEqual({ id: '11', name: 'new.zip', size: 0, contentType: '', url: '/files/11/download' });
  });

  it('falls back to the top-level submission without history', () => {
    const attempts = parseAttempts({ attempt: 1, attachments: [{ id: 1, display_name: 'a.v', url: '/f' }] });
    expect(attempts).toHaveLength(1);
  });

  it('strips the while(1); JSON guard', () => {
    expect(parseCanvasJson('while(1);{"a":1}')).toEqual({ a: 1 });
    expect(parseCanvasJson('{"a":1}')).toEqual({ a: 1 });
  });
});
