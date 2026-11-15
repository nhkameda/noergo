'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { ShareTarget } from './context';
import { openPanel } from './Customize';
import { IconCheck, IconClose, IconLink } from './icons';

type Access = 'view' | 'edit';
interface Live {
  id: string;
  url: string;
}
type Links = Record<Access, Live | null>;

export interface ShareTargetAt extends ShareTarget {
  anchor: DOMRect;
}

/**
 * Sharing a board or a thought by link: pick what whoever holds it may do (look, or also
 * change), make the link and copy it, or turn it off. Each access has its own link, so a
 * view link can go to many people and an edit link to a few.
 */
export function SharePanel({ target, onClose }: { target: ShareTargetAt; onClose: () => void }) {
  const t = useTranslations('app.share');
  const tApp = useTranslations('app');
  const panel = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [links, setLinks] = useState<Links | null>(null);
  const [access, setAccess] = useState<Access>('view');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [said, setSaid] = useState<'failed' | 'off' | null>(null);
  const close = () => panel.current?.hidePopover();

  useLayoutEffect(() => {
    const p = panel.current;
    if (!p) return;
    openPanel(p, target.anchor, 'below');
    p.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }, [target.anchor]);

  const closed = useEffectEvent(() => onClose());
  useEffect(() => {
    const p = panel.current;
    if (!p) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'closed') closed();
    };
    p.addEventListener('toggle', onToggle);
    return () => p.removeEventListener('toggle', onToggle);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/shares?kind=${target.kind}&id=${encodeURIComponent(target.id)}`, { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const { shares } = (await res.json()) as { shares: Array<Live & { access: Access }> };
        const next: Links = { view: null, edit: null };
        for (const s of shares) next[s.access] = { id: s.id, url: s.url };
        setLinks(next);
        // Opened again on something shared only for editing: show that link.
        if (!next.view && next.edit) setAccess('edit');
      })
      .catch(() => {
        if (!ctrl.signal.aborted) {
          setLinks({ view: null, edit: null });
          setSaid('failed');
        }
      });
    return () => ctrl.abort();
  }, [target.kind, target.id]);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
    } catch {
      // No clipboard (an old browser, a denied permission): the link is selected to copy by hand.
      field.current?.select();
    }
  };

  const create = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const res = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: target.kind, id: target.id, access }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(String(res.status));
      const { share } = (await res.json()) as { share: Live };
      setLinks((cur) => ({ ...(cur ?? { view: null, edit: null }), [access]: { id: share.id, url: share.url } }));
      await copy(share.url);
    } catch {
      setSaid('failed');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async (live: Live) => {
    setBusy(true);
    setSaid(null);
    try {
      const res = await fetch(`/api/shares/${encodeURIComponent(live.id)}`, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
      setLinks((cur) => ({ ...(cur ?? { view: null, edit: null }), [access]: null }));
      setCopied(null);
      setSaid('off');
    } catch {
      setSaid('failed');
    } finally {
      setBusy(false);
    }
  };

  const live = links?.[access] ?? null;
  const what = target.kind === 'board' ? 'board' : 'thought';

  return (
    <div ref={panel} popover="auto" className="w-customize w-share" role="dialog" aria-labelledby="w-share-kicker w-share-title" data-share={target.id}>
      <header className="w-customize__head">
        <div className="w-customize__names">
          <h2 id="w-share-kicker" className="w-customize__kicker">
            {t(`kicker.${what}`)}
          </h2>
          <p id="w-share-title" className="w-share__title">
            {target.title}
          </p>
        </div>
        <button type="button" className="w-icon-btn" onClick={close} aria-label={tApp('close')} title={tApp('close')}>
          <IconClose />
        </button>
      </header>

      <section className="w-customize__section">
        <h3 className="w-customize__label">{t('access')}</h3>
        <div className="nr-visoes w-share__access" role="group" aria-label={t('access')}>
          {(['view', 'edit'] as const).map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={access === a}
              onClick={() => {
                setAccess(a);
                setSaid(null);
              }}
            >
              {t(`as.${a}`)}
              {links?.[a] && <span className="w-share__on" aria-label={t('on')} title={t('on')} />}
            </button>
          ))}
        </div>
        <p className="w-customize__hint">{t(`hint.${access}.${what}`)}</p>
      </section>

      {links === null ? (
        <p className="w-muted" role="status">
          {tApp('loading')}
        </p>
      ) : live ? (
        <section className="w-customize__section">
          <label className="w-customize__label" htmlFor="w-share-url">
            {t('link')}
          </label>
          <div className="w-share__row">
            <input id="w-share-url" ref={field} className="w-input w-share__url" value={live.url} readOnly onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="nr-btn nr-btn--sm nr-btn--primario w-share__copy" onClick={() => void copy(live.url)}>
              {copied === live.url ? <IconCheck /> : <IconLink />}
              {copied === live.url ? t('copied') : t('copy')}
            </button>
          </div>
          <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma w-customize__danger w-share__off" disabled={busy} onClick={() => void turnOff(live)}>
            {t('turnOff')}
          </button>
        </section>
      ) : (
        <section className="w-customize__section">
          <button type="button" className="nr-btn nr-btn--primario w-share__make" disabled={busy} onClick={() => void create()}>
            <IconLink />
            {t(`make.${access}`)}
          </button>
        </section>
      )}

      <p className="w-customize__hint" role="status">
        {said === 'failed' ? <span className="w-customize__error">{t('failed')}</span> : said === 'off' ? t('turnedOff') : copied && live && copied === live.url ? t('copiedHint') : ''}
      </p>
    </div>
  );
}
