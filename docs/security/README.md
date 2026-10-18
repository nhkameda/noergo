# Security documentation

How noergo selects, tracks and proves its security controls. To report a
vulnerability, see [SECURITY.md](../../SECURITY.md).

## Files

| File | What it is | Status |
|---|---|---|
| [PROJECT_PROFILE.json](PROJECT_PROFILE.json) | Scope, exposure, data classes, technology, owners, exclusions | draft |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Assets, actors, data flows, trust boundaries, abuse cases, decisions | draft, not approved |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Every selected control with implementation, tests, state and evidence | draft |
| `INVENTORY.md` | Domains, services, repositories, pipelines, providers, datasets | planned (F1) |
| `VENDORS.md` | Provider diligence, data flows, exit plans | planned (F6) |
| `EXCEPTIONS.md` | Time-boxed exceptions with owner, compensation and expiry | planned (F0) |
| `INCIDENT_RESPONSE.md` | Incident plan and playbooks (contacts kept privately) | planned (F7) |

## Why profile E

The project follows the maintainer's security baseline, which has three cumulative
profiles: B for anything on the internet, E for systems with identity, personal
data, multi-tenancy, files or webhooks, privileged integrations or payments, and C
for material impact or sensitive data at scale. noergo has all of the E triggers:
federated sign-in, personal data from Brazil, the EU and China, one workspace per
tenant, attachments, payment webhooks, and an OAuth server that lets third-party AI
agents read and write notes. So every B and E control is selected. Whether to add
profile C's DAT-007 (sensitive data, minors) is an open decision in the threat
model. The baseline's catalogs are mirrored privately; this folder cites their ids.

## Rules

- **Only `PASS` with evidence closes an item.** Evidence is a test result, a log or
  an exported configuration tied to a commit or release. A written-but-unrun test is
  not evidence. `NOT_TESTED`, `INCONCLUSIVE` and `ERROR` never count as `PASS`.
- **Canonical states only:** `PASS`, `FAIL`, `NOT_APPLICABLE`, `NOT_TESTED`,
  `INCONCLUSIVE`, `ERROR`.
- **`NOT_APPLICABLE` needs a fact.** Only when the control's condition is absent,
  with the reason and an approver. Re-check it when the design changes.
- **Tests come from `control_refs`.** A control is linked to a catalog test family
  only when the family lists it in `control_refs`. Do not infer links from ids that
  look alike.
- **No claims beyond the evidence.** Do not write "secure", "compliant", "full
  coverage" or "approved". State what was observed, in which version and
  configuration.

## Updating the matrix

Update the matrix in the same pull request as the change:

1. Find the affected controls (the threat model row usually names them).
2. Change the implementation and location to what the code now does.
3. Run the linked test families and record the result: the state, plus evidence
   (CI run, test file and commit, configuration export). Use `FAIL` when a test
   fails: hiding it as `NOT_TESTED` is not allowed.
4. Refresh the state counts and the date and commit in the header.
5. If the change touches a trust boundary, update THREAT_MODEL.md as well.

## Dynamic testing

Run dynamic tests (DAST, load, authentication abuse, upload fuzzing) only against an
ephemeral local or CI instance with synthetic data, and only with a written scope
first. Following the baseline's authorization-scope template, the scope lists the
exact targets, the window, synthetic accounts, allowed test families, rate and size
limits, abort thresholds, a kill switch, how evidence is stored and destroyed, and
who approved it. A target not on the list is excluded.

Production (noergo.com) gets passive checks only: headers, TLS, DNS, certificates.
No environment is authorized for dynamic tests yet (see
`environments_authorized_for_dynamic_tests` in the profile).
