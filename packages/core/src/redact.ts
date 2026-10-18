/**
 * Redaction applied before anything reaches a log. Logs leave the database's access
 * controls (journald, error trackers, screenshots in issues), so they must never carry
 * a credential, an e-mail address or note content.
 */

const PRIVATE_KEY = /(?:password|passwd|secret|token|ticket|authorization|cookie|api.?key|client.?secret|access.?key|body|content)|^(?:key|grant|code|state)$/i;
const CENSORED = '[redacted]';

export function redactText(value: unknown, limit = 4000): string | null {
  if (value === null || value === undefined) return null;
  // Cap before any regex runs: no log line accepts an unbounded string. Terminal escapes
  // and control characters (newlines included) go too, or a crafted value could forge
  // or hide log lines.
  return String(value)
    .slice(0, 16_000)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0a-\x1f\x7f]/g, ' ')
    .replace(/\bBearer\s+[^\s,;"'<>]+/gi, `Bearer ${CENSORED}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, `$1${CENSORED}@`)
    .replace(/((?:token|email|code|state|secret|password|key|grant|session_state|id_token|refresh_token)=)[^&\s#"'<>]*/gi, `$1${CENSORED}`)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, CENSORED)
    .replace(/\b(?:nrg_|sk_(?:live|test)_|rk_(?:live|test)_|whsec_)[A-Za-z0-9_-]{8,}/g, CENSORED)
    .replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, CENSORED)
    .replace(/\b[a-f0-9]{48,}\b/gi, CENSORED)
    .slice(0, limit);
}

/** Structured metadata: private keys are dropped whole, everything else is redacted text. */
export function redactMetadata(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return redactText(value, 1000);
  if (depth >= 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactMetadata(v, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 40)
        .map(([k, v]) => [k.slice(0, 100), PRIVATE_KEY.test(k) ? CENSORED : redactMetadata(v, depth + 1)]),
    );
  }
  return null;
}
