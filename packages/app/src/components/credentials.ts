export * as Credentials from "./credentials.js"

import { Credential } from "@ren/schema/credential"
import { Search } from "@ren/util/search"
import { Schema } from "effect"

export type LooseOwner =
  | { readonly kind: "org" }
  | { readonly kind: "space"; readonly spaceId: string }
  | { readonly kind: "person"; readonly userId: string }

export type Owner = LooseOwner | { readonly kind: "profile"; readonly profileId: string }

export const hosts = Credential.splitHosts

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

const pasted = {
  label: Credential.Label,
  value: Schema.NonEmptyString.annotate({ message: "Paste the key." }),
  owner: Schema.String,
}

export const PasteForm = Schema.toStandardSchemaV1(
  Schema.Union([
    Schema.Struct({ ...pasted, anyHost: Schema.Literal(false), hosts: Credential.HostsText }),
    Schema.Struct({ ...pasted, anyHost: Schema.Literal(true), hosts: Schema.String }),
  ]),
)

export const hostsOf = (value: { readonly anyHost: boolean; readonly hosts: string }) =>
  value.anyHost ? [Credential.anyHost] : hosts(value.hosts)

export const RotateForm = Schema.toStandardSchemaV1(
  Schema.Struct({ value: Schema.NonEmptyString.annotate({ message: "Paste the new key." }) }),
)

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
