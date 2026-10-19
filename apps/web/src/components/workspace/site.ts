import { LIMITS } from '@noergo/core/limits';

/**
 * What a person types as a thought's website, as the address to store: "example.com"
 * becomes "https://example.com/". Only http(s), and never with a user name in front of the
 * host ("https://bank.com@evil.example" names evil.example). Null when it is not a website.
 */
export function siteUrl(input: string): string | null {
  const typed = input.trim();
  if (!typed) return null;
  const bare = !typed.includes('://');
  try {
    const u = new URL(bare ? `https://${typed}` : typed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    // A word alone ("notes") is not an address; typed with its scheme, an intranet host is.
    if (bare && !u.hostname.includes('.')) return null;
    return u.href.length <= LIMITS.url ? u.href : null;
  } catch {
    return null;
  }
}

/** The site as people say it: its host, without "www.". */
export function siteHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
