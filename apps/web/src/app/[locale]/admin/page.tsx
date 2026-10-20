import { listAccounts, type AccountFilter } from '@noergo/core';
import type { Locale } from '@noergo/i18n';
import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccountTag, AdminShell } from '@/components/admin/AdminShell';
import { getPathname } from '@/i18n/navigation';
import { requireAdmin } from '@/lib/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

const FILTERS: readonly AccountFilter[] = ['all', 'blocked', 'agents'];

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

const row = { display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '0.75rem 0', borderTop: '1px solid var(--nr-border)' } as const;
const select = { minHeight: 44, padding: '0 0.75rem', borderRadius: 'var(--nr-radius-md)', border: '1px solid var(--nr-border-strong)', background: 'var(--nr-surface)', color: 'var(--nr-text)', font: 'inherit' } as const;

/** The accounts of this instance: search, filter, and a way into each. */
export default async function AdminAccountsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdmin();
  const t = await getTranslations('admin');
  const format = await getFormatter();
  const query = await searchParams;
  const search = one(query.q).slice(0, 200);
  const filter = (FILTERS as readonly string[]).includes(one(query.filter)) ? (one(query.filter) as AccountFilter) : 'all';
  const page = Math.max(1, Number.parseInt(one(query.page), 10) || 1);
  const { accounts, total, pageSize } = await listAccounts({ search, filter, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const here = getPathname({ href: '/admin', locale });
  const pageHref = (n: number) => `${here}?${new URLSearchParams({ ...(search ? { q: search } : {}), ...(filter !== 'all' ? { filter } : {}), page: String(n) })}`;
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

  return (
    <AdminShell locale={locale} section="accounts">
      <section className="nr-card" style={{ display: 'grid', gap: '1rem', padding: '1.5rem' }}>
        {/* A plain GET form: the search lives in the URL, and works without JavaScript. */}
        <form method="get" action={here} style={{ display: 'flex', gap: '0.75rem', alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="nr-campo" style={{ flex: '1 1 14rem' }}>
            <label htmlFor="admin-q">{t('accounts.search')}</label>
            <input id="admin-q" name="q" type="search" defaultValue={search} maxLength={200} autoComplete="off" />
          </div>
          <div className="nr-campo">
            <label htmlFor="admin-filter">{t('accounts.filter')}</label>
            <select id="admin-filter" name="filter" defaultValue={filter} style={select}>
              {FILTERS.map((f) => (
                <option key={f} value={f}>
                  {t(`accounts.filters.${f}`)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="nr-btn nr-btn--primario">
            {t('accounts.searchButton')}
          </button>
        </form>

        <p className="nr-lead" role="status">
          {t('accounts.count', { count: total })}
        </p>
        {accounts.length === 0 ? (
          <p>{t('accounts.none')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {accounts.map((a) => (
              <li key={a.id} style={row}>
                <div style={{ display: 'grid', gap: '0.125rem', minWidth: 0 }}>
                  <a href={getPathname({ href: `/admin/users/${a.id}`, locale })} style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {a.email}
                  </a>
                  <small style={{ color: 'var(--nr-text-muted)', overflowWrap: 'anywhere' }}>
                    {[a.name, a.providers.join(', '), t('accounts.joined', { date: day(a.createdAt) }), a.lastLoginAt ? t('accounts.lastLogin', { date: day(a.lastLoginAt) }) : t('accounts.neverLoggedIn')]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </div>
                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                  {a.role === 'admin' && <AccountTag tone="neutral">{t('tags.admin')}</AccountTag>}
                  {a.agentsAllowed && <AccountTag tone="success">{t('tags.agents')}</AccountTag>}
                  {a.blockedAt && <AccountTag tone="danger">{t('tags.blocked')}</AccountTag>}
                </div>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <nav aria-label={t('accounts.page', { page, pages })} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            {page > 1 ? (
              <a className="nr-btn nr-btn--fantasma nr-btn--sm" href={pageHref(page - 1)} rel="prev">
                {t('accounts.previous')}
              </a>
            ) : (
              <span />
            )}
            <small>{t('accounts.page', { page, pages })}</small>
            {page < pages ? (
              <a className="nr-btn nr-btn--fantasma nr-btn--sm" href={pageHref(page + 1)} rel="next">
                {t('accounts.next')}
              </a>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </AdminShell>
  );
}
