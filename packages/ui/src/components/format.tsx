const usdFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const countFormat = new Intl.NumberFormat("en-US")
const rateFormat = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 21, useGrouping: false })

export function formatUsdRate(value: number): string {
  return `$${rateFormat.format(value)}`
}

export function formatUsd(value: number): string {
  if (value >= 10_000) return `$${Math.round(value / 1000)}k`
  return `$${usdFormat.format(value)}`
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}M`
  }
  if (value >= 1000) return `${Math.round(value / 1000)}k`
  return String(Math.round(value))
}

export function formatCount(value: number): string {
  return countFormat.format(Math.round(value))
}
