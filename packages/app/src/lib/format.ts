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

const byteUnits = ["B", "KB", "MB", "GB"] as const

export function formatBytes(bytes: number) {
  const exponent = Math.min(
    byteUnits.length - 1,
    Math.max(0, Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1000))),
  )
  const value = bytes / 1000 ** exponent
  return `${exponent === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${byteUnits[exponent]}`
}
