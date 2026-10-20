'use client';

import type { AgentsMode, SettingSource, SettingsPatch, SignupMode } from '@noergo/core';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { saveSettingsAction } from '@/app/[locale]/admin/actions';
import { Callout } from '@/components/agents/Callout';

const MB = 1_048_576;

export interface SettingsView {
  /** null: inherited (the administrator has not saved one). */
  saved: { signup: SignupMode | null; allowlist: string[] | null; agents: AgentsMode | null };
  inherited: { signup: SignupMode; allowlist: string[]; agents: AgentsMode };
  inheritedSource: { signup: SettingSource; allowlist: SettingSource; agents: SettingSource };
  storageQuotaBytes: number;
}

const control = { width: '100%', minWidth: 0, minHeight: 44, padding: '0 0.75rem', borderRadius: 'var(--nr-radius-md)', border: '1px solid var(--nr-border-strong)', background: 'var(--nr-surface)', color: 'var(--nr-text)', font: 'inherit' } as const;

/** The instance's settings; each one can be handed back to the environment ("inherit"). */
export function SettingsForm({ view }: { view: SettingsView }) {
  const t = useTranslations('admin.settings');
  const router = useRouter();
  const [signup, setSignup] = useState<SignupMode | 'inherit'>(view.saved.signup ?? 'inherit');
  const [inheritList, setInheritList] = useState(view.saved.allowlist === null);
  const [list, setList] = useState((view.saved.allowlist ?? view.inherited.allowlist).join('\n'));
  const [agents, setAgents] = useState<AgentsMode | 'inherit'>(view.saved.agents ?? 'inherit');
  const [quota, setQuota] = useState(String(Math.round(view.storageQuotaBytes / MB)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'neutral' | 'danger'; text: string } | null>(null);

  const signupLabel = (m: SignupMode) => (m === 'open' ? t('signupOpen') : t('signupAllowlist'));
  const agentsLabel = (m: AgentsMode) => (m === 'all' ? t('agentsAll') : t('agentsGranted'));
  const from = (s: SettingSource) => t(`source.${s}`);

  async function save(e: FormEvent) {
    e.preventDefault();
    const mb = Number(quota);
    const patch: SettingsPatch = {
      signup: signup === 'inherit' ? null : signup,
      allowlist: inheritList
        ? null
        : list
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean),
      agents: agents === 'inherit' ? null : agents,
      storageQuotaBytes: Number.isFinite(mb) ? Math.round(mb * MB) : Number.NaN,
    };
    setBusy(true);
    setMessage(null);
    const r = await saveSettingsAction(patch);
    setBusy(false);
    if (!r.ok) return setMessage({ tone: 'danger', text: r.code === 'invalid' ? t('invalid') : t('failed') });
    setMessage({ tone: 'neutral', text: t('saved') });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="nr-card" style={{ display: 'grid', gap: '1.5rem', padding: '1.5rem' }}>
      <div className="nr-campo">
        <label htmlFor="settings-signup">{t('signup')}</label>
        <select id="settings-signup" value={signup} onChange={(e) => setSignup(e.target.value as SignupMode | 'inherit')} style={control}>
          <option value="inherit">
            {t('inherit', { value: signupLabel(view.inherited.signup) })} ({from(view.inheritedSource.signup)})
          </option>
          <option value="open">{t('signupOpen')}</option>
          <option value="allowlist">{t('signupAllowlist')}</option>
        </select>
      </div>

      <div className="nr-campo">
        <label htmlFor="settings-allowlist">{t('allowlist')}</label>
        <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            id="settings-allowlist-inherit"
            type="checkbox"
            checked={inheritList}
            onChange={(e) => {
              setInheritList(e.target.checked);
              if (e.target.checked) setList(view.inherited.allowlist.join('\n'));
            }}
            style={{ minHeight: 'auto', width: '1.125rem', height: '1.125rem', padding: 0 }}
          />
          <label htmlFor="settings-allowlist-inherit" style={{ fontWeight: 'normal' }}>
            {t('allowlistInherit')} ({from(view.inheritedSource.allowlist)})
          </label>
        </span>
        <textarea
          id="settings-allowlist"
          rows={6}
          value={list}
          disabled={inheritList}
          onChange={(e) => setList(e.target.value)}
          spellCheck={false}
          autoCapitalize="none"
          aria-describedby="settings-allowlist-hint"
          style={{ padding: '0.625rem 1rem', fontFamily: 'var(--nr-font-mono)', resize: 'vertical' }}
        />
        <small id="settings-allowlist-hint">
          {inheritList ? `${t('allowlistInherited', { count: view.inherited.allowlist.length })} ` : ''}
          {t('allowlistHint')}
        </small>
      </div>

      <div className="nr-campo">
        <label htmlFor="settings-agents">{t('agents')}</label>
        <select id="settings-agents" value={agents} onChange={(e) => setAgents(e.target.value as AgentsMode | 'inherit')} style={control}>
          <option value="inherit">
            {t('inherit', { value: agentsLabel(view.inherited.agents) })} ({from(view.inheritedSource.agents)})
          </option>
          <option value="all">{t('agentsAll')}</option>
          <option value="granted">{t('agentsGranted')}</option>
        </select>
      </div>

      <div className="nr-campo" style={{ maxWidth: '16rem' }}>
        <label htmlFor="settings-quota">{t('quota')}</label>
        <input id="settings-quota" type="number" inputMode="numeric" min={1} max={1_048_576} step={1} required value={quota} onChange={(e) => setQuota(e.target.value)} aria-describedby="settings-quota-hint" />
        <small id="settings-quota-hint">{t('quotaHint')}</small>
      </div>

      {message && (
        <Callout tone={message.tone} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </Callout>
      )}
      <button type="submit" className="nr-btn nr-btn--primario" disabled={busy} style={{ justifySelf: 'start' }}>
        {t('save')}
      </button>
    </form>
  );
}
