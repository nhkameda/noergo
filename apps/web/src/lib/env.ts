/** The public URL of this instance, without a trailing slash. */
export const PUBLIC_URL = (process.env.NOERGO_PUBLIC_URL ?? 'http://localhost:3041').replace(/\/+$/, '');
export const PUBLIC_ORIGIN = new URL(PUBLIC_URL).origin;

/**
 * Where the source code of this instance is (AGPL-3.0 §13: people using it over the
 * network may get it). Point it at your fork if you run a modified version.
 */
export const SOURCE_URL = process.env.NOERGO_SOURCE_URL || 'https://github.com/nhkameda/noergo';
