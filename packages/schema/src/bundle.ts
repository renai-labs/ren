export * as Bundle from "./bundle.js"

import { Schema } from "effect"

// oxlint-disable-next-line ren/no-comments -- Ren's code for a machine, in three archives: the npm dependencies, which change with bun.lock, and the brain's and the executor's own sources, which change with each deploy.
export const Kind = Schema.Literals(["dependencies", "brain", "executor"]).annotate({ identifier: "Bundle.Kind" })
export type Kind = typeof Kind.Type

export const kinds = Kind.literals

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
export const Manifest = Schema.Struct({ bundles: Schema.Array(Info) }).annotate({
  identifier: "Bundle.Manifest",
  description: "The bundles of one build, the dependencies first. The deploy makes one manifest current.",
})

export interface Download extends Schema.Schema.Type<typeof Download> {}
export const Download = Schema.Struct({
  ...Info.fields,
  url: Schema.String.annotate({ description: "A link that downloads the archive for a short time." }),
  tree: Schema.String.annotate({
    description: "The folder the machine unpacks it into: the version, and for sources the dependencies’ too.",
  }),
}).annotate({ identifier: "Bundle.Download" })

// oxlint-disable-next-line ren/no-comments -- How Ren gives a machine its downloads: REN_BUNDLES at its start, and an update's payload.
export const Downloads = Schema.fromJsonString(Schema.Array(Download))

// oxlint-disable-next-line ren/no-comments -- Where the deploy stores an archive, under the bucket's bundles/ folder.
export const keyOf = (info: Pick<Info, "kind" | "version">) => `${info.kind}/${info.version}.tar.gz`

export const manifestKey = "current.json"

// oxlint-disable-next-line ren/no-comments -- A source bundle unpacks onto a copy of the dependencies, so its folder names both: a new dependencies bundle gives each source bundle a new folder.
export const treeOf = (bundles: ReadonlyArray<Pick<Info, "kind" | "version">>, kind: Kind) => {
  const versions = versionsOf(bundles)
  return kind === "dependencies" ? versions.dependencies : `${versions[kind]}-${versions.dependencies}`
}

// oxlint-disable-next-line ren/no-comments -- The version of each kind, as a machine's row keeps them; empty for a kind that is missing.
export const versionsOf = (bundles: ReadonlyArray<Pick<Info, "kind" | "version">>) => {
  const version = (kind: Kind) => bundles.find((bundle) => bundle.kind === kind)?.version ?? ""
  return { dependencies: version("dependencies"), brain: version("brain"), executor: version("executor") }
}
