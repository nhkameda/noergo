import { adminEmails, envSettings, instanceSettings, type SettingSource } from '@noergo/core';
import type { Locale } from '@noergo/i18n';
import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminShell } from '@/components/admin/AdminShell';
import { SettingsForm, type SettingsView } from '@/components/admin/SettingsForm';
import { requireAdmin } from '@/lib/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

/** Who may sign up, who may connect agents, how much each account may store. */
export default async function AdminSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdmin();
  const t = await getTranslations('admin.settings');
  const format = await getFormatter();
  const s = await instanceSettings();
  const env = envSettings();
  const fromEnv = (v: unknown): SettingSource => (v !== undefined ? 'env' : 'default');
  const view: SettingsView = {
    saved: {
      signup: s.source.signup === 'admin' ? s.signup : null,
      allowlist: s.source.allowlist === 'admin' ? s.allowlist : null,
      agents: s.source.agents === 'admin' ? s.agents : null,
    },
    inherited: s.inherited,
    inheritedSource: { signup: fromEnv(env.signup), allowlist: fromEnv(env.allowlist), agents: fromEnv(env.agents) },
    storageQuotaBytes: s.storageQuotaBytes,
  };
  const admins = adminEmails();

  return (
    <AdminShell locale={locale} section="settings">
      <p className="nr-lead">{t('lead')}</p>
      <SettingsForm view={view} />
      <section className="nr-card" style={{ display: 'grid', gap: '0.5rem', padding: '1.5rem' }}>
        <h2 className="nr-h3">{t('admins')}</h2>
        <ul style={{ margin: 0, paddingInlineStart: '1.25rem' }}>
          {admins.map((a) => (
            <li key={a} style={{ overflowWrap: 'anywhere' }}>
              {a}
            </li>
          ))}
        </ul>
        <p style={{ margin: 0, fontSize: 'var(--nr-text-sm)', color: 'var(--nr-text-muted)' }}>{t('adminsHint')}</p>
      </section>
      <p style={{ margin: 0, fontSize: 'var(--nr-text-sm)', color: 'var(--nr-text-muted)' }}>
        {t('updated', { date: format.dateTime(s.updatedAt, { dateStyle: 'medium' }) })}
      </p>
    </AdminShell>
  );
}
