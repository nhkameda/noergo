import type { Locale } from '@noergo/i18n';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { signOut } from '@/auth';
import { getPathname } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';

/** Placeholder for the board (phase F3): proves the session and the workspace. */
export default async function AppPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const home = getPathname({ href: '/', locale });
  await requireUser(getPathname({ href: '/app', locale }));
  const t = await getTranslations();
  return (
    <main className="nr-tela" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', gap: '1rem', padding: '2rem' }}>
      <p>{t('app.signedIn')}</p>
      <form
        action={async () => {
          'use server';
          await signOut({ redirectTo: home });
        }}
      >
        <button type="submit" className="nr-btn">
          {t('nav.signOut')}
        </button>
      </form>
    </main>
  );
}
