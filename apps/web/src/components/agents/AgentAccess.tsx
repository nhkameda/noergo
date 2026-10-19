'use client';

import type { ConnectionDto, TokenDto } from '@noergo/core';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { createTokenAction, disconnectAction, revokeTokenAction } from '@/app/[locale]/agents/actions';
import { Callout } from './Callout';

export function CopyField({ label, value, id = 'nr-copy' }: { label: string; value: string; id?: string }) {
  const t = useTranslations('agents');
  const [copied, setCopied] = useState(false);
  return (
    <div className="nr-campo">
      <label htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input id={id} readOnly value={value} onFocus={(e) => e.currentTarget.select()} style={{ flex: '1 1 16rem', fontFamily: 'var(--nr-font-mono)' }} />
        <button
          type="button"
          className="nr-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
    </div>
  );
}

const row = { display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '0.75rem 0', borderTop: '1px solid var(--nr-border)' } as const;

/** Connected agents and personal tokens of the signed-in person: list, create, revoke. */
export function AgentAccess({ initial, canCreate }: { initial: { connections: ConnectionDto[]; tokens: TokenDto[] }; canCreate: boolean }) {
  const t = useTranslations('agents');
  const format = useFormatter();
  const [connections, setConnections] = useState(initial.connections);
  const [tokens, setTokens] = useState(initial.tokens);
  const [name, setName] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Day only: dates render in UTC on server and browser alike, so a clock time would be off.
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const used = (iso: string | null) => (iso ? t('lastUsed', { date: when(iso) }) : t('neverUsed'));
  const fail = (code: string) => setError(code === 'limit_reached' ? t('limit') : code === 'plan_required' ? t('early') : t('failed'));

  return (
    <>
      <section className="nr-card" style={{ display: 'grid', gap: '0.5rem', padding: '1.5rem' }}>
        <h2 className="nr-h3">{t('connectedTitle')}</h2>
        {connections.length === 0 && <p className="nr-lead">{t('none')}</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {connections.map((c) => (
            <li key={c.id} style={row}>
              <div style={{ display: 'grid', gap: '0.125rem' }}>
                <strong>
                  {c.clientName} {c.readOnly && <span className="nr-tag nr-tag--sem-ponto">{t('readOnlyBadge')}</span>}
                </strong>
                <small>
                  {c.redirectHost} · {t('connectedAt', { date: when(c.createdAt) })} · {used(c.lastUsedAt)}
                </small>
              </div>
              <button
                type="button"
                className="nr-btn nr-btn--perigo nr-btn--sm"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(t('disconnectConfirm', { name: c.clientName }))) return;
                  setBusy(true);
                  const r = await disconnectAction(c.id);
                  setBusy(false);
                  if (r.ok) setConnections((list) => list.filter((x) => x.id !== c.id));
                  else fail(r.code);
                }}
              >
                {t('disconnect')}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="nr-card" style={{ display: 'grid', gap: '0.75rem', padding: '1.5rem' }}>
        <h2 className="nr-h3">{t('tokensTitle')}</h2>
        <p className="nr-lead">{t('tokensLead')}</p>
        {canCreate && (
          <form
            style={{ display: 'flex', gap: '0.75rem', alignItems: 'end', flexWrap: 'wrap' }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              setBusy(true);
              setError(null);
              const r = await createTokenAction(name, readOnly);
              setBusy(false);
              if (!r.ok) return fail(r.code);
              setTokens((list) => [r.info, ...list]);
              setFresh(r.token);
              setName('');
            }}
          >
            <div className="nr-campo" style={{ flex: '1 1 12rem' }}>
              <label htmlFor="nr-token-name">{t('tokenName')}</label>
              <input id="nr-token-name" value={name} maxLength={100} placeholder={t('tokenNamePlaceholder')} onChange={(e) => setName(e.target.value)} required />
            </div>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minHeight: '2.5rem' }}>
              <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
              {t('tokenReadOnly')}
            </label>
            <button type="submit" className="nr-btn nr-btn--primario" disabled={busy || !name.trim()}>
              {t('create')}
            </button>
          </form>
        )}
        {fresh && (
          <Callout role="status">
            <strong>{t('tokenShown')}</strong>
            <CopyField id="nr-token" label={t('tokensTitle')} value={fresh} />
          </Callout>
        )}
        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}
        {tokens.length === 0 && <p className="nr-lead">{t('noTokens')}</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {tokens.map((k) => (
            <li key={k.id} style={row}>
              <div style={{ display: 'grid', gap: '0.125rem' }}>
                <strong>
                  {k.name} {k.readOnly && <span className="nr-tag nr-tag--sem-ponto">{t('readOnlyBadge')}</span>}
                </strong>
                <small>
                  <code>{k.prefix}…</code> · {t('createdAt', { date: when(k.createdAt) })} · {used(k.lastUsedAt)}
                </small>
              </div>
              <button
                type="button"
                className="nr-btn nr-btn--perigo nr-btn--sm"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(t('revokeConfirm', { name: k.name }))) return;
                  setBusy(true);
                  const r = await revokeTokenAction(k.id);
                  setBusy(false);
                  if (r.ok) setTokens((list) => list.filter((x) => x.id !== k.id));
                  else fail(r.code);
                }}
              >
                {t('revoke')}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
