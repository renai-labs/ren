export * as NumberFormat from "./number-format.js"

export const count = (value: number) => String(Math.round(value)).replaceAll(/\B(?=(\d{3})+(?!\d))/gu, ",")

export function tokens(value: number) {
  if (value < 1000) return String(value)
  if (value < 999_500) return `${Number((value / 1000).toFixed(value < 10_000 ? 1 : 0))}k`
  return `${Number((value / 1_000_000).toFixed(1))}M`
}

export function microUsd(micro: number) {
  const dollars = micro / 1_000_000
  return dollars < 0.01 ? "<$0.01" : `$${dollars.toFixed(2)}`
}
