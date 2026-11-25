import { Bytes } from "@ren/util/bytes"
import { NumberFormat } from "@ren/util/number-format"

export const initials = (name: string) =>
  name
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word.at(0) ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase()

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

export type Role = "owner" | "admin" | "member"

export const roleLabel: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" }

export const isRole = (value: string): value is Role => Object.hasOwn(roleLabel, value)

export const modelKey = (model: { readonly providerID: string; readonly id: string }) =>
  `${model.providerID}/${model.id}`

export const formText = (form: FormData, name: string) => {
  const value = form.get(name)
  return typeof value === "string" ? value : ""
}

export const formatBytes = Bytes.format

export const formatCount = NumberFormat.count

export const formatTokens = NumberFormat.tokens

export const formatMicroUsd = NumberFormat.microUsd

// oxlint-disable-next-line ren/no-comments -- A price per 1M tokens: at most two decimals; a positive price below a cent never shows as $0.
export const formatPerMillion = (value: number) => {
  if (value > 0 && value < 0.01) return "<$0.01"
  return `$${value < 10 ? value.toFixed(2).replace(/\.?0+$/u, "") : Math.round(value)}`
}
