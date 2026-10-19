import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { consentLocale } from '@/lib/consent';
import { cspNonce } from '@/lib/csp';
import '../globals.css';

export default async function OAuthLayout({ children }: { children: ReactNode }) {
  const locale = await consentLocale();
  setRequestLocale(locale);
  await cspNonce();
  return (
    <html lang={locale}>
      <body className="nr-base">
        <NextIntlClientProvider locale={locale}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
