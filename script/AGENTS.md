# Lint rules

- Rules live in `oxlint.config.ts` at the repo root, the Ren Oxlint plugin (`script/oxlint/ren/`) and `script/ast-grep/`. Oxlint loads its config and plugin through Node (see `.node-version`).
- Oxlint runs once per package through Turbo and is cached. Resolve paths in `oxlint.config.ts` from the config file, not the working directory, and add any file the config reads to the `lint` inputs in `turbo.json`.
- Every rule applies to every file. Overrides in `oxlint.config.ts` are by file type only, with two package-scoped exceptions: the architecture blocks at the end, and `packages/ui`, which drops the Tailwind restrictions and `react/only-export-components` that shadcn's components break (raw values, motion classes, `!important`, exported variants).
- Lint rules have no unit tests. The codebase is their test, so a new rule lands with fixes for everything it reports.
- Rules turned off on purpose:
  - `oxc/no-barrel-file`: every module starts with `export * as X from "./x.js"`.
  - `unicorn/throw-new-error`: it misreads Effect's `Schema.TaggedError<X>()(...)`.
  - `typescript/only-throw-error`: TanStack Router throws `redirect()`.
  - `unicorn/prefer-global-this`: `globalThis.x` would bypass the `window.x` restrictions.
  - `eslint/no-useless-return`: it conflicts with `noImplicitReturns`.
  - `eslint/require-yield`: `Effect.fn` takes generators that may not yield.
  - `noPropertyAccessFromIndexSignature`: `noUncheckedIndexedAccess` already types index access as possibly `undefined`.
