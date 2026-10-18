import { v7 } from 'uuid';

/**
 * Time-ordered UUIDs (v7). Clients generate ids for what they create, so an operation can
 * be retried and still name the same object; v7 keeps index inserts append-mostly.
 */
export const newId = (): string => v7();
