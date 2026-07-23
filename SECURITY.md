# Security Policy

annotate-kit runs inside other people's apps and captures live-app context
(screenshots, console, network), so we take security seriously. Thank you for
helping keep it and its users safe.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately using GitHub's built-in flow:

1. Go to the repository's **Security** tab → **Report a vulnerability**
   (GitHub Private Vulnerability Reporting).
2. Describe the issue, the impact, and steps to reproduce (a proof of concept
   helps a lot).

We aim to acknowledge reports within a few days and to ship a fix or mitigation
as quickly as is practical, crediting you if you'd like.

## Supported versions

annotate-kit is pre-1.0 (`0.x`). Security fixes land on the latest published
version. Please upgrade to the newest release before reporting.

## Scope & shared responsibility

annotate-kit is a **client library**. Its real security boundary is the backend
you connect it to:

- The **Supabase** and **Firebase** adapters ship with SQL/rules that enforce
  Row-Level Security, per-user visibility, author stamping, and per-owner
  screenshot access. **You must apply and deploy those** (`backend/…`) — the
  client alone enforces nothing.
- The **REST** adapter delegates entirely to your API; your server owns authz.
- The **local** and **idb** adapters are single-browser with **no multi-user
  boundary** — never use them for shared/multi-tenant data.

By default the tool ships **admin-only** and new marks are **private**; capture
of console, network, and full URLs is **opt-in**; screenshots blur password
fields; and captured text/console is run through a redactor. Review the
"Security & privacy" section of the README before shipping to production.

If you find a place where the **shipped defaults or backend rules** are unsafe
(e.g. a way for one authenticated user to read another's private data with the
default setup), that is in scope — please report it.
