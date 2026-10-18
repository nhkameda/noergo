import { describe, expect, it } from 'vitest';
import { locales, messages, negotiate } from '../src/index';

function keys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('catalogues', () => {
  const reference = keys(messages.en).sort();

  it.each(locales)('%s has exactly the keys of en', (locale) => {
    expect(keys(messages[locale]).sort()).toEqual(reference);
  });

  it.each(locales)('%s has no empty strings', (locale) => {
    const flat = keys(messages[locale]).map((k) => k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], messages[locale]));
    expect(flat.every((v) => typeof v === 'string' && v.trim().length > 0)).toBe(true);
  });
});

describe('negotiate', () => {
  it('folds regional variants into the supported locales', () => {
    expect(negotiate('pt-PT,pt;q=0.9')).toBe('pt-BR');
    expect(negotiate('zh-TW;q=0.8, en;q=0.5')).toBe('zh-CN');
    expect(negotiate('fr-FR, en-GB;q=0.7')).toBe('en');
    expect(negotiate('de')).toBe('en');
    expect(negotiate(null)).toBe('en');
  });
});
