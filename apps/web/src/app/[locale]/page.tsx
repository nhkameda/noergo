import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SOURCE_URL } from '@/lib/env';

/** Placeholder home until the landing page is ported (phase F7). */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  return (
    <main className="nr-tela" style={{ display: 'grid', placeItems: 'center', alignContent: 'center', minHeight: '100vh', gap: '1.25rem', textAlign: 'center', padding: '2rem' }}>
      <img src="/favicon.svg" alt="" width={64} height={64} />
      <h1 className="nr-h3">{t('meta.title')}</h1>
      <p className="nr-lead">{t('meta.description')}</p>
      <Link href="/app" className="nr-btn nr-btn--primario nr-btn--lg">
        {t('nav.app')}
      </Link>
      <p>
        {t('footer.openSource')} <a href={SOURCE_URL}>{t('nav.sourceCode')}</a>
      </p>
    </main>
  );
}
