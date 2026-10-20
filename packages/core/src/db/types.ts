import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/**
 * Kysely table types. Hand-written to mirror migrations/*.sql — the SQL is the source
 * of truth; when a migration changes a table, change it here in the same commit.
 */

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
type Defaulted<T> = ColumnType<T, T | undefined, T>;

export type Locale = 'pt-BR' | 'en' | 'zh-CN';
export type NoteKind = 'text' | 'image' | 'link' | 'file';
export type NodeKind = 'note' | 'lane' | 'board';
export type ViewKind = 'lane_map' | 'board_map' | 'graph';
export type ActorKind = 'user' | 'agent' | 'token' | 'system';
export type SubscriptionStatus = 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'INCOMPLETE' | 'CANCELED' | 'SUSPENDED';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  email_verified_at: Timestamp | null;
  name: Defaulted<string>;
  image: string | null;
  locale: Defaulted<Locale>;
  role: Defaulted<'user' | 'admin'>;
  session_epoch: Defaulted<number>;
  admin_unlimited: Defaulted<boolean>;
  trial_used_at: Timestamp | null;
  terms_version: string | null;
  terms_accepted_at: Timestamp | null;
  signup_country: string | null;
  created_at: CreatedAt;
  updated_at: Defaulted<Date>;
  deleted_at: Timestamp | null;
}

export interface AccountsTable {
  id: Generated<string>;
  user_id: string;
  provider: string;
  provider_account_id: string;
  created_at: CreatedAt;
  last_login_at: Timestamp | null;
}

