import { isAdmin, personalWorkspaceId } from '@noergo/core';
import { notFound } from 'next/navigation';
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

/**
 * The administrator behind a request, or null: role admin, not blocked, and still on
 * NOERGO_ADMIN_EMAILS now (core isAdmin). Every admin page and every admin action asks;
 * a layout is not a boundary.
 */
export async function currentAdmin(): Promise<string | null> {
  const id = (await auth())?.user?.id;
  return id && (await isAdmin(id)) ? id : null;
}

/** The administrator of an admin page; anyone else gets a 404, as if the page did not exist. */
export async function requireAdmin(): Promise<string> {
  const id = await currentAdmin();
  if (!id) notFound();
  return id;
}
