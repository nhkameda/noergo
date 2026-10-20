import type { Locale } from '@noergo/i18n';
import { getTranslations } from 'next-intl/server';
import type { CSSProperties, ReactNode } from 'react';
import { getPathname } from '@/i18n/navigation';

/** The frame of the admin pages: the way back to the app, the title and the two sections. */
export async function AdminShell({ locale, section, children }: { locale: Locale; section: 'accounts' | 'settings'; children: ReactNode }) {
  const t = await getTranslations('admin');
  const href = (path: string) => getPathname({ href: path, locale });
  return (
    <main className="nr-tela" style={{ minHeight: '100vh', padding: 'clamp(1.5rem, 4vw, 3rem) 1rem' }}>
      <div style={{ display: 'grid', gap: '1.5rem', width: 'min(100%, 52rem)', marginInline: 'auto' }}>
        <header style={{ display: 'grid', gap: '0.75rem' }}>
          <a href={href('/app')} style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', color: 'inherit', textDecoration: 'none' }}>
            <img src="/favicon.svg" alt="" width={28} height={28} />
            <span>{t('backToApp')}</span>
          </a>
          <h1 className="nr-h2">{t('title')}</h1>
          <nav className="nr-visoes" aria-label={t('title')} style={{ justifySelf: 'start' }}>
            <a href={href('/admin')} aria-current={section === 'accounts' ? 'page' : undefined}>
              {t('nav.accounts')}
            </a>
            <a href={href('/admin/settings')} aria-current={section === 'settings' ? 'page' : undefined}>
              {t('nav.settings')}
            </a>
          </nav>
        </header>
        {children}
      </div>
    </main>
  );
}

/** A small label next to an account: administrator, blocked, agents enabled. */
export function AccountTag({ tone, children }: { tone: 'neutral' | 'danger' | 'success'; children: ReactNode }) {
  const colours =
    tone === 'danger'
      ? { '--c': 'var(--nr-danger)', '--c-tint': 'var(--nr-danger-tint)', '--c-ink': 'var(--nr-danger-text)' }
      : tone === 'success'
        ? { '--c': 'var(--nr-success)', '--c-tint': 'var(--nr-success-tint)', '--c-ink': 'var(--nr-success-text)' }
        : {};
  return (
    <span className="nr-tag" style={colours as CSSProperties}>
      {children}
    </span>
  );
}
