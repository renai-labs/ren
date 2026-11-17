# Lint rules

- Rules live in `oxlint.config.ts` at the repo root, the Ren Oxlint plugin (`script/oxlint/ren/`) and `script/ast-grep/`. Oxlint loads its config and plugin through Node (see `.node-version`).
- Oxlint runs once per package through Turbo. tsrs, Oxlint's type-aware backend, reads a dependency's source, not its declarations in `node_modules/.ts-dist`: workspace `exports` point at `.ts` files and tsrs follows project references to source like tsserver. The `^typecheck` dependency is not for declarations. It puts the dependencies' sources into the lint cache key, because a dependency's types change a package's lint results. The run is cached. Resolve paths in `oxlint.config.ts` from the config file, not the working directory, and add any file the config reads to the `lint` inputs in `turbo.json`.
- The root tools (`oxlint` on `script`, ast-grep, knip, `oxfmt --check`) are Turbo root tasks (`//#lint:root`, `//#lint:rules`, `//#lint:unused`, `//#format:check`) with explicit inputs, so a run with no relevant change is a cache hit.
- Every rule applies to every file. Overrides in `oxlint.config.ts` are by file type only, with four package-scoped exceptions: the Tailwind rules, which run only in the packages that use Tailwind (`app`, `ui`, `site`, `mobile`), because they visit every node and cost about 3 seconds of CPU in a package without a class list; the architecture blocks at the end; `packages/ui`, which drops the Tailwind restrictions and `react/only-export-components` that shadcn's components break (raw values, motion classes, `!important`, exported variants); and `packages/mobile`, which checks classes against its Uniwind entry (including `*ClassName` props), allows `role` on React Native views and default exports in Expo Router routes.
- Lint rules have no unit tests. The codebase is their test, so a new rule lands with fixes for everything it reports.
- Rules turned off on purpose:
  - `better-tailwindcss/enforce-canonical-classes`: it round-trips a worker per class list and took 6 to 8 seconds per package, 80% of the lint time of `ui` and `site`, for a stylistic hint.
  - `better-tailwindcss/enforce-shorthand-classes`: a stylistic hint (`w-4 h-4` to `size-4`) that took 2.4 seconds of CPU in `app`, 15% of its lint time.
  - The rules in `checkedByTypeScript`, for `.ts` and `.tsx` files: the compiler already reports them as errors (`noUnusedLocals` and `noUnusedParameters` for unused code), and every such file is in a tsconfig program except `oxlint.config.ts`, which keeps them. `.astro` and `.js` files keep them too. `eslint/no-unreachable` and `eslint/no-unused-labels` stay on, because without `allowUnreachableCode: false` and `allowUnusedLabels: false` the compiler only shows them as editor hints.
  - `oxc/no-barrel-file`: every module starts with `export * as X from "./x.js"`.
  - `unicorn/throw-new-error`: it misreads Effect's `Schema.TaggedError<X>()(...)`.
  - `typescript/only-throw-error`: TanStack Router throws `redirect()`.
  - `unicorn/prefer-global-this`: `globalThis.x` would bypass the `window.x` restrictions.
  - `eslint/no-useless-return`: it conflicts with `noImplicitReturns`.
  - `eslint/require-yield`: `Effect.fn` takes generators that may not yield.
  - `noPropertyAccessFromIndexSignature`: `noUncheckedIndexedAccess` already types index access as possibly `undefined`.
