import { personalWorkspaceId } from '@noergo/core';
import { getLocale } from 'next-intl/server';
import { auth } from '@/auth';
import { redirect } from '@/i18n/navigation';

export interface SignedIn {
  userId: string;
  role: 'user' | 'admin';
  workspaceId: string;
}

/** The signed-in user of a page, or a redirect to sign in that comes back here. */
export async function requireUser(returnTo: string): Promise<SignedIn> {
  const session = await auth();
  const locale = await getLocale();
  if (!session?.user?.id) return redirect({ href: { pathname: '/signin', query: { callbackUrl: returnTo } }, locale });
  const workspaceId = await personalWorkspaceId(session.user.id);
  // Sign-in creates the workspace in the same transaction as the account.
  if (!workspaceId) throw new Error('signed-in user without a workspace');
  return { userId: session.user.id, role: session.user.role, workspaceId };
}
