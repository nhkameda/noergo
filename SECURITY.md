# Security policy

noergo holds people's notes and lets AI agents read and write them, so we take
vulnerability reports seriously. Thank you for helping.

## Supported versions

| Version | Supported |
|---|---|
| Latest release | Yes |
| `main` branch | Yes |
| Older releases | No. Upgrade to the latest release first. |

Fixes ship in a new release and on `main`. We do not backport to older releases.

## How to report

Report privately through **GitHub private vulnerability reporting** for this
repository:

<https://github.com/nhkameda/noergo/security/advisories/new>

(Repository page → **Security** → **Report a vulnerability**.)

There is no security email address. Please do **not** report vulnerabilities in
public issues, pull requests, discussions or social media.

A useful report includes:

- the affected component (`apps/web`, `apps/mcp`, `apps/worker`, `packages/core`,
  the container image, CI) and the version or commit;
- the impact: what an attacker gains, and from which position (anonymous, signed-in
  user, another workspace, an MCP client or agent, a self-host operator);
- minimal reproduction steps against your own instance, using synthetic data;
- any suggested fix.

We use the details you send only to handle the report. We credit reporters in the
published advisory if they want to be credited, and only under the name they choose.
There is no bug bounty.

## Scope

In scope:

- the code in this repository;
- the official container image built from this repository by its GitHub Actions
  workflow and published to GitHub Container Registry under `nhkameda/noergo`.

Out of scope:

- third-party services we integrate with (Google, Microsoft, Cloudflare, GitHub,
  the AI vendors behind MCP clients). Report those to the vendor;
- testing the infrastructure of noergo.com without our written permission;
- self-hosted instances you do not operate;
- findings that need a compromised device, physical access or a malicious browser
  extension, and scanner output with no demonstrated impact.

## Rules for testing

Test against **your own self-hosted instance** with synthetic data: it has every
feature, and its administration page lets you switch sign-up and agents as you need.

Against noergo.com, do **not** run:

- denial-of-service or load tests;
- brute force, password spraying or credential stuffing;
- social engineering or phishing of users, the maintainer or our providers;
- automated vulnerability scanning or fuzzing.

Do not access, change or keep data that is not yours. If you reach someone else's
data by accident, stop, do not share it, delete any copy you made, and say so in
your report.

## Safe harbor

If you act in good faith and follow this policy, we will treat your research as
authorized under this policy, we will not take or support legal action against you
for it, and we will work with you to understand and fix the issue. If a third party
takes legal action against you over research that followed this policy, we will make
clear that it did.

This applies only to noergo and its maintainer. We cannot authorize testing of
third-party services, and this policy does not authorize anything it excludes. If you
are unsure whether something is allowed, ask first through the private reporting
channel.

## What happens next

- **Acknowledgement:** within 5 business days.
- **Triage:** we confirm or dispute the issue, assess severity from exploitability,
  exposure and the data affected, and tell you what we plan to do.
- **Fix:** we fix the root cause, look for variants, add a regression test and
  release. The fix lands with a GitHub Security Advisory (and a CVE where it applies).
- **Disclosure:** coordinated with you. Please keep the details private until the
  advisory is published, or for 90 days from your report if that comes first. If you
  need a different timeline, tell us.

noergo has a single maintainer. These targets are best effort, not a contract or a
service-level agreement.

## More

How the project models threats and tracks security controls:
[`docs/security/`](docs/security/README.md).
