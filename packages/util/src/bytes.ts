export * as Bytes from "./bytes.js"

const units = ["B", "KB", "MB", "GB"] as const

export function format(bytes: number) {
  const exponent = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1000))))
  const value = bytes / 1000 ** exponent
  return `${exponent === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[exponent]}`
}
