# Vendored repositories

Everything here is read-only reference material:

- Never import from `repos/`. Application code imports normal package dependencies.
- Do not edit files here unless you are updating a subtree.
- `repos/` is excluded from workspaces, lint, format, typecheck and editor search.

| Path      | Upstream                                                | Ref            |
| --------- | ------------------------------------------------------- | -------------- |
| `effect/` | [Effect-TS/effect](https://github.com/Effect-TS/effect) | `effect@4.0.1` |

The Effect subtree tracks the release tag that matches the `effect` version in the root `package.json` catalog, so the vendored source is exactly the code that runs.

## Updating

Bump the subtree and the catalog together, to the same release:

```sh
git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git effect@<version> --squash
```

Then:

1. Set `effect` and `@effect/*` in the root `package.json` catalog to `<version>`, run `bun install` and `bun run check`.
2. Update the ref in the table above.
3. Add the new `Squashed 'repos/effect/' content …` commit SHA to `commits` in `.gitleaks.toml`. Squash commits store vendored files at their own root, so the `repos/` path allowlist does not cover them, and their test fixtures trip the secret scan.

## Adding a repository

```sh
git subtree add --prefix=repos/<name> <url> <branch> --squash
```

Add it to the table above and mention it in the root `AGENTS.md` if agents should consult it for specific work.
