import { languageNames, locales, type Locale } from '@noergo/i18n';
import { redirect as redirectTo } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { auth, signIn, signInOptions } from '@/auth';
import { getPathname, redirect } from '@/i18n/navigation';
import { safeReturnPath } from '@/lib/return-path';

const REASONS = ['account_not_linked', 'email_unverified', 'email_missing', 'signup_closed', 'account_deleted', 'cancelled', 'unknown'] as const;
type Reason = (typeof REASONS)[number];

/** Our refusals arrive by name; Auth.js's own errors by class name. */
function reasonOf(error: unknown): Reason | null {
  if (typeof error !== 'string' || !error) return null;
  if ((REASONS as readonly string[]).includes(error)) return error as Reason;
  if (error === 'AccessDenied') return 'cancelled';
  return 'unknown';
}

export default async function SignInPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const query = await searchParams;
  const appPath = getPathname({ href: '/app', locale });
  const target = safeReturnPath(query.callbackUrl, appPath);

  if ((await auth())?.user?.id) {
    // The agents' consent page has no language prefix; next-intl would add one.
    if (target.startsWith('/oauth/interaction/')) redirectTo(target);
    redirect({ href: target, locale });
  }

  const t = await getTranslations('auth');
  const tNav = await getTranslations('nav');
  // Another language keeps where the person was going; the app itself follows the language.
  const signInIn = (l: Locale) => getPathname({ href: { pathname: '/signin', query: { callbackUrl: target === appPath ? getPathname({ href: '/app', locale: l }) : target } }, locale: l });
  const reason = reasonOf(query.error);
  const options = signInOptions();

  return (
    <main className="nr-tela" style={{ display: 'grid', placeItems: 'center', alignContent: 'center', gap: '1.5rem', minHeight: '100vh', padding: '2rem' }}>
      <section className="nr-card" style={{ display: 'grid', gap: '1rem', width: 'min(100%, 24rem)', padding: '2rem' }}>
        <img src="/favicon.svg" alt="" width={48} height={48} />
        <h1 className="nr-h3">{t('title')}</h1>
        {reason && (
          <p className="nr-aviso" role="alert">
            {t(`errors.${reason}`)}
          </p>
        )}
        {options.length === 0 && <p className="nr-aviso">{t('notConfigured')}</p>}
        {options.map((o) => (
          <form
            key={o.id}
            action={async () => {
              'use server';
              await signIn(o.id, { redirectTo: target });
            }}
          >
            <button type="submit" className="nr-btn nr-btn--lg" style={{ width: '100%' }}>
              {o.id === 'google' ? t('google') : o.id === 'microsoft-entra-id' ? t('microsoft') : t('continueWith', { name: o.name })}
            </button>
          </form>
        ))}
        <p className="nr-lead">{t('free')}</p>
      </section>
      {/* Plain <a>: the proxy writes the language cookie only on a real navigation. */}
      <nav className="nr-visoes" aria-label={tNav('language')}>
        {locales.map((l) => (
          <a key={l} href={signInIn(l)} hrefLang={l} lang={l} aria-current={l === locale ? 'page' : undefined}>
            {languageNames[l]}
          </a>
        ))}
      </nav>
    </main>
  );
}