export interface EmailCodesTable {
  id: Generated<string>;
  email: string;
  code_hash: Buffer;
  attempts: Defaulted<number>;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface WorkspacesTable {
  id: Generated<string>;
  owner_id: string;
  name: Defaulted<string>;
  seq: Defaulted<number>;
  note_count: Defaulted<number>;
  storage_bytes: Defaulted<number>;
  storage_quota_bytes: number;
  inbox_lane_id: string | null;
  created_at: CreatedAt;
  updated_at: Defaulted<Date>;
}

export interface WorkspaceMembersTable {
  workspace_id: string;
  user_id: string;
  role: Defaulted<'owner' | 'editor' | 'viewer'>;
  created_at: CreatedAt;
}

export interface AgentConnectionsTable {
  id: Generated<string>;
  user_id: string;
  workspace_id: string;
  client_id: string;
  grant_id: string;
  client_name: Defaulted<string>;
  redirect_host: Defaulted<string>;
  scopes: Defaulted<string[]>;
  read_only: Defaulted<boolean>;
  created_at: CreatedAt;
  last_used_at: Timestamp | null;
  revoked_at: Timestamp | null;
}

export interface ApiTokensTable {
  id: Generated<string>;
  user_id: string;
  workspace_id: string;
  name: string;
  prefix: string;
  token_hash: Buffer;
  scopes: Defaulted<string[]>;
  read_only: Defaulted<boolean>;
  expires_at: Timestamp | null;
  created_at: CreatedAt;
  last_used_at: Timestamp | null;
  revoked_at: Timestamp | null;
}

export interface OidcPayloadsTable {
  id: string;
  type: string;
  payload: ColumnType<Record<string, unknown>, string, string>;
  grant_id: string | null;
  user_code: string | null;
  uid: string | null;
  expires_at: Timestamp | null;
  consumed_at: Timestamp | null;
}

export interface ActorsTable {
  id: Generated<string>;
  workspace_id: string;
  kind: ActorKind;
  user_id: string | null;
  connection_id: string | null;
  token_id: string | null;
  label: Defaulted<string>;
  created_at: CreatedAt;
}

interface Versioned {
  version: Defaulted<number>;
  created_by: string | null;
  updated_by: string | null;
  created_at: CreatedAt;
  updated_at: Defaulted<Date>;
  deleted_at: Timestamp | null;
}

export interface BoardsTable extends Versioned {
  id: string;
  workspace_id: string;
  title: string;
  color: string | null;
  /** One emoji or a line icon's name (`BOARD_ICONS`), before the title in the tab. */
  icon: Defaulted<string | null>;
  /** The colour behind the board's thoughts. */
  background: Defaulted<string | null>;
  position: string;
}

export interface LanesTable extends Versioned {
  id: string;
  workspace_id: string;
  board_id: string;
  title: string;
  color: string | null;
  position: string;
  cover_id: Defaulted<string | null>;
  cover: ColumnType<CoverFrame | null, string | null | undefined, string | null>;
  /** The thought's website, absolute http(s). */
  url: Defaulted<string | null>;
}

/** How a column's cover image sits in its 3:1 frame (lanes.cover). */
export interface CoverFrame {
  /** The point of the image (0..1 of its width and height) at the centre of the frame. */
  x: number;
  y: number;
  /** 1 shows the whole image; 2 is twice as large. */
  z: number;
  /** The image's own size, in pixels. */
  w: number;
  h: number;
  /** What shows around the image: its edge colour, or null for the column's colour. */
  bg: string | null;
}

export interface NotesTable extends Versioned {
  id: string;
  workspace_id: string;
  lane_id: string;
  position: string;
  kind: Defaulted<NoteKind>;
  title: Defaulted<string>;
  body: Defaulted<string>;
  url: string | null;
  attachment_id: string | null;
  color: string | null;
  tags: Defaulted<string[]>;
  done_at: Timestamp | null;
  due_at: Timestamp | null;
  fts: ColumnType<string | null, never, never>;
}

export interface LinksTable extends Versioned {
  id: string;
  workspace_id: string;
  from_kind: NodeKind;
  from_id: string;
  to_kind: NodeKind;
  to_id: string;
  origin: Defaulted<'manual' | 'wikilink'>;
  label: Defaulted<string>;
  style: ColumnType<LinkStyle, string | undefined, string>;
}

export interface LinkStyle {
  color?: string | null;
  width?: 1 | 2 | 3 | 5;
  dash?: 'solid' | 'dashed' | 'dotted';
  route?: 'curve' | 'straight' | 'elbow';
  arrow?: 'none' | 'end' | 'start' | 'both';
}

export interface UnresolvedWikilinksTable {
  workspace_id: string;
  note_id: string;
  title_lower: string;
}

export interface NodeLayoutsTable {
  workspace_id: string;
  view_kind: ViewKind;
  view_id: string;
  node_kind: NodeKind;
  node_id: string;
  x: number;
  y: number;
  shape: Defaulted<'pill' | 'rounded' | 'rect' | 'ellipse' | 'diamond' | 'plain'>;
  fill: Defaulted<'solid' | 'soft' | 'outline'>;
  size: Defaulted<'s' | 'm' | 'l'>;
  color: string | null;
  version: Defaulted<number>;
  updated_at: Defaulted<Date>;
}

export interface AttachmentsTable {
  id: string;
  workspace_id: string;
  storage_key: string;
  status: Defaulted<'pending' | 'ready' | 'rejected'>;
  mime: string;
  size_bytes: number;
  sha256: string | null;
  name: Defaulted<string>;
  width: number | null;
  height: number | null;
  content: Defaulted<Buffer | null>;
  created_by: string | null;
  created_at: CreatedAt;
  updated_at: Defaulted<Date>;
  deleted_at: Timestamp | null;
}

export interface NoteRevisionsTable {
  id: Generated<string>;
  workspace_id: string;
  note_id: string;
  version: number;
  title: string;
  body: string;
  tags: string[];
  actor_id: string | null;
  created_at: CreatedAt;
}

export interface ChangesTable {
  workspace_id: string;
  seq: number;
  actor_id: string | null;
  op_id: string | null;
  op: string;
  entity_kind: string;
  entity_id: string;
  effects: ColumnType<unknown, string, string>;
  reverted_by_seq: number | null;
  created_at: CreatedAt;
}

export interface OpReceiptsTable {
  workspace_id: string;
  op_id: string;
  result: ColumnType<unknown, string, string>;
  created_at: CreatedAt;
}

export interface PlansTable {
  id: string;
  name: string;
  price_usd_cents: number;
  billing_interval: 'month' | 'year';
  trial_days: number;
  stripe_price_id: string | null;
  storage_quota_bytes: number;
  mcp_enabled: boolean;
  is_active: boolean;
  display_order: number;
  created_at: CreatedAt;
  updated_at: Defaulted<Date>;
}

export interface SubscriptionsTable {
  id: Generated<string>;
  user_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  currency: Defaulted<string>;
  price_cents: Defaulted<number>;
  billing_interval: Defaulted<string>;
  trial_ends_at: Timestamp | null;
  current_period_start: Timestamp | null;
  current_period_end: Timestamp | null;
  cancel_at_period_end: Defaulted<boolean>;
  canceled_at: Timestamp | null;
  past_due_since: Timestamp | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  created_at: CreatedAt;
  updated_at: Defaulted<Date>;
}

export interface PaymentsTable {
  id: Generated<string>;
  user_id: string;
  subscription_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  provider_invoice_id: string | null;
  provider_charge_id: string | null;
  failure_reason: string | null;
  period_start: Timestamp | null;
  period_end: Timestamp | null;
  paid_at: Timestamp | null;
  refunded_cents: Defaulted<number>;
  refunded_at: Timestamp | null;
  dispute_status: string | null;
  hosted_invoice_url: string | null;
  created_at: CreatedAt;
}

export interface StripeEventsTable {
  id: Generated<string>;
  stripe_event_id: string;
  type: string;
  livemode: boolean;
  payload: ColumnType<unknown, string, string>;
  processed: Defaulted<boolean>;
  processed_at: Timestamp | null;
  error: string | null;
  created_at: CreatedAt;
}

export interface AuditLogTable {
  id: Generated<number>;
  user_id: string | null;
  action: string;
  target: string | null;
  details: ColumnType<unknown, string | null, string | null>;
  created_at: CreatedAt;
}

export interface SecurityEventsTable {
  key: string;
  kind: string;
  target: string | null;
  reason: string | null;
  count: Defaulted<number>;
  first_at: Defaulted<Date>;
  last_at: Defaulted<Date>;
  severity: Defaulted<SecuritySeverity>;
  ip: string | null;
  country: string | null;
  user_agent: string | null;
  path: string | null;
  user_id: string | null;
  seen_at: Timestamp | null;
}

export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';
export type FocusView = 'board' | 'cards' | 'dates' | 'map';

export interface UserFocusTable {
  workspace_id: string;
  user_id: string;
  board_id: string | null;
  lane_id: string | null;
  view: FocusView;
  at: Defaulted<Date>;
}

export interface Database {
  users: UsersTable;
  accounts: AccountsTable;
  email_codes: EmailCodesTable;
  workspaces: WorkspacesTable;
  workspace_members: WorkspaceMembersTable;
  agent_connections: AgentConnectionsTable;
  api_tokens: ApiTokensTable;
  oidc_payloads: OidcPayloadsTable;
  actors: ActorsTable;
  boards: BoardsTable;
  lanes: LanesTable;
  notes: NotesTable;
  links: LinksTable;
  unresolved_wikilinks: UnresolvedWikilinksTable;
  node_layouts: NodeLayoutsTable;
  attachments: AttachmentsTable;
  note_revisions: NoteRevisionsTable;
  changes: ChangesTable;
  op_receipts: OpReceiptsTable;
  plans: PlansTable;
  subscriptions: SubscriptionsTable;
  payments: PaymentsTable;
  stripe_events: StripeEventsTable;
  audit_log: AuditLogTable;
  security_events: SecurityEventsTable;
  user_focus: UserFocusTable;
}

export type User = Selectable<UsersTable>;
export type Workspace = Selectable<WorkspacesTable>;
export type Board = Selectable<BoardsTable>;
export type Lane = Selectable<LanesTable>;
export type Note = Selectable<NotesTable>;
export type Link = Selectable<LinksTable>;
export type NodeLayout = Selectable<NodeLayoutsTable>;
export type Attachment = Selectable<AttachmentsTable>;
export type Change = Selectable<ChangesTable>;
export type Subscription = Selectable<SubscriptionsTable>;
export type Plan = Selectable<PlansTable>;
export type NewNote = Insertable<NotesTable>;
export type NoteUpdate = Updateable<NotesTable>;
