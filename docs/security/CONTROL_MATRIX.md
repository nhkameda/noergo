# Control matrix (profile E)

- **Date:** 2026-10-18
- **Commit:** pre-initial-commit (version 0.1.0-dev)
- **Baseline:** the maintainer's security baseline, catalog 1.0.0 for controls and 1.0.0 for test families (both reviewed 2026-07-31), mirrored privately.
- **Selection:** every control of profiles B and E: 97 controls (58 B, 39 E). A control without a condition applies by default; `NOT_APPLICABLE` only when a factual condition is absent, with a justification and an approver.
- **States reflect only what was observed** in this commit and configuration. Only `PASS` with evidence closes an item. No control has been tested yet: nothing here is a claim that noergo is secure or compliant.

| State | Count |
|---|---:|
| `PASS` | 0 |
| `FAIL` | 0 |
| `NOT_APPLICABLE` | 1 |
| `NOT_TESTED` | 96 |
| `INCONCLUSIVE` | 0 |
| `ERROR` | 0 |

**Tests** lists the catalog families whose `control_refs` include the control; nothing is inferred from id similarity. **Phase** is the delivery gate where the control must first have evidence: F0 repository and CI, F1 infrastructure and OAuth/MCP spike, F2 core and identity, F3 board UI, F4 full MCP, F5 maps, F6 billing and attachments, F7 launch hardening.

