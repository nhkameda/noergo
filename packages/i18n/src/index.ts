import en from './messages/en.json';
import ptBR from './messages/pt-BR.json';
import zhCN from './messages/zh-CN.json';

/**
 * The three languages of noergo. English is the reference catalogue: every key exists
 * there first, and the test in this package fails when another language misses one.
 */
export const locales = ['pt-BR', 'en', 'zh-CN'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export type Messages = typeof en;

export const messages: Record<Locale, Messages> = { 'pt-BR': ptBR, en, 'zh-CN': zhCN };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (locales as readonly string[]).includes(v);
}

/** Best match for an Accept-Language header. Portuguese and Chinese variants fold into ours. */
export function negotiate(acceptLanguage: string | null | undefined): Locale {
  const tags = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', q] = part.trim().split(';q=');
      return { tag: tag.toLowerCase(), q: q === undefined ? 1 : Number(q) || 0 };
    })
    .filter((t) => t.tag)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of tags) {
    if (tag.startsWith('pt')) return 'pt-BR';
    if (tag.startsWith('zh')) return 'zh-CN';
    if (tag.startsWith('en')) return 'en';
  }
  return defaultLocale;
}
