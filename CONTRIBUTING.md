# Contributing

Thanks for taking a look. This is a small, dependency-light DSH plugin; the fastest way to
understand it is to read two files: `index.mjs` (host half) and `client.js` (browser half).

## Layout

| Path | Role |
|---|---|
| `index.mjs` | Host half: config, authoritative timer, ledger, case library, HTTP routes, static art |
| `lib/state.mjs` | Pure state machine (`focus → break → awaitReturn`), zero dependencies |
| `lib/config.mjs` | schemastery `Config` schema + defaults (every editable field is `.volatile()`) |
| `lib/cases.mjs` | Built-in case library + background refresh (host web search + host LLM) |
| `lib/store.mjs` | Atomic JSON persistence under `<DSH_HOME>/data/dsh-no-long-sit/` |
| `lib/routes.mjs` | Route constants, cross-origin guard, asset path sanitizer |
| `client.js` | Browser half: `shell.overlay` pet + reminder/case/summary windows + settings card |
| `assets/anim/*.webp` | Pet animations (one looping animated WebP per state) |
| `assets/cases.json` | Built-in real cases (every entry carries a source URL and a date) |
| `tests/*.test.mjs` | `node --test` suite, no DSH required (mock host contract) |

## Develop

```powershell
npm install          # only @deepseek-ai/schemastery (dev)
npm test             # 40 tests, no DSH / no browser / no network
```

Install into a profile for manual testing (use a **scratch** profile and `DSH_HOME`):

```powershell
$env:DSH_HOME='<scratch home>'
dsh plugin --profile <scratch profile> add <path to this repo>
dsh <scratch profile> --port 3099 --no-open    # note: the first positional arg is the profile name
```

## Conventions

- The client bundle is a **classic script** (`window.__ModuleLoader__.load` + `React.createElement`).
  No JSX, no bundler, no `export default` in the host entry (it would shadow the named exports).
- Every settings field must be `.volatile()`, otherwise it never reaches the settings page.
- Settings are read through `settings.describe()` on every entry point — writes do **not** re-apply a plugin.
- Tests must stay offline: no network, no DSH, no credentials.

## Release

1. `npm test`, then `npm pack --dry-run` (record the shasum).
2. Bump `version`, add a `CHANGELOG.md` entry, commit and tag `vX.Y.Z`.
3. Publish to npm **explicitly** against the official registry:
   `npm publish --registry https://registry.npmjs.org --access public`
4. Push `main` + the tag, then compare the published `dist.shasum` with the local pack baseline.
