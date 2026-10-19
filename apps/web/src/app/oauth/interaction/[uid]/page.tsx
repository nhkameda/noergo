import { agentAccessAllowed } from '@noergo/core';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { auth } from '@/auth';
import { Callout } from '@/components/agents/Callout';
import { ConsentForm } from '@/components/agents/ConsentForm';
import { PREFIX } from '@/i18n/routing';
import { consentLocale } from '@/lib/consent';
import { INTERACTION_UID, interactionBridge, interactionCookies, MCP_ACCESS, type InteractionView } from '@/lib/mcp-bridge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: await consentLocale(), namespace: 'consent' });
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

/**
 * The consent page of the agents' OAuth server (apps/mcp). The person must be signed in to
 * noergo right now; what they approve is told by mcp, which holds the interaction.
 */
export default async function ConsentPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  if (!INTERACTION_UID.test(uid)) notFound();
  const locale = await consentLocale();
  setRequestLocale(locale);
  const t = await getTranslations('consent');
  const here = `/oauth/interaction/${uid}`;

  const session = await auth();
  if (!session?.user?.id) redirect(`/${PREFIX[locale]}/signin?callbackUrl=${encodeURIComponent(here)}`);

  const cookieHeader = (await cookies()).getAll().map((c) => `${c.name}=${c.value}`).join('; ');
  const { status, data: view } = await interactionBridge<InteractionView>('GET', `/internal/interaction/${uid}`, interactionCookies(cookieHeader));
  const home = `/${PREFIX[locale]}/app`;

  if (status !== 200 || !view) {
    return (
      <Shell>
        <h1 className="nr-h3">{t('expiredTitle')}</h1>
        <p className="nr-lead">{t('expired')}</p>
        <a className="nr-btn nr-btn--fantasma" href={home}>
          {t('back')}
        </a>
      </Shell>
    );
  }

  const allowed = await agentAccessAllowed(session.user.id, MCP_ACCESS);
  const name = view.client.name.trim() || t('unnamed');
  const identifiedBy = view.client.metadataDocument ? URL.parse(view.client.id)?.host : null;

  return (
    <Shell>
      <h1 className="nr-h3">{t('title', { client: name })}</h1>
      {identifiedBy ? <p>{t('identifiedBy', { host: identifiedBy })}</p> : <Callout tone="warning">{t('unverified')}</Callout>}
      <p style={{ color: 'var(--nr-text-muted)' }}>{t('returnsTo', { host: view.redirectHost || '—' })}</p>
      {allowed ? (
        <>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <h2 className="nr-h3" style={{ fontSize: '1rem' }}>
              {t('canTitle')}
            </h2>
            <ul style={{ margin: 0, paddingInlineStart: '1.25rem', display: 'grid', gap: '0.25rem' }}>
              <li>{t('canRead')}</li>
              {view.wantsWrite && <li>{t('canWrite')}</li>}
            </ul>
          </div>
          <ConsentForm uid={uid} wantsWrite={view.wantsWrite} allowed />
          <p className="nr-lead" style={{ fontSize: '0.875rem' }}>
            {t('later')}
          </p>
        </>
      ) : (
        <>
          <Callout tone="warning" role="alert">
            <span>
              <strong>{t('earlyTitle')}.</strong> {t('early')}
            </span>
          </Callout>
          <ConsentForm uid={uid} wantsWrite={false} allowed={false} />
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="nr-tela" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '2rem 1rem' }}>
      <section className="nr-card" style={{ display: 'grid', gap: '1rem', width: 'min(100%, 28rem)', padding: '2rem' }}>
        <img src="/favicon.svg" alt="" width={40} height={40} />
        {children}
      </section>
    </main>
  );
}
