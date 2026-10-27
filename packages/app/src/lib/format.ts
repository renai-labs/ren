const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" })
const shortDateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

export const initials = (name: string) =>
  name
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word.at(0) ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase()

export const formatDate = (value: string | Date) => dateFormat.format(new Date(value))

export const formatShortDate = (value: string | Date) => shortDateFormat.format(new Date(value))


const units = [
  { unit: "year", ms: 365 * 86_400_000 },
  { unit: "month", ms: 30 * 86_400_000 },
  { unit: "week", ms: 7 * 86_400_000 },
  { unit: "day", ms: 86_400_000 },
  { unit: "hour", ms: 3_600_000 },
  { unit: "minute", ms: 60_000 },
] as const

export function formatRelative(value: string | Date, now = Date.now()) {
  const difference = new Date(value).getTime() - now
  const found = units.find((each) => Math.abs(difference) >= each.ms)
  if (!found) return "just now"
  return relativeFormat.format(Math.round(difference / found.ms), found.unit)
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

export type Role = "owner" | "admin" | "member"

export const roleLabel: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" }

export const isRole = (value: string): value is Role => Object.hasOwn(roleLabel, value)

export const modelKey = (model: { readonly providerID: string; readonly id: string }) => `${model.providerID}/${model.id}`

export const formText = (form: FormData, name: string) => {
  const value = form.get(name)
  return typeof value === "string" ? value : ""
}
