import { describe, expect, it } from 'vitest';
import { siteHost, siteUrl } from '@/components/workspace/site';

describe('a thought’s website', () => {
  it('reads what people type as an address', () => {
    expect(siteUrl('example.com')).toBe('https://example.com/');
    expect(siteUrl('  www.noergo.com/pt  ')).toBe('https://www.noergo.com/pt');
    expect(siteUrl('http://intranet:8080/wiki')).toBe('http://intranet:8080/wiki');
    expect(siteUrl('')).toBeNull();
  });

  it('never takes something a click could run, or a host in disguise', () => {
    for (const typed of ['javascript:alert(1)', 'JaVaScRiPt://x.com/%0aalert(1)', 'data:text/html,x', 'mailto:a@b.com', 'ftp://files.example.com', 'https://bank.com@evil.example', 'notes', 'https://']) {
      expect(siteUrl(typed), typed).toBeNull();
    }
  });

  it('names a site by its host', () => {
    expect(siteHost('https://www.example.com/planos')).toBe('example.com');
    expect(siteHost('http://intranet:8080/')).toBe('intranet');
  });
});
