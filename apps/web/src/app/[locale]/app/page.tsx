import type { Locale } from '@noergo/i18n';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { signOut } from '@/auth';
import { Workspace } from '@/components/workspace/Workspace';
import { getPathname } from '@/i18n/navigation';
import { SOURCE_URL } from '@/lib/env';
import { requireUser } from '@/lib/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'app' });
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

/** The signed-in workspace. Everything below the session check runs in the browser. */
export default async function AppPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const appPath = getPathname({ href: '/app', locale });
  const home = getPathname({ href: '/', locale });
  const { userId } = await requireUser(appPath);
  const signInHref = getPathname({ href: { pathname: '/signin', query: { callbackUrl: appPath } }, locale });

  async function signOutAction() {
    'use server';
    await signOut({ redirectTo: home });
  }

  return <Workspace key={userId} userId={userId} signInHref={signInHref} homeHref={home} sourceUrl={SOURCE_URL} signOut={signOutAction} />;
}
