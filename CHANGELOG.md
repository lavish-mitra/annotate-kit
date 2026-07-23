# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Delivery targets** — optional one-click "send to…" buttons in the Send panel:
  `githubIssueDelivery` (no token), `createWebhookDelivery`, and `createSlackDelivery`.
- **Realtime** — adapters may implement `subscribe()`; the Supabase and Firebase adapters push live
  updates (with a slow safety-net poll) so the overlay refreshes instantly instead of only polling.

## [0.1.0] — Initial release

First public release: a drop-in, backend-agnostic, in-app annotation / visual
feedback overlay for React, safe-by-default and free to use.

### Added

- **Overlay** — pin + box/arrow/circle/freehand marks, colours, type, priority,
  status, replies, per-user visibility, and a review panel; element screenshots
  and full-page/viewport capture; a "send to developer" markdown export.
- **Adapters (5)** — `local` (localStorage, zero backend), `idb` (IndexedDB,
  larger capacity), `rest` (your own API, any platform), `supabase`, `firebase`.
  All behind one 9-method `StorageAdapter` contract.
- **Tool-agnostic export** — `buildDevPrompt(items)` (markdown) and
  `buildDevContext(items)` (structured JSON) for any developer or AI assistant.
- **Capture** — auto browser/OS/viewport + opt-in console/JS-error buffer,
  opt-in failed/slow network buffer, and an opt-in sanitised DOM snapshot of the
  marked element, attached to marks and the export.
- **Markup editor** — draw pen/box/arrow annotations directly on a captured
  screenshot, then copy or download the flattened image.
- **Theming** — `theme` (`light` / `dark` / `auto`) and a validated `accent`
  colour prop; self-contained styles scoped to the widget.
- **Accessibility** — dialog roles + `aria-modal` on the panel and modals,
  labelled controls, and `Escape` to dismiss.

### Security

- Ships **admin-only** by default; new marks default to **private**.
- **Server-enforced** authorization in the Supabase/Firebase backends: RLS /
  rules, JWT-stamped immutable authorship, per-owner screenshot access, upload
  size/mime limits, and payload size caps.
- **Privacy-first capture**: console/network/full-URL capture is opt-in; URLs
  are trimmed to origin+path; captured text/console is redacted; screenshots
  blur password fields and `[data-annot-redact]` elements.
- Export treats all annotation text as untrusted (stored prompt-injection
  defence) and omits console/network unless explicitly requested.

[Unreleased]: https://github.com/lavish-mitra/annotate-kit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lavish-mitra/annotate-kit/releases/tag/v0.1.0
