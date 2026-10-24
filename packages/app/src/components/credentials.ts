export * as Credentials from "./credentials.js"

import { Credential } from "@ren/schema/credential"
import { Search } from "@ren/util/search"
import { Schema } from "effect"

export type LooseOwner =
  | { readonly kind: "org" }
  | { readonly kind: "space"; readonly spaceId: string }
  | { readonly kind: "person"; readonly userId: string }

export type Owner = LooseOwner | { readonly kind: "profile"; readonly profileId: string }

export type Group = "mcp" | "other"

export const hosts = Credential.splitHosts

export const group = (label: string): Group => (label.startsWith("MCP_") ? "mcp" : "other")

export const ownerLabel = (owner: Owner, spaces: ReadonlyMap<string, string>, userId: string) => {
  if (owner.kind === "org") return "Organization"
  if (owner.kind === "space") return spaces.get(owner.spaceId) ?? "A space"
  if (owner.kind === "profile") return "App profile"
  return owner.userId === userId ? "You" : "Personal"
}

export const canCopy = (credential: { readonly type: string; readonly account: unknown }) =>
  (credential.type === "key" || credential.type === "basic" || credential.type === "fields") && !credential.account

export const matches = (
  credential: { readonly label: string; readonly name: string | null; readonly hosts: ReadonlyArray<string> },
  needle: string,
) => Search.matches([credential.label, credential.name ?? "", ...credential.hosts], needle)

export const PasteForm = Schema.toStandardSchemaV1(
  Schema.Struct({
    label: Credential.Label,
    name: Schema.String,
    hosts: Credential.HostsText,
    value: Schema.NonEmptyString.annotate({ message: "Paste the key." }),
    owner: Schema.String,
  }),
)

export const RotateForm = Schema.toStandardSchemaV1(
  Schema.Struct({ value: Schema.NonEmptyString.annotate({ message: "Paste the new key." }) }),
)

export const RenameForm = Schema.toStandardSchemaV1(Schema.Struct({ name: Schema.String }))

export const OwnerForm = Schema.toStandardSchemaV1(Schema.Struct({ owner: Schema.NonEmptyString }))

// oxlint-disable-next-line ren/no-comments -- An owner option is "org", "person" or "space:<id>", so one Select can name every owner.
export const ownerOf = (value: string, userId: string): LooseOwner => {
  if (value === "org") return { kind: "org" }
  if (value === "person") return { kind: "person", userId }
  return { kind: "space", spaceId: value.slice("space:".length) }
}

export const ownerValue = (owner: Owner) => {
  if (owner.kind === "space") return `space:${owner.spaceId}`
  if (owner.kind === "profile") return `profile:${owner.profileId}`
  return owner.kind
}