| ID | Prof. | Control | Applicability | Planned implementation / location | Tests | State | Evidence | Phase |
|---|---|---|---|---|---|---|---|---|
| GOV-001 | B | Profile, scope and owners | applies | `docs/security/PROJECT_PROFILE.json` (draft, not approved); all four owner roles held by the maintainer | T-GOV-001 | `NOT_TESTED` | — | F0 |
| GOV-002 | B | Inventory of assets, services and data | applies | Planned `docs/security/INVENTORY.md`: domains, services, repositories, pipelines, providers, datasets. Secret names and host details live in the private operations repository | T-GOV-002 | `NOT_TESTED` | — | F1 |
| GOV-003 | B | Continuous risk management | applies | Residual-risk column of THREAT_MODEL.md; planned private risk register reviewed at every phase gate | T-GOV-003 | `NOT_TESTED` | — | F0 |
| GOV-004 | B | Policies and competence | applies | SECURITY.md, CONTRIBUTING.md and this folder; planned maintainer training record | T-GOV-004 | `NOT_TESTED` | — | F7 |
| GOV-005 | E | Vendor risk | applies: providers process personal data | Planned `docs/security/VENDORS.md`: identity, payment, CDN/DNS/object storage, GitHub/GHCR, hosting; DPAs, data flows, exit plans (S3 API and standard PostgreSQL keep exit simple) | T-GOV-005 | `NOT_TESTED` | — | F6 |
| GOV-006 | B | Temporary exceptions | applies | Planned `docs/security/EXCEPTIONS.md` (owner, compensation, expiry, closure). First candidates: single-maintainer review, admin MFA | T-GOV-006 | `NOT_TESTED` | — | F0 |
| GOV-007 | E | Honest metrics and review | applies | State counts at the top of this file; `NOT_TESTED`, `NOT_APPLICABLE` and `INCONCLUSIVE` never counted as `PASS` | T-GOV-007 | `NOT_TESTED` | — | F7 |
| ARC-001 | B | Threat model and trust boundaries | applies | `docs/security/THREAT_MODEL.md` (draft, not approved) | T-ARC-001 | `NOT_TESTED` | — | F0 |
| ARC-002 | B | Least privilege and segmentation | applies | Roles `noergo_migrator`, `noergo_app` (NOBYPASSRLS), `noergo_jobs` (BYPASSRLS) in `packages/core/sql/roles.sql`. To narrow: default privileges in `packages/core/sql/database.sql` grant DML on every table (audit log, plans, queue tables included) to both runtime roles | T-ARC-002 | `NOT_TESTED` | Tests written, not executed: `packages/core/test/domain.test.ts` | F2 |
| ARC-003 | B | Secure defaults and fail-safe | applies | `app_workspace_id()` is NULL when unset, so RLS matches no row (`packages/core/migrations/0001_initial.sql`); no connection without `DATABASE_URL` (`packages/core/src/db/index.ts`). Planned startup checks for required secrets and safe self-host defaults | T-ARC-003 | `NOT_TESTED` | Tests written, not executed: `packages/core/test/domain.test.ts` | F2 |
| ARC-004 | E | Tenant isolation | applies: multi-tenant | RLS ENABLE + FORCE on 11 content tables and `workspaces`; `withWorkspace()`; explicit `workspace_id` filters; composite FKs; `not_found` for foreign ids. Planned for streams, jobs, object keys, exports, logs, backups. Identity, billing and agent tables have no RLS (one wall only) | T-ARC-004 | `NOT_TESTED` | Tests written, not executed: `packages/core/test/domain.test.ts` | F2 |
| ARC-005 | B | Minimal attack surface | applies | Planned: internal consent endpoint and database never routed by the proxy; no debug routes in production builds; surface inventory | T-ARC-005 | `NOT_TESTED` | — | F1 |
| ARC-006 | E | Abuse and fraud cases | applies | THREAT_MODEL.md TM-08, TM-29, TM-30; sign-up mode, one trial per user (`users.trial_used_at`), DCR limits | T-ARC-006 | `NOT_TESTED` | — | F6 |
| ARC-007 | E | Architectural change review | applies | CONTRIBUTING.md rule; planned pull-request template and CODEOWNERS on security-relevant paths | T-ARC-007 | `NOT_TESTED` | — | F0 |
| DAT-001 | E | Purpose, legal basis and processing record | applies: personal data | Planned record of processing per purpose (account, notes, billing, security logs, agent connections); legal basis per jurisdiction (BR, EU, CN) needs legal review | T-DAT-001 | `NOT_TESTED` | — | F7 |
| DAT-002 | B | Minimization | applies | Identity-provider tokens not stored (`accounts`, `0001_initial.sql`); no analytics planned; EXIF stripped; tools return excerpts | T-DAT-002 | `NOT_TESTED` | — | F2 |
| DAT-003 | B | Classification and data flow | applies | Data flows in THREAT_MODEL.md; planned data dictionary with a class per column | T-DAT-003 | `NOT_TESTED` | — | F2 |
| DAT-004 | E | Retention and deletion | applies | Planned worker jobs: trash 30 d, change log 90 d, receipts 48 h (windows in `packages/core/src/limits.ts`). Not yet defined: `note_revisions`, `oidc_payloads`, `email_codes`, `security_events`, `audit_log`, `stripe_events.payload`, objects of deleted accounts, backups | T-DAT-004 | `NOT_TESTED` | — | F2 |
| DAT-005 | E | Data subject rights | applies | Planned in-app export (JSON and Obsidian-compatible Markdown zip) and account deletion; procedure for requests through other channels | T-DAT-005 | `NOT_TESTED` | — | F2 |
| DAT-006 | E | Transparency and choices | applies | Planned privacy notice and terms in pt-BR, en, zh-CN; accepted terms version stored (`users.terms_version`); essential cookies only | T-DAT-006 | `NOT_TESTED` | — | F7 |
| DAT-008 | E | International transfer | applies: users in BR, EU, CN, one hosting region, US providers | Planned transfer map and mechanism per provider and jurisdiction; legal review | T-DAT-008 | `NOT_TESTED` | — | F7 |
| DAT-009 | E | Privacy by design and DPIA | applies | Planned DPIA (RIPD): free-form notes, third-party AI agents reading and writing notes | T-DAT-009 | `NOT_TESTED` | — | F7 |
| DAT-010 | B | Exports, backups and non-production data | applies | Planned encrypted backups, isolated restore drills, short-lived export links. Development and tests use synthetic data on a loopback-only database (`packages/core/scripts/dev-db.sh`) | T-DAT-010 | `NOT_TESTED` | — | F1 |
| IAM-001 | B | Unique identities and lifecycle | applies | `users` and `accounts` unique on `(provider, provider_account_id)`; one `actors` row per user, agent connection, token or system; personal maintainer accounts | T-IAM-001 | `NOT_TESTED` | — | F2 |
| IAM-002 | E | Multi-factor authentication | applies: admin role exists (`users.role`) | Sign-in delegated to identity providers; no in-app MFA in the design. Planned: admin access needs a verified MFA claim or a local passkey; phishing-resistant MFA on maintainer accounts | T-IAM-002 | `NOT_TESTED` | — | F2 |
| IAM-003 | B | Passwords and automated attacks | applies: no passwords; scoped to email codes and sign-in endpoints | Optional email-code provider: attempt counter (`email_codes.attempts`); planned rate limits per email and IP, no account enumeration | T-IAM-003 | `NOT_TESTED` | — | F2 |
| IAM-004 | B | Recovery and credential change | applies | No password reset. Email codes random, short-lived, single-use (`expires_at`, `consumed_at`); account-linking rules per provider; personal-token rotation | T-IAM-004 | `NOT_TESTED` | — | F2 |
| IAM-005 | B | Secure sessions | applies | Planned Auth.js JWT in Secure, HttpOnly, SameSite, host-only cookies; revocation by `users.session_epoch`; streams closed on revocation | T-IAM-005 | `NOT_TESTED` | — | F2 |
| IAM-006 | E | Re-authentication for critical actions | applies | Not in the design. Planned recent sign-in for account deletion, export, token creation and agent write grants | T-IAM-006 | `NOT_TESTED` | — | F2 |
| IAM-007 | B | Central authorization, deny by default | applies | Read-only connections refused in `executeOps` (`packages/core/src/ops/execute.ts`); planned shared authorization module for web and mcp. `workspace_members.role` not enforced yet | T-IAM-007 | `NOT_TESTED` | — | F2 |
| IAM-008 | B | Object and property authorization | applies | Workspace filter + RLS on every op; foreign ids answer `not_found` (`packages/core/src/errors.ts`); zod op schemas bound the writable properties | T-ARC-004, T-IAM-008 | `NOT_TESTED` | Tests written, not executed: `packages/core/test/domain.test.ts` | F2 |
| IAM-009 | E | Administrative functions | applies: `users.role = 'admin'`, `admin_unlimited` | Planned isolated admin surface with MFA and audit; no impersonation | T-IAM-009 | `NOT_TESTED` | — | F7 |
| IAM-010 | B | Service identities and tokens | applies | Separate database roles; storage key scoped to buckets; consent-bridge HMAC; `nrg_` tokens stored as sha256; MCP tokens bound to `/mcp`. To fix: web and mcp share `noergo_app`; personal tokens have no default expiry | T-IAM-010 | `NOT_TESTED` | — | F4 |
| IAM-011 | E | OAuth, OIDC and federation | applies: federation and delegated authorization | As client: PKCE, state, nonce, issuer per tenant. As server (oidc-provider): PKCE S256 required, resource indicators, exact redirects, loopback native clients, refresh rotation, rate-limited DCR | T-IAM-011 | `NOT_TESTED` | — | F1 |
| APP-001 | B | Input validation and limits | applies | Zod schemas in `packages/core/src/ops/schema.ts`; `LIMITS` in `packages/core/src/limits.ts`; CHECKs in `0001_initial.sql`; planned body limits at the edge | T-APP-001 | `NOT_TESTED` | Unit tests written, not executed: `packages/core/test/pure.test.ts` | F2 |
| APP-002 | B | Contextual output encoding | applies | Planned React escaping, markdown through DOMPurify without raw HTML, structured MCP output | T-APP-002 | `NOT_TESTED` | — | F3 |
| APP-003 | B | Parameterized queries and commands | applies | Kysely builder and bound `sql` templates in `packages/core/src`; LIKE escaping in search (`read.ts`); dynamic DDL only through `format('%I')` in migrations | T-APP-003 | `NOT_TESTED` | — | F2 |
| APP-004 | E | File uploads and processing | applies: attachments | Planned quarantine, magic-byte allowlist, re-encode with `limitInputPixels`, generated keys, cookieless origin, attachment disposition, no inline SVG, 50 MB per file | T-APP-004 | `NOT_TESTED` | — | F6 |
| APP-005 | E | Outbound requests and SSRF | applies: OAuth client metadata URIs can trigger fetches | Planned: `request_uri` and fetch-based client authentication disabled; no server-side fetch of note URLs; egress allowlist | T-APP-005 | `NOT_TESTED` | — | F1 |
| APP-006 | B | Safe parsing and deserialization | applies | JSON parsed then validated by zod; planned pixel-limited image decoding in the worker; markdown parser with raw HTML off | T-APP-006 | `NOT_TESTED` | — | F3 |
| APP-007 | B | CSRF and origin confusion | applies: cookie sessions | Planned Origin check on every mutation, SameSite cookies, JSON content type, Auth.js CSRF token | T-APP-007 | `NOT_TESTED` | — | F2 |
| APP-008 | B | Browser controls and CORS | applies | Planned nonce CSP, `img-src 'self'` + attachments origin, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, no-store on private responses, no credentialed wildcard CORS | T-APP-008 | `NOT_TESTED` | — | F3 |
| APP-009 | B | Errors and exposed information | applies | Stable domain error codes (`packages/core/src/errors.ts`); unmapped database errors re-thrown for a generic 500 at the edge (planned) | T-APP-009 | `NOT_TESTED` | — | F2 |
| APP-010 | B | API inventory and lifecycle | applies: APIs | Planned inventory of `/api/ops`, `/api/stream`, `/api/auth/*`, billing routes, `/mcp`, `/oauth/*`, `/.well-known/*` and the internal endpoint; MCP contract snapshot test | T-APP-010 | `NOT_TESTED` | — | F4 |
| APP-011 | B | Resource consumption and abusive automation | applies | Limits in `limits.ts` (200-character queries, at most 50 results). Planned 120 calls/min per connection, DCR rate limit, stream caps, rate limiter behind an interface | T-APP-011 | `NOT_TESTED` | — | F4 |
| APP-012 | E | Webhooks and messages | applies: payment webhooks, job queue, notifications | `stripe_events.stripe_event_id` UNIQUE (`0001_initial.sql`). Planned raw-body signature check, validated idempotent jobs, ids-only notifications | T-APP-012 | `NOT_TESTED` | — | F6 |
| APP-013 | E | Persistent and alternative protocols | applies: SSE and MCP Streamable HTTP | Planned authentication at connect, per-workspace fan-out, caps, heartbeat, close on revocation | T-APP-013 | `NOT_TESTED` | — | F2 |
| APP-014 | E | Transaction and state integrity | applies | Workspace row lock, gap-free `seq`, idempotency receipts per `opId`, `baseVersion` concurrency (`packages/core/src/ops/execute.ts`, `apply.ts`). Planned billing state rules and atomic quota | T-ARC-006, T-APP-014 | `NOT_TESTED` | Tests written, not executed: `packages/core/test/domain.test.ts` | F2 |
| CRY-001 | B | Libraries, algorithms and agility | applies | `node:crypto` SHA-256 for high-entropy tokens and migration checksums. Planned HMAC-SHA-256 for the consent bridge and for IP keys (a plain hash of an IP address is reversible) | T-CRY-001 | `NOT_TESTED` | — | F2 |
| CRY-002 | B | Transport protection | applies | Planned TLS at the CDN and at the origin with full certificate validation, HSTS, database over loopback or TLS | T-CRY-002 | `NOT_TESTED` | — | F1 |
| CRY-003 | E | Data at rest | applies | Provider encryption for object storage. Planned encrypted backups, host disk encryption decision, hashed keys in `oidc_payloads` | T-CRY-003 | `NOT_TESTED` | — | F1 |
| CRY-004 | E | Key lifecycle | applies | Planned key inventory and rotation runbook: session secret, OAuth signing and cookie keys, HMAC keys, webhook secret, storage keys, database passwords | T-CRY-004 | `NOT_TESTED` | — | F7 |
| CRY-005 | B | Secrets management | applies | `.githooks/pre-commit` and `.gitleaks.toml`, `npm run secrets`, `.gitignore` for `.env*`. Planned CI scan, push protection, secrets only from the environment | T-CRY-005 | `NOT_TESTED` | — | F0 |
| CRY-006 | B | Password verifier storage | condition absent: no passwords are stored (identity providers and one-time codes only). Re-assess if a password provider is added. Approver: maintainer (pending) | — | T-CRY-006 | `NOT_APPLICABLE` | — | F2 |
| LOG-001 | B | Security events | applies | Tables `audit_log` and `security_events` (`0001_initial.sql`); planned event taxonomy | T-LOG-001 | `NOT_TESTED` | — | F2 |
| LOG-002 | B | Log minimization and protection | applies | Planned proxy log redaction of `code=`, `token=`, `state=`; no bodies, tool arguments, cookies or Authorization headers in logs | T-LOG-002 | `NOT_TESTED` | — | F1 |
| LOG-003 | E | Log integrity, time, access, retention | applies | Planned off-host shipping and retention. To fix: runtime roles can UPDATE and DELETE `audit_log` | T-LOG-003 | `NOT_TESTED` | — | F7 |
| LOG-004 | E | Actionable alerts | applies | Planned uptime checks of health and OAuth discovery; alerts on webhook failures, token reuse, RLS violations, 5xx, backup failures | T-LOG-004 | `NOT_TESTED` | — | F7 |
| LOG-005 | E | Audit of privileged actions and data | applies | Planned `audit_log` entries for admin actions, exports, deletions, token and agent grants, plan overrides | T-LOG-005 | `NOT_TESTED` | — | F7 |
| OPS-001 | B | Environment separation | applies | Local (loopback, synthetic), CI ephemeral database, staging (own database, identity clients, payment test mode, allowlisted sign-up), production. Host-level separation to be decided | T-OPS-001 | `NOT_TESTED` | — | F1 |
| OPS-002 | B | Versioned hardening | applies | Planned hardening baseline for host, container, PostgreSQL and proxy, kept in the private operations repository | T-OPS-002 | `NOT_TESTED` | — | F1 |
| OPS-003 | B | Runtime without excess privilege | applies | Planned non-root image, read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, memory and pid limits | T-OPS-003 | `NOT_TESTED` | — | F0 |
| OPS-004 | E | Controlled network and egress | applies | Planned: origin reachable only from the CDN; internal endpoints not exposed; egress allowlist | T-OPS-004 | `NOT_TESTED` | — | F1 |
| OPS-005 | B | Availability and safe degradation | applies | Pool timeouts in `packages/core/src/db/index.ts` (statement 15 s, idle in transaction 30 s, connect 5 s); stream resume with reload. Planned job retries with backoff | T-OPS-005 | `NOT_TESTED` | — | F2 |
| OPS-006 | B | Backup, restore and continuity | applies | Planned WAL archiving with PITR plus daily dumps, monthly restore drill, RPO/RTO, delete-protected backup storage | T-OPS-006 | `NOT_TESTED` | — | F1 |
| OPS-007 | B | Safe deploy, canary and rollback | applies | Planned deploy by image digest, health checks, rollback to the previous digest; append-only, expand/contract migrations | T-OPS-007 | `NOT_TESTED` | — | F1 |
| OPS-008 | B | Infrastructure as code and drift | applies | Planned: deployment configuration versioned in the private operations repository, with a drift check | T-OPS-008 | `NOT_TESTED` | — | F1 |
| OPS-009 | B | DNS, certificates and domains | applies | Planned: registrar and DNS accounts with MFA, certificate expiry monitoring, dangling-record review | T-OPS-009 | `NOT_TESTED` | — | F1 |
| SUP-001 | B | Inventory and SBOM | applies | `package-lock.json`; planned SBOM per image in the release workflow | T-SUP-001 | `NOT_TESTED` | — | F0 |
| SUP-002 | B | Pinned, verified dependencies | applies | Lockfile with integrity hashes, `npm ci`; `package.json` ranges resolved by the lockfile. Planned SHA-pinned actions and digest-pinned base images | T-SUP-002 | `NOT_TESTED` | — | F0 |
| SUP-003 | B | Vulnerabilities and known exploitation | applies | `npm audit --omit=dev --audit-level=high` in `npm run check`. Planned Dependabot, CodeQL, KEV-based triage | T-SUP-003 | `NOT_TESTED` | — | F0 |
| SUP-004 | E | Provenance and signing | applies | Planned build provenance attestation. Not designed yet: verification at deploy | T-SUP-004 | `NOT_TESTED` | — | F0 |
| SUP-005 | B | Isolated, minimal CI/CD | applies | Planned GitHub-hosted runners, read-only default permissions, no secrets for fork PRs, protected release environment | T-SUP-005 | `NOT_TESTED` | — | F0 |
| SUP-006 | B | Repository protection and review | applies | Planned branch protection, required checks, no force-push, DCO, CODEOWNERS. Single maintainer: no independent review | T-SUP-006 | `NOT_TESTED` | — | F0 |
| SUP-007 | B | New dependencies and malicious packages | applies | CONTRIBUTING.md rule; `allowScripts` allowlist in `package.json` | T-SUP-007 | `NOT_TESTED` | — | F0 |
| VUL-001 | B | Disclosure channel and triage | applies | `SECURITY.md` (GitHub private vulnerability reporting); channel not yet enabled or exercised | T-VUL-001 | `NOT_TESTED` | — | F0 |
| VUL-002 | B | Combined assessment coverage | applies | Planned review, CodeQL, npm audit/Dependabot, gitleaks, configuration review, tests and limited DAST on staging | T-VUL-002 | `NOT_TESTED` | — | F7 |
| VUL-003 | B | Contextual priority and SLA | applies | Response targets in SECURITY.md; planned internal severity policy | T-VUL-003 | `NOT_TESTED` | — | F7 |
| VUL-004 | B | Fix and safe update | applies | CONTRIBUTING.md: root cause, variants, fix in the advisory fork | T-VUL-004 | `NOT_TESTED` | — | F0 |
| VUL-005 | B | Finding validation and retest | applies | Planned: scanner and LLM findings validated before action. Independent retest not available (single maintainer) | T-VUL-005 | `NOT_TESTED` | — | F7 |
| VUL-006 | B | Security regressions | applies | CONTRIBUTING.md: a regression test with every security fix | T-VUL-006 | `NOT_TESTED` | — | F0 |
| IR-001 | B | Plan, roles and contacts | applies | Planned incident plan; contacts kept privately. No backup contact yet | T-IR-001 | `NOT_TESTED` | — | F7 |
| IR-002 | B | Detection, triage and classification | applies | Planned triage runbook | T-IR-002 | `NOT_TESTED` | — | F7 |
| IR-003 | E | Containment and evidence | applies | Planned playbooks: bump every session epoch, revoke grants and tokens, rotate keys, snapshot | T-IR-003 | `NOT_TESTED` | — | F7 |
| IR-004 | E | Personal-data incident assessment and notice | applies: personal data | Planned decision matrix: ANPD (3 business days), GDPR authority (72 h), PIPL; legal review | T-IR-004 | `NOT_TESTED` | — | F7 |
| IR-005 | E | Exercises and readiness | applies | Planned tabletop calendar | T-IR-005 | `NOT_TESTED` | — | F7 |
| IR-006 | B | Eradication, recovery and learning | applies | Planned post-incident review template | T-IR-006 | `NOT_TESTED` | — | F7 |
| PEO-001 | B | Social-engineering awareness | applies | Planned maintainer training and guidance for contributors | T-PEO-001 | `NOT_TESTED` | — | F7 |
| PEO-002 | E | Ethical, authorized simulations | applies | No simulation planned; any future one needs written approval and scope | T-PEO-002 | `NOT_TESTED` | — | F7 |
| PEO-003 | E | Out-of-band verification for critical actions | applies | Planned: payout, domain, provider-account and account-recovery requests verified through an independent channel | T-PEO-003 | `NOT_TESTED` | — | F7 |
| PEO-004 | E | Insider risk and offboarding | applies | Planned access review and revocation checklist for every collaborator account | T-PEO-004 | `NOT_TESTED` | — | F7 |
| AI-001 | E | AI scope, risk and inventory | applies: tools exposed to AI agents; AI assistants in development | Inventory in THREAT_MODEL.md; planned MCP tool contract | T-AI-001 | `NOT_TESTED` | — | F4 |
| AI-002 | E | Untrusted content and prompt injection | applies | Planned tool descriptions marking note content as data, server-side scopes, CSP against image exfiltration | T-AI-002 | `NOT_TESTED` | — | F4 |
| AI-003 | E | Least-privilege tools and autonomy | applies | Planned scopes, read-only connections, rate limits, no permanent-delete tool. Per-action human approval left to MCP clients | T-AI-003 | `NOT_TESTED` | — | F4 |
| AI-004 | E | Data sent to model providers | applies | noergo sends nothing to models itself; tools return minimal data; privacy notice explains what agents receive | T-AI-004 | `NOT_TESTED` | — | F4 |
| AI-005 | E | Output validation and human responsibility | applies | Agent writes pass the same op schema and sanitizer; a revision before every agent write; revert from the activity feed | T-AI-005 | `NOT_TESTED` | Tests written, not executed: `packages/core/test/domain.test.ts` | F4 |
| AI-006 | E | Evals, monitoring and model change | applies | Planned versioned injection corpus and contract snapshots, re-run when tools or descriptions change; per-connection write-rate monitoring | T-AI-006 | `NOT_TESTED` | — | F4 |

