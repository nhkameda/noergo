/**
 * Domain errors with stable codes. The web API maps them to HTTP statuses and the MCP
 * server returns them as tool errors, so agents can react (re-read on conflict, send the
 * person to their administrator on agents_not_enabled) instead of guessing from prose.
 */
export type DomainErrorCode =
  | 'not_found'
  | 'version_conflict'
  | 'invalid'
  | 'limit_reached'
  | 'read_only_connection'
  | 'agents_not_enabled'
  | 'rate_limited'
  | 'forbidden';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

/** "Not found" is also the answer for ids that exist in another workspace. */
export const notFound = (what: string) => new DomainError('not_found', `${what} not found`);

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
