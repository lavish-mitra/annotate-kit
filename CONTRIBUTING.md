# Contributing to annotate-kit

Thanks for taking the time to contribute! 🎉 This project is meant to be **free,
easy to adopt, and safe for everyone** — contributions that keep it that way are
very welcome, whether that's a bug fix, a new adapter, docs, or an idea.

## Ways to help

- 🐛 **Report a bug** — open an issue with steps to reproduce.
- 💡 **Request a feature** — open an issue describing the use case.
- 🧩 **Write an adapter** — for another backend (see `src/adapter.ts`).
- 📖 **Improve docs** — typos and clarity fixes are appreciated.
- 🔒 **Security issue?** Please follow [SECURITY.md](SECURITY.md) instead of
  opening a public issue.

## Development setup

You need **Node.js ≥ 18**.

```bash
git clone https://github.com/lavish-mitra/annotate-kit.git
cd annotate-kit
npm install
```

Common scripts:

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm test` | Run the unit tests (Vitest) |
| `npm run build` | Build `dist/` (JS via tsup + CSS via Tailwind) |
| `npm run dev` | Rebuild JS on change (`tsup --watch`) |

Before opening a pull request, please make sure all three pass:

```bash
npm run typecheck && npm test && npm run build
```

CI runs exactly these on every PR.

## Project layout

```
src/
  Annotate.tsx        the overlay component
  adapter.ts          the StorageAdapter contract (9 methods)
  adapters/           local · idb · rest · supabase · firebase
  prompt.ts           buildDevPrompt / buildDevContext (pure)
  types.ts constants.ts styles/annotate.css
backend/              SQL + rules you deploy for Supabase / Firebase
tests/                Vitest unit tests
dist/                 built output (committed so `npm i github:…` needs no build)
```

> `dist/` is committed on purpose. If you change anything in `src/`, run
> `npm run build` and commit the updated `dist/` too.

## Pull request guidelines

- Keep PRs focused — one logical change per PR.
- Add or update a test when you change behaviour (`tests/*.test.ts`).
- Match the surrounding code style (the repo has no formatter config on purpose;
  just keep it consistent with nearby code).
- Update the `README.md` and `CHANGELOG.md` (`[Unreleased]` section) when your
  change is user-facing.
- Describe **what** and **why** in the PR description. Screenshots help for UI.

## Security-sensitive changes

This library captures screenshots, console, and network context, and ships
backend rules. If your change touches capture, redaction, visibility defaults,
or the SQL/rules under `backend/`, call that out explicitly in the PR so it gets
extra review. Safe-by-default is a core value here.

## Reporting behaviour issues

Please be kind. This project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](LICENSE).
