import type { ReactNode } from 'react';

const TONES = {
  neutral: { background: 'var(--nr-fill-hover)', color: 'var(--nr-text)' },
  warning: { background: 'var(--nr-warning-tint)', color: 'var(--nr-warning-text)' },
  danger: { background: 'var(--nr-danger-tint)', color: 'var(--nr-danger-text)' },
} as const;

/** A note in the flow of the page (`nr-aviso` is the floating toast). */
export function Callout({ tone = 'neutral', role, children }: { tone?: keyof typeof TONES; role?: 'alert' | 'status'; children: ReactNode }) {
  return (
    <div role={role} style={{ ...TONES[tone], display: 'grid', gap: '0.5rem', padding: '0.75rem 1rem', borderRadius: 'var(--nr-radius-md)', fontSize: 'var(--nr-text-sm)' }}>
      {children}
    </div>
  );
}
