import type { RenInference } from "@ren/schema/ren-inference"

export const periods: ReadonlyArray<{
  readonly value: RenInference.Period
  readonly label: string
}> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
]

export const noCalls = (period: RenInference.Period) =>
  period === "all"
    ? "No calls yet."
    : `No calls in the ${periods.find((each) => each.value === period)?.label.toLowerCase()}.`

export const dollars = (micro: number) => micro / 1_000_000
