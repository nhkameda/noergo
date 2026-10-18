/**
 * Where to go after signing in: a path on this site, or the app. Anything else (another
 * origin, a protocol-relative "//host", a backslash trick) is an open redirect.
 */
export function safeReturnPath(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length > 2000) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}
