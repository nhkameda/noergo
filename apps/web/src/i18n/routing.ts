import { defaultLocale, locales, type Locale } from '@noergo/i18n';
import { defineRouting } from 'next-intl/routing';

/** URL prefix of each language, without the slash. */
export const PREFIX: Record<Locale, string> = { en: 'en', 'pt-BR': 'pt', 'zh-CN': 'zh' };
export const LOCALE_OF_PREFIX: Readonly<Record<string, Locale>> = Object.fromEntries(Object.entries(PREFIX).map(([l, p]) => [p, l as Locale]));

/**
 * Every page lives under a short language prefix (/en, /pt, /zh), so a URL alone decides
 * the language. The root path picks one (src/proxy.ts). next-intl neither reads nor
 * writes the language cookie: the proxy owns it and writes it only on real document
 * navigations, never on <Link> prefetches (a prefetched language switcher would
 * otherwise change the person's language without a click).
 */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: { mode: 'always', prefixes: { en: `/${PREFIX.en}`, 'pt-BR': `/${PREFIX['pt-BR']}`, 'zh-CN': `/${PREFIX['zh-CN']}` } },
  localeCookie: false,
  localeDetection: false,
  alternateLinks: true,
});

export const LOCALE_COOKIE = 'noergo_locale';
