export * as Bundle from "./bundle.js"

import { Schema } from "effect"

// oxlint-disable-next-line ren/no-comments -- Ren's code for a machine, in three archives: the npm dependencies, which change with bun.lock, and the brain's and the executor's own sources, which change with each deploy (EN26).
export const Kind = Schema.Literals(["dependencies", "brain", "executor"]).annotate({ identifier: "Bundle.Kind" })
export type Kind = typeof Kind.Type

export const Version = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/)).annotate({
  identifier: "Bundle.Version",
  description: "The hash of the bundle’s files.",
})

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  kind: Kind,
  version: Version,
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).annotate({
    description: "The SHA-256 of the archive, which a machine checks before it unpacks it.",
  }),
}).annotate({ identifier: "Bundle.Info" })

export interface Manifest extends Schema.Schema.Type<typeof Manifest> {}
export const Manifest = Schema.Struct({
  builtAt: Schema.DateTimeUtcFromString.annotate({
    description: "When the bundles were built. A server moves the current bundles only to a later build (EN29).",
  }),
  bundles: Schema.Array(Info),
}).annotate({ identifier: "Bundle.Manifest" })

export const fileOf = (info: Pick<Info, "kind" | "version">) => `${info.kind}-${info.version}.tar.gz`
