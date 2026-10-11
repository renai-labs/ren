# @ren/schema

- Dependency direction: `@ren/schema` <- `@ren/protocol` / `@ren/db` / `@ren/core` <- `@ren/server`. Schema imports nothing from Ren.
- Keep the package browser-safe: no Node, Bun or platform APIs.
- One module per domain, starting with a self-namespace export (`export * as Pod from "./pod.js"`), re-exported from `src/index.ts`.
- Exported schemas use PascalCase (`Info`, `ID`, `Status`). Do not add aliases such as `PodSchema`.
- Pair each struct with a same-name interface: `export interface Info extends Schema.Schema.Type<typeof Info> {}`.
- Give every exported schema a stable, domain-qualified identifier: `.annotate({ identifier: "Pod.Info" })`.
- Prefixed IDs use `Identifier.make("pod", "Pod.ID")`: a branded `<prefix>_<ULID>` schema with a `create()` static. Prefixes are unique across Ren.
- Contracts are readonly. Do not use `Schema.Any` or `Schema.Unknown` in contracts unless the payload is genuinely opaque.
