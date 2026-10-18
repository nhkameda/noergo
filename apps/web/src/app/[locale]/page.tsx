import { getTranslations, setRequestLocale } from 'next-intl/server';

const SOURCE = 'https://github.com/nhkameda/noergo';

/** Placeholder home until the landing page is ported (phase F7). */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', gap: '1rem', textAlign: 'center', padding: '2rem' }}>
      <img src="/favicon.svg" alt="" width={64} height={64} />
      <h1>{t('meta.title')}</h1>
      <p>{t('meta.description')}</p>
      <p>
        {t('footer.openSource')} <a href={SOURCE}>{t('nav.sourceCode')}</a>
      </p>
    </main>
  );
}
