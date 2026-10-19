'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Callout } from './Callout';

/**
 * Approves with fetch + location, not a form POST: CSP form-action 'self' would block the
 * redirect on to the agent (CLAUDE.md, Web).
 */
export function ConsentForm({ uid, wantsWrite, allowed }: { uid: string; wantsWrite: boolean; allowed: boolean }) {
  const t = useTranslations('consent');
  const [readOnly, setReadOnly] = useState(!wantsWrite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = async (action: 'confirm' | 'abort') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/oauth/interaction/${uid}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'confirm' ? { readOnly } : {}),
      });
      const data = (await res.json().catch(() => null)) as { location?: string; error?: { code?: string } } | null;
      if (res.ok && data?.location) return window.location.assign(data.location);
      setError(data?.error?.code === 'interaction_expired' ? t('expired') : t('failed'));
    } catch {
      setError(t('failed'));
    }
    setBusy(false);
  };

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {allowed && wantsWrite && (
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} disabled={busy} />
          {t('readOnly')}
        </label>
      )}
      {error && (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      )}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {allowed && (
          <button type="button" className="nr-btn nr-btn--primario nr-btn--lg" disabled={busy} onClick={() => void answer('confirm')}>
            {busy ? t('working') : t('allow')}
          </button>
        )}
        <button type="button" className="nr-btn nr-btn--fantasma nr-btn--lg" disabled={busy} onClick={() => void answer('abort')}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
