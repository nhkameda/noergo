'use client';

import type { AdminAccountDetail } from '@noergo/core';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { endSessionsAction, revokeConnectionAction, revokeTokenAction, setAgentsAction, setBlockedAction, type AdminResult } from '@/app/[locale]/admin/actions';
import { Callout } from '@/components/agents/Callout';

const note = { margin: 0, fontSize: 'var(--nr-text-sm)', color: 'var(--nr-text-muted)' } as const;
const row = { display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '0.75rem 0', borderTop: '1px solid var(--nr-border)' } as const;

/** What an administrator can do to one account; the page reloads its data after each step. */
export function AccountActions({ account, self }: { account: AdminAccountDetail; self: boolean }) {
  const t = useTranslations('admin.account');
  const format = useFormatter();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'neutral' | 'danger'; text: string } | null>(null);

  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const used = (iso: string | null) => (iso ? t('lastUsed', { date: day(iso) }) : t('neverUsed'));

  async function act(run: () => Promise<AdminResult>, done?: string) {
    setBusy(true);
    setMessage(null);
    const r = await run();
    setBusy(false);
    if (!r.ok) return setMessage({ tone: 'danger', text: r.code === 'forbidden' ? t('forbidden') : t('failed') });
    if (done) setMessage({ tone: 'neutral', text: done });
    router.refresh();
  }

  const canBlock = !self && !account.listedAdmin;

  return (
    <>
      {message && (
        <Callout tone={message.tone} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </Callout>
      )}

      <section className="nr-card" style={{ display: 'grid', gap: '0.75rem', padding: '1.5rem', justifyItems: 'start' }}>
        <h2 className="nr-h3">{t('accessTitle')}</h2>
        <p style={{ margin: 0 }}>{account.blockedAt ? t('blockedSince', { date: day(account.blockedAt) }) : t('active')}</p>
        {self && <p style={note}>{t('you')}</p>}
        {account.listedAdmin && <p style={note}>{t('listedAdmin')}</p>}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {account.blockedAt ? (
            <button type="button" className="nr-btn nr-btn--primario" disabled={busy} onClick={() => act(() => setBlockedAction(account.id, false))}>
              {t('unblock')}
            </button>
          ) : (
            canBlock && (
              <button
                type="button"
                className="nr-btn nr-btn--perigo"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t('blockConfirm', { email: account.email }))) void act(() => setBlockedAction(account.id, true));
                }}
              >
                {t('block')}
              </button>
            )
          )}
          {!self && (
            <button
              type="button"
              className="nr-btn nr-btn--fantasma"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t('endSessionsConfirm', { email: account.email }))) void act(() => endSessionsAction(account.id), t('sessionsEnded'));
              }}
            >
              {t('endSessions')}
            </button>
          )}
        </div>
      </section>

      <section className="nr-card" style={{ display: 'grid', gap: '0.75rem', padding: '1.5rem' }}>
        <h2 className="nr-h3">{t('agentsTitle')}</h2>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <p style={{ margin: 0 }}>{account.agentsAllowed ? t('agentsOn') : t('agentsOff')}</p>
          <button type="button" className="nr-btn nr-btn--sm" disabled={busy} onClick={() => act(() => setAgentsAction(account.id, !account.agentsAllowed))}>
            {account.agentsAllowed ? t('denyAgents') : t('allowAgents')}
          </button>
        </div>
        <p style={note}>{t('agentsHint')}</p>

        <h3 style={{ fontSize: '1rem', margin: '0.5rem 0 0' }}>{t('connections')}</h3>
        {account.connections.length === 0 ? (
          <p style={note}>{t('noConnections')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {account.connections.map((c) => (
              <li key={c.id} style={row}>
                <div style={{ display: 'grid', gap: '0.125rem', minWidth: 0 }}>
                  <strong>{c.clientName}</strong>
                  <small style={{ overflowWrap: 'anywhere' }}>
                    {c.redirectHost} · {t('connectedAt', { date: day(c.createdAt) })} · {used(c.lastUsedAt)}
                  </small>
                </div>
                <button
                  type="button"
                  className="nr-btn nr-btn--perigo nr-btn--sm"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t('revokeConfirm', { name: c.clientName }))) void act(() => revokeConnectionAction(account.id, c.id));
                  }}
                >
                  {t('revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3 style={{ fontSize: '1rem', margin: '0.5rem 0 0' }}>{t('tokens')}</h3>
        {account.tokens.length === 0 ? (
          <p style={note}>{t('noTokens')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {account.tokens.map((k) => (
              <li key={k.id} style={row}>
                <div style={{ display: 'grid', gap: '0.125rem', minWidth: 0 }}>
                  <strong>{k.name}</strong>
                  <small>
                    <code>{k.prefix}…</code> · {t('createdAt', { date: day(k.createdAt) })} · {used(k.lastUsedAt)}
                  </small>
                </div>
                <button
                  type="button"
                  className="nr-btn nr-btn--perigo nr-btn--sm"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t('revokeConfirm', { name: k.name }))) void act(() => revokeTokenAction(account.id, k.id));
                  }}
                >
                  {t('revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
