export * as LimitBanners from "./limit-banners.js"

interface Shared {
  readonly key: string
  readonly percent: number
}

// oxlint-disable-next-line ren/no-comments -- The limits of `limits.get` (`Limits.Limit`), with times as the API sends them.
export type Limit =
  | (Shared & {
      readonly _tag: "seat"
      readonly resetsAt: string | null
      readonly seat: string
      readonly providerName: string
      readonly window: string
      readonly title: string
    })
  | (Shared & { readonly _tag: "free"; readonly resetsAt: string; readonly used: number; readonly limit: number })

// oxlint-disable-next-line ren/no-comments -- The Ren credit of `limits.get` (`Limits.Credit`): billing's balance, not a limit, with a banner of its own.
export type Credit = Shared & {
  readonly _tag: "credit"
  readonly resetsAt: string | null
  readonly availableMicroUsd: number
}

type Warning = Limit | Credit

export interface Banner {
  readonly id: string
  readonly step: number
  readonly text: string
  readonly action?: "billing"
}

export const steps = [75, 80, 85, 90, 95, 100] as const

const stepOf = (percent: number) => steps.findLast((step) => percent >= step)

const windowName = (limit: Extract<Limit, { _tag: "seat" }>) => {
  const found = /^(\d+)([hd])$/u.exec(limit.window)
  if (!found) return limit.title
  return `${found.at(1)}-${found.at(2) === "h" ? "hour" : "day"} limit`
}

const resetText = (resetsAt: string | null, timeZone: string | undefined) =>
  resetsAt
    ? ` · resets ${new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone,
      })
        .format(new Date(resetsAt))
        .replace(",", "")}`
    : ""

const textOf = (warning: Warning, timeZone: string | undefined) => {
  if (warning._tag === "seat")
    return `${warning.providerName} seat (${warning.seat}): ${warning.percent}% of ${windowName(warning)} used${resetText(warning.resetsAt, timeZone)}`
  if (warning._tag === "credit")
    return `Ren credit: ${warning.percent}% used · $${(Math.max(0, warning.availableMicroUsd) / 1_000_000).toFixed(2)} left`
  return `Free models: ${warning.used} of ${warning.limit} today · resets 00:00 UTC`
}

// oxlint-disable-next-line ren/no-comments -- Providers P21: the banner of the fullest limit or credit whose step this chat has not dismissed in its reset period. A step that is passed before it shows is skipped.
export const next = (input: {
  readonly chat: string
  readonly limits: ReadonlyArray<Limit>
  readonly credit: Credit | null
  readonly dismissed: ReadonlySet<string>
  readonly timeZone?: string | undefined
}): Banner | undefined => {
  const found = [...input.limits, ...(input.credit ? [input.credit] : [])]
    .flatMap((warning) => {
      const step = stepOf(warning.percent)
      if (!step) return []
      const id = [input.chat, warning.key, warning.resetsAt?.slice(0, 16) ?? "", step].join("|")
      return input.dismissed.has(id) ? [] : [{ warning, step, id }]
    })
    .reduce<{ readonly warning: Warning; readonly step: number; readonly id: string } | undefined>(
      (fullest, each) => (!fullest || each.warning.percent > fullest.warning.percent ? each : fullest),
      undefined,
    )
  if (!found) return undefined
  return {
    id: found.id,
    step: found.step,
    text: textOf(found.warning, input.timeZone),
    ...(found.warning._tag === "credit" && { action: "billing" as const }),
  }
}
