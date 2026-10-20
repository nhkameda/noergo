import { z } from 'zod';
import { getDb, type Db } from './db';

/** Who may create an account: anyone, or the addresses and domains on the list. */
export type SignupMode = 'open' | 'allowlist';

/**
 * Who may connect agents. `all`: every account. `granted`: administrators and the
 * accounts an administrator enabled (`users.agents_allowed`).
 */
export type AgentsMode = 'all' | 'granted';

/** Where a setting's value comes from: saved by an administrator, the environment, or noergo's default. */
export type SettingSource = 'admin' | 'env' | 'default';

export const DEFAULT_STORAGE_QUOTA_BYTES = 262_144_000; // 250 MB

export interface InstanceSettings {
  signup: SignupMode;
  /** E-mails or "@domain" entries; the administrators are always allowed on top of these. */
  allowlist: string[];
  agents: AgentsMode;
  /** Attachments per account, unless an account has its own quota. */
  storageQuotaBytes: number;
  source: { signup: SettingSource; allowlist: SettingSource; agents: SettingSource };
  /** What applies when the administrator hands a setting back (the environment, else the default). */
  inherited: { signup: SignupMode; allowlist: string[]; agents: AgentsMode };
  updatedAt: Date;
}

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** The administrators' e-mails. Only the environment names them, so no screen can promote anyone or lock them out. */
export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return list(env.NOERGO_ADMIN_EMAILS);
}

interface EnvSettings {
  signup: SignupMode | undefined;
  allowlist: string[] | undefined;
  agents: AgentsMode | undefined;
}

/**
 * SIGNUP, SIGNUP_ALLOWLIST and MCP_ACCESS: the values a new instance starts with, until an
 * administrator saves its own. Read at boot too, so a typo stops the process instead of
 * opening the instance.
 */
export function envSettings(env: NodeJS.ProcessEnv = process.env): EnvSettings {
  const signup = env.SIGNUP || undefined;
  if (signup !== undefined && signup !== 'open' && signup !== 'allowlist') throw new Error(`SIGNUP must be "open" or "allowlist", not "${signup}"`);
  const agents = env.MCP_ACCESS || undefined;
  if (agents !== undefined && agents !== 'all' && agents !== 'granted') throw new Error(`MCP_ACCESS must be "all" or "granted", not "${agents}"`);
  return { signup, allowlist: env.SIGNUP_ALLOWLIST === undefined ? undefined : list(env.SIGNUP_ALLOWLIST), agents };
}

/**
 * The settings in force: what an administrator saved, else the environment, else the
 * default. Unset, an instance is closed to sign-ups (only the administrators get in): one
 * put on the internet must not become a free notes service for whoever finds it.
 */
export async function instanceSettings(db: Db = getDb(), env: NodeJS.ProcessEnv = process.env): Promise<InstanceSettings> {
  const row = await db.selectFrom('settings').selectAll().executeTakeFirstOrThrow();
  const e = envSettings(env);
  const inherited = { signup: e.signup ?? 'allowlist', allowlist: e.allowlist ?? [], agents: e.agents ?? 'all' };
  const source = <T>(saved: T | null, fromEnv: T | undefined): SettingSource => (saved !== null ? 'admin' : fromEnv !== undefined ? 'env' : 'default');
  return {
    signup: row.signup ?? inherited.signup,
    allowlist: row.signup_allowlist ?? inherited.allowlist,
    agents: row.agents ?? inherited.agents,
    storageQuotaBytes: Number(row.storage_quota_bytes),
    source: { signup: source(row.signup, e.signup), allowlist: source(row.signup_allowlist, e.allowlist), agents: source(row.agents, e.agents) },
    inherited,
    updatedAt: row.updated_at,
  };
}

const allowlistEntry = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^(?:[^\s@,]+@|@)[^\s@,]+\.[^\s@,]+$/, 'an e-mail address, or @ and a domain');

/** A change to the settings (admin.ts saves it); null puts a setting back to what the environment says. */
export const settingsPatchSchema = z
  .object({
    signup: z.enum(['open', 'allowlist']).nullable(),
    allowlist: z.array(allowlistEntry).max(1000).nullable(),
    agents: z.enum(['all', 'granted']).nullable(),
    storageQuotaBytes: z
      .number()
      .int()
      .min(1_048_576)
      .max(1_099_511_627_776), // 1 MB to 1 TB
  })
  .partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Back to the environment and the defaults: what a fresh instance has. For tests and scripts; no administrator is checked. */
export async function resetSettings(db: Db = getDb()): Promise<void> {
  await db
    .updateTable('settings')
    .set({ signup: null, signup_allowlist: null, agents: null, storage_quota_bytes: DEFAULT_STORAGE_QUOTA_BYTES, updated_at: new Date(), updated_by: null })
    .execute();
}
