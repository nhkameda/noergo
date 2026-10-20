import { accountDetail } from '@noergo/core';
import { languageNames, type Locale } from '@noergo/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccountActions } from '@/components/admin/AccountActions';
import { AccountTag, AdminShell } from '@/components/admin/AdminShell';
import { getPathname } from '@/i18n/navigation';
import { requireAdmin } from '@/lib/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

/** One account: how it signs in, whether it may, and what agents it connected. */
export default async function AdminAccountPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const adminId = await requireAdmin();
  const account = await accountDetail(id);
  if (!account) notFound();
  const t = await getTranslations('admin');
  const format = await getFormatter();
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

  const facts: [string, string][] = [
    [t('account.signIns'), account.providers.join(', ') || '—'],
    [t('account.joined'), day(account.createdAt)],
    [t('account.lastLogin'), account.lastLoginAt ? day(account.lastLoginAt) : t('account.never')],
    [t('account.language'), languageNames[account.locale as Locale] ?? account.locale],
  ];

  return (
    <AdminShell locale={locale} section="accounts">
      <a href={getPathname({ href: '/admin', locale })} style={{ justifySelf: 'start' }}>
        <span aria-hidden="true">←</span> {t('account.back')}
      </a>
      <section className="nr-card" style={{ display: 'grid', gap: '0.75rem', padding: '1.5rem' }}>
        <div style={{ display: 'grid', gap: '0.25rem' }}>
          <h2 className="nr-h3" style={{ overflowWrap: 'anywhere' }}>
            {account.email}
          </h2>
          {account.name && <p style={{ margin: 0 }}>{account.name}</p>}
        </div>
        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
          {account.role === 'admin' && <AccountTag tone="neutral">{t('tags.admin')}</AccountTag>}
          {account.agentsAllowed && <AccountTag tone="success">{t('tags.agents')}</AccountTag>}
          {account.blockedAt && <AccountTag tone="danger">{t('tags.blocked')}</AccountTag>}
        </div>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem', margin: 0 }}>
          {facts.map(([label, value]) => (
            <div key={label} style={{ display: 'grid', gap: '0.125rem' }}>
              <dt style={{ fontSize: 'var(--nr-text-sm)', color: 'var(--nr-text-muted)' }}>{label}</dt>
              <dd style={{ margin: 0 }}>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <AccountActions account={account} self={account.id === adminId} />
    </AdminShell>
  );
}
