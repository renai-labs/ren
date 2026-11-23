export * as LimitBanners from "./limit-banners.js"

interface Shared {
  readonly key: string
  readonly percent: number
}

// oxlint-disable-next-line ren/no-comments -- The meters of `limits.get` (`Limits.Meter`), with times as the API sends them.
export type Meter =
  | (Shared & {
      readonly _tag: "seat"
      readonly resetsAt: string | null
      readonly seat: string
      readonly providerName: string
      readonly window: string
      readonly title: string
    })
  | (Shared & { readonly _tag: "credit"; readonly resetsAt: string | null; readonly availableMicroUsd: number })
  | (Shared & { readonly _tag: "free"; readonly resetsAt: string; readonly used: number; readonly limit: number })

export interface Banner {
  readonly id: string
  readonly step: number
  readonly text: string
  readonly action?: "billing"
}

export const steps = [75, 80, 85, 90, 95, 100] as const

const stepOf = (percent: number) => steps.findLast((step) => percent >= step)

const windowName = (meter: Extract<Meter, { _tag: "seat" }>) => {
  const found = /^(\d+)([hd])$/u.exec(meter.window)
  if (!found) return meter.title
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

const textOf = (meter: Meter, timeZone: string | undefined) => {
  if (meter._tag === "seat")
    return `${meter.providerName} seat (${meter.seat}): ${meter.percent}% of ${windowName(meter)} used${resetText(meter.resetsAt, timeZone)}`
  if (meter._tag === "credit")
    return `Ren credit: ${meter.percent}% used · $${(Math.max(0, meter.availableMicroUsd) / 1_000_000).toFixed(2)} left`
  return `Free models: ${meter.used} of ${meter.limit} today · resets 00:00 UTC`
}

// oxlint-disable-next-line ren/no-comments -- Providers P21: the banner of the fullest meter whose step this chat has not dismissed in the meter's reset period. A step that is passed before it shows is skipped.
export const next = (input: {
  readonly chat: string
  readonly meters: ReadonlyArray<Meter>
  readonly dismissed: ReadonlySet<string>
  readonly timeZone?: string | undefined
}): Banner | undefined => {
  const found = input.meters
    .flatMap((meter) => {
      const step = stepOf(meter.percent)
      if (!step) return []
      const id = [input.chat, meter.key, meter.resetsAt?.slice(0, 16) ?? "", step].join("|")
      return input.dismissed.has(id) ? [] : [{ meter, step, id }]
    })
    .reduce<{ readonly meter: Meter; readonly step: number; readonly id: string } | undefined>(
      (fullest, each) => (!fullest || each.meter.percent > fullest.meter.percent ? each : fullest),
      undefined,
    )
  if (!found) return undefined
  return {
    id: found.id,
    step: found.step,
    text: textOf(found.meter, input.timeZone),
    ...(found.meter._tag === "credit" && { action: "billing" as const }),
  }
}
