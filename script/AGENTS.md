# Lint rules

- Rules live in `oxlint.config.ts` at the repo root, the Ren Oxlint plugin (`script/oxlint/ren/`) and `script/ast-grep/`. Oxlint loads its config and plugin through Node (see `.node-version`).
- Oxlint runs once per package through Turbo, after the package's dependencies have typechecked, so tsgolint reads their declarations from `node_modules/.ts-dist`. The run is cached. Resolve paths in `oxlint.config.ts` from the config file, not the working directory, and add any file the config reads to the `lint` inputs in `turbo.json`.
- The root tools (`oxlint` on `script`, ast-grep, knip, `oxfmt --check`) are Turbo root tasks (`//#lint:root`, `//#lint:rules`, `//#lint:unused`, `//#format:check`) with explicit inputs, so a run with no relevant change is a cache hit.
- Every rule applies to every file. Overrides in `oxlint.config.ts` are by file type only, with two package-scoped exceptions: the architecture blocks at the end, and `packages/ui`, which drops the Tailwind restrictions and `react/only-export-components` that shadcn's components break (raw values, motion classes, `!important`, exported variants).
- Lint rules have no unit tests. The codebase is their test, so a new rule lands with fixes for everything it reports.
- Rules turned off on purpose:
  - `better-tailwindcss/enforce-canonical-classes`: it round-trips a worker per class list and took 6 to 8 seconds per package, 80% of the lint time of `ui` and `site`, for a stylistic hint.
  - `oxc/no-barrel-file`: every module starts with `export * as X from "./x.js"`.
  - `unicorn/throw-new-error`: it misreads Effect's `Schema.TaggedError<X>()(...)`.
  - `typescript/only-throw-error`: TanStack Router throws `redirect()`.
  - `unicorn/prefer-global-this`: `globalThis.x` would bypass the `window.x` restrictions.
  - `eslint/no-useless-return`: it conflicts with `noImplicitReturns`.
  - `eslint/require-yield`: `Effect.fn` takes generators that may not yield.
  - `noPropertyAccessFromIndexSignature`: `noUncheckedIndexedAccess` already types index access as possibly `undefined`.
