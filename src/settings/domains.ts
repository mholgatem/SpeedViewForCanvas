const HOST_RE = /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Turn whatever the user typed ("https://canvas.asu.edu/courses/1", "canvas.asu.edu",
 * "*.instructure.com") into a normalized domain entry, or null if it isn't valid.
 * Plain http is only accepted for localhost (used by the e2e test fixtures).
 */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  let scheme = 'https';
  const schemeMatch = /^([a-z]+):\/\//.exec(value);
  if (schemeMatch) {
    scheme = schemeMatch[1]!;
    value = value.slice(schemeMatch[0].length);
  }
  const host = value.split(/[/?#]/)[0]!.replace(/:\d+$/, '');
  if (!HOST_RE.test(host)) return null;
  if (scheme === 'http' && LOCAL_HOSTS.has(host)) return `http://${host}`;
  if (scheme !== 'https') return null;
  return host;
}

function schemeAndHost(domain: string): [string, string] {
  return domain.startsWith('http://') ? ['http', domain.slice(7)] : ['https', domain];
}

/** Host permission needed for a domain entry. */
export function originPattern(domain: string): string {
  const [scheme, host] = schemeAndHost(domain);
  return `${scheme}://${host}/*`;
}

/** Whether a page origin (e.g. "https://canvas.asu.edu") belongs to a domain entry. */
export function originMatchesDomain(origin: string, domain: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const [scheme, host] = schemeAndHost(domain);
  if (url.protocol !== `${scheme}:`) return false;
  if (host.startsWith('*.')) return url.hostname.endsWith(host.slice(1));
  return url.hostname === host;
}

/** Content-script match pattern for SpeedGrader on a domain entry. */
export function speedGraderPattern(domain: string): string {
  const [scheme, host] = schemeAndHost(domain);
  return `${scheme}://${host}/courses/*/gradebook/speed_grader*`;
}
