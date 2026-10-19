import { agentAccessAllowed, listAgentAccess } from '@noergo/core';
import type { Locale } from '@noergo/i18n';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { auth } from '@/auth';
import { AgentAccess, CopyField } from '@/components/agents/AgentAccess';
import { Callout } from '@/components/agents/Callout';
import { getPathname } from '@/i18n/navigation';
import { PUBLIC_URL } from '@/lib/env';
import { MCP_ACCESS } from '@/lib/mcp-bridge';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'agents' });
  return { title: t('pageTitle') };
}

const CLIENTS = ['grok', 'chatgpt', 'claude', 'claudeCode', 'cursor'] as const;

/** How to connect agents (public), and for the signed-in person their connections and tokens. */
export default async function AgentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations('agents');
  const url = `${PUBLIC_URL}/mcp`;
  const here = getPathname({ href: '/agents', locale });
  const app = getPathname({ href: '/app', locale });
  const signIn = getPathname({ href: { pathname: '/signin', query: { callbackUrl: here } }, locale });

  const userId = (await auth())?.user?.id ?? null;
  const [allowed, access] = userId ? await Promise.all([agentAccessAllowed(userId, MCP_ACCESS), listAgentAccess(userId)]) : [false, null];

  return (
    <main className="nr-tela" style={{ minHeight: '100vh', padding: 'clamp(1.5rem, 4vw, 3rem) 1rem' }}>
      <div style={{ display: 'grid', gap: '2rem', width: 'min(100%, 46rem)', marginInline: 'auto' }}>
        <header style={{ display: 'grid', gap: '0.75rem' }}>
          <a href={userId ? app : getPathname({ href: '/', locale })} style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', color: 'inherit', textDecoration: 'none' }}>
            <img src="/favicon.svg" alt="" width={28} height={28} />
            <span>{t('backToApp')}</span>
          </a>
          <h1 className="nr-h2">{t('title')}</h1>
          <p className="nr-lead">{t('lead')}</p>
        </header>

        <section className="nr-card" style={{ display: 'grid', gap: '0.75rem', padding: '1.5rem' }}>
          <CopyField label={t('serverUrl')} value={url} />
          {userId && !allowed && MCP_ACCESS === 'granted' && <Callout tone="warning">{t('early')}</Callout>}
        </section>

        <section style={{ display: 'grid', gap: '1rem' }}>
          <h2 className="nr-h3">{t('howTitle')}</h2>
          <dl style={{ display: 'grid', gap: '1rem', margin: 0 }}>
            {CLIENTS.map((c) => (
              <div key={c} className="nr-card" style={{ padding: '1rem 1.25rem', display: 'grid', gap: '0.375rem' }}>
                <dt style={{ fontWeight: 600 }}>{t(`clients.${c}.name`)}</dt>
                <dd style={{ margin: 0 }}>{t(`clients.${c}.steps`, { url })}</dd>
              </div>
            ))}
          </dl>
          <p className="nr-lead">
            <strong>{t('tryTitle')}:</strong> {t('try')}
          </p>
        </section>

        {access ? (
          <AgentAccess initial={access} canCreate={allowed} />
        ) : (
          <section className="nr-card" style={{ display: 'grid', gap: '0.75rem', padding: '1.5rem', justifyItems: 'start' }}>
            <p>{t('signInToManage')}</p>
            <a className="nr-btn nr-btn--primario" href={signIn}>
              {t('signIn')}
            </a>
          </section>
        )}
      </div>
    </main>
  );
}