## Profile C controls (not selected)

Listed so the decision stays visible. They carry no state because they are outside the selection.

| ID | Control | Why it matters here |
|---|---|---|
| DAT-007 | Sensitive data and vulnerable people | Notes are free-form and may hold sensitive personal data; there is no age gate. Its condition may be met: open decision 1 in THREAT_MODEL.md. |
| LOG-006 | Detection coverage and effectiveness | Not selected for launch. |
| SUP-008 | Hermetic, reproducible builds | Not selected for launch; provenance (SUP-004) is selected. |

## Gaps found while building this matrix

Design points that do not yet meet the selected controls. Each needs a fix or an exception record.

1. **Runtime grants are too broad** (ARC-002, LOG-003): default privileges give `noergo_app` and `noergo_jobs` SELECT, INSERT, UPDATE and DELETE on every table the migrator creates, in every schema. The app can rewrite `audit_log`, `plans` and `schema_migrations`, and write queue tables the RLS-bypassing worker trusts.
2. **One wall for user-scoped tables** (ARC-004): `users`, `accounts`, `workspace_members`, `agent_connections`, `api_tokens`, `subscriptions`, `payments` and `oidc_payloads` have no RLS; only application filters protect them.
3. **OAuth tokens stored by value** (IAM-010, CRY-003): `oidc_payloads` keys records by id, and for opaque tokens the id is the token. Personal tokens are hashed; OAuth access and refresh tokens should be too.
4. **No MFA or step-up path** (IAM-002, IAM-006, IAM-009): an admin role exists, sign-in is fully delegated, and critical actions have no recent-authentication check.
5. **Retention undefined for several stores** (DAT-004): see the DAT-004 row; backups keep deleted accounts until they expire.
6. **IP hashing** (CRY-001): a plain hash of an IP address can be reversed by enumeration; use a keyed HMAC with a rotated key.
7. **SSRF through OAuth client metadata** (APP-005): registered `jwks_uri`, `sector_identifier_uri` or `request_uri` values make the authorization server fetch attacker-chosen URLs wherever the configuration enables the features that use them; pin that configuration and test it.
8. **Revocation on long-lived channels** (IAM-005, APP-013): revoking a session epoch must also close open SSE and MCP streams.
9. **Human approval for agent writes** (AI-003): delegated to MCP clients; noergo relies on reversibility.
10. **Deploy-side verification** (SUP-004): provenance is produced but nothing verifies it before running the image.
11. **Single maintainer** (SUP-006, VUL-005, IAM-009, PEO-004): independent review, independent retest and segregation of duties are not possible as written.
12. **Logs on the host** (LOG-003): no off-host, tamper-resistant copy is designed.
13. **Self-host `STORAGE=local`** (APP-004, APP-008): the cookieless separate origin that protects noergo.com is not guaranteed when files are served by the app itself.
14. **Skipped database tests** (VUL-002): without a reachable PostgreSQL, `npm run check` passes locally with the isolation tests skipped; only CI enforces them.
15. **gitleaks allowlist** (CRY-005): `.gitleaks.toml` ignores any `fixtures/` directory wholesale; a real secret placed there would not be flagged.
16. **Legal scope** (DAT-001, DAT-008, IR-004): Brazilian access-log retention, GDPR representative and transfer duties, and China's PIPL need legal review; the baseline's privacy controls are written around the LGPD.
