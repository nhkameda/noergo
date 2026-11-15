import type { Locale } from '@noergo/i18n';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { auth } from '@/auth';
import { Workspace } from '@/components/workspace/Workspace';
import { getPathname } from '@/i18n/navigation';
import { SOURCE_URL } from '@/lib/env';
import { linkOf } from '@/lib/shared';

type Params = Promise<{ locale: string; token: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: 'app.shared' });
  const link = await linkOf(token);
  return { title: link ? t('pageTitle', { title: link.title }) : t('unavailable'), robots: { index: false, follow: false } };
}

/**
 * A board or thought opened by a shared link. Anyone holding the link sees it; on an edit
 * link, a signed-in person also changes it. Everything below runs through
 * /api/shared/<token>, which serves only what the link opens.
 */
export default async function SharedPage({ params }: { params: Params }) {
  const { locale, token } = (await params) as { locale: Locale; token: string };
  setRequestLocale(locale);
  const link = await linkOf(token);
  const home = getPathname({ href: '/', locale });
  if (!link) return <Unavailable home={home} />;

  const userId = (await auth())?.user?.id ?? null;
  const here = getPathname({ href: `/s/${token}`, locale });
  const signInHref = getPathname({ href: { pathname: '/signin', query: { callbackUrl: here } }, locale });
  const appHref = userId ? getPathname({ href: '/app', locale }) : home;

  return (
    <Workspace
      key={`${link.id}:${userId ?? ''}`}
      userId={`shared:${link.id}`}
      signInHref={signInHref}
      homeHref={appHref}
      agentsHref={appHref}
      sourceUrl={SOURCE_URL}
      shared={{ token, kind: link.kind, boardId: link.targetId, access: link.access, canEdit: link.access === 'edit' && !!userId, signedIn: !!userId, signInHref, appHref }}
    />
  );
}

/** A wrong link, one turned off and one whose board went to the trash look the same. */
async function Unavailable({ home }: { home: string }) {
  const t = await getTranslations('app.shared');
  return (
    <main className="nr-tela" style={{ display: 'grid', placeItems: 'center', alignContent: 'center', minHeight: '100vh', gap: '1rem', textAlign: 'center', padding: '2rem' }}>
      <img src="/favicon.svg" alt="" width={56} height={56} />
      <h1 className="nr-h3">{t('unavailable')}</h1>
      <p className="nr-lead" style={{ maxWidth: '32rem' }}>
        {t('unavailableHint')}
      </p>
      <a href={home} className="nr-btn nr-btn--primario">
        noergo
      </a>
    </main>
  );
}
