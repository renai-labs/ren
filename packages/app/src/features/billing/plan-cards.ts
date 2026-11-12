import type { BillingInvoiceStatus, BillingPlan, BillingSummary } from "@ren/client"

export type PlanTransition = "subscribe" | "upgrade" | "downgrade" | "cancel"

export type PlanCard = {
  readonly key: string
  readonly name: string
  readonly price: string
  readonly cadence: string | null
  readonly featuresLabel: string
  readonly features: ReadonlyArray<string>
  readonly status: string | null
  readonly current: boolean
  readonly tiers: ReadonlyArray<{ readonly key: string; readonly label: string }> | null
  readonly action: { readonly label: string; readonly transition: PlanTransition } | null
}

const microUsdPerUsd = 1_000_000

const freeFeatures = [
  "Bring your own Claude and ChatGPT subscriptions",
  "Agents in Slack and GitHub",
  "Session traces for every run",
]

const scaleFeatures = ["Higher monthly credit allowances", "Priority support"]

export const freePlan = "free"

export function planName(key: string, plans: ReadonlyArray<BillingPlan> | undefined) {
  if (key === freePlan) return "Free"
  return plans?.find((plan) => plan.key === key)?.name ?? "Plan"
}

export function planPriceCents(key: string, plans: ReadonlyArray<BillingPlan> | undefined) {
  if (key === freePlan) return 0
  return plans?.find((plan) => plan.key === key)?.priceCents ?? 0
}

const grouped = (whole: number) => String(whole).replaceAll(/\B(?=(\d{3})+(?!\d))/gu, ",")

export const wholeDollars = (cents: number) => `$${grouped(Math.round(cents / 100))}`

export const dollars = (microUsd: number) => `$${(microUsd / microUsdPerUsd).toFixed(2)}`

const creditsLine = (microUsd: number) => `${wholeDollars((microUsd / microUsdPerUsd) * 100)} in credits every month`

function families(plans: ReadonlyArray<BillingPlan>) {
  return plans.reduce<Array<{ name: string; tiers: Array<BillingPlan> }>>((found, plan) => {
    const family = found.find((each) => each.name === plan.name)
    if (family) family.tiers.push(plan)
    else found.push({ name: plan.name, tiers: [plan] })
    return found
  }, [])
}

const sorted = (plans: ReadonlyArray<BillingPlan> | undefined) =>
  (plans ?? []).toSorted((a, b) => a.sortOrder - b.sortOrder)

export function defaultTiers(plans: ReadonlyArray<BillingPlan> | undefined, current: string) {
  return Object.fromEntries(
    families(sorted(plans)).flatMap((family) => {
      const chosen = family.tiers.find((tier) => tier.key === current) ?? family.tiers.at(0)
      return chosen ? [[family.name, chosen.key]] : []
    }),
  )
}

export function planCards(input: {
  readonly billing: Pick<BillingSummary, "plan" | "planStatus" | "renewsAt">
  readonly plans: ReadonlyArray<BillingPlan> | undefined
  readonly tiers: Readonly<Record<string, string>>
  readonly formatDate: (value: string) => string
}): ReadonlyArray<PlanCard> {
  const paid = sorted(input.plans)
  const price = (key: string) => planPriceCents(key, paid)
  const current = input.billing.plan
  const cancelScheduled = input.billing.planStatus === "cancel_scheduled"
  const date = input.billing.renewsAt ? input.formatDate(input.billing.renewsAt) : null

  const resolve = (base: Omit<PlanCard, "status" | "current" | "action">): PlanCard => {
    if (base.key === current)
      return {
        ...base,
        current: true,
        status: date ? `${cancelScheduled ? "Ends" : "Renews"} ${date}` : null,
        action: null,
      }
    if (cancelScheduled)
      return { ...base, current: false, status: base.key === freePlan && date ? `Starts ${date}` : null, action: null }
    if (base.key === freePlan)
      return { ...base, current: false, status: null, action: { label: "Cancel plan", transition: "cancel" } }
    if (current === freePlan)
      return { ...base, current: false, status: null, action: { label: "Subscribe", transition: "subscribe" } }
    const upgrade = price(base.key) > price(current)
    return {
      ...base,
      current: false,
      status: null,
      action: upgrade ? { label: "Upgrade", transition: "upgrade" } : { label: "Downgrade", transition: "downgrade" },
    }
  }

  const free = resolve({
    key: freePlan,
    name: "Free",
    price: "Free",
    cadence: null,
    featuresLabel: "Includes:",
    features: freeFeatures,
    tiers: null,
  })
  return [
    free,
    ...families(paid).map((family, index, all) => {
      const selected = family.tiers.find((tier) => tier.key === input.tiers[family.name]) ?? family.tiers[0]
      return resolve({
        key: selected?.key ?? family.name,
        name: family.name,
        price: wholeDollars(selected?.priceCents ?? 0),
        cadence: "/month",
        featuresLabel: `Everything in ${all[index - 1]?.name ?? "Free"}, plus:`,
        features: [creditsLine(selected?.creditsMicroUsd ?? 0), ...(index === 0 ? [] : scaleFeatures)],
        tiers:
          family.tiers.length > 1
            ? family.tiers.map((tier) => ({ key: tier.key, label: `${wholeDollars(tier.priceCents)}/month` }))
            : null,
      })
    }),
  ]
}

export function confirmCopy(input: {
  readonly transition: PlanTransition
  readonly name: string
  readonly priceCents: number
  readonly endsOn: string | null
}) {
  const price = `$${(input.priceCents / 100).toFixed(2)}`
  switch (input.transition) {
    case "subscribe":
      return {
        title: `Subscribe to ${input.name}`,
        description: `Checkout opens in a new tab. Credits arrive once the ${price} payment clears.`,
        action: "Continue to checkout",
      }
    case "upgrade":
      return {
        title: `Upgrade to ${input.name}`,
        description: `${price} is charged to your saved card now. New credits arrive once it clears.`,
        action: "Upgrade",
      }
    case "downgrade":
      return {
        title: `Downgrade to ${input.name}`,
        description: `Switches to ${price}/month on your next billing date. Nothing is charged today and current credits stay.`,
        action: "Downgrade",
      }
    case "cancel":
      return {
        title: "Cancel plan",
        description: `You keep access until ${input.endsOn ?? "your next billing date"}, then move to Free. Resubscribe anytime.`,
        action: "Cancel plan",
      }
  }
}

export type ProgressState = "processing" | "slow" | "done"

export const slowAfterMs: Record<Exclude<PlanTransition, "cancel">, number> = {
  subscribe: 10 * 60_000,
  upgrade: 90_000,
  downgrade: 90_000,
}

export function progressCopy(transition: Exclude<PlanTransition, "cancel">, state: ProgressState, name: string) {
  if (state === "done")
    return transition === "downgrade"
      ? { title: "Downgrade scheduled", description: `${name} starts on your next billing date.` }
      : { title: `You’re on ${name}`, description: "Credits have been added." }
  if (state === "slow")
    return transition === "subscribe"
      ? { title: "Still waiting for checkout", description: "Close this to pick a plan again." }
      : { title: "Still processing", description: "Your bank is slower than usual. This updates on its own." }
  if (transition === "subscribe")
    return { title: "Waiting for payment", description: "Finish checkout in the tab that opened." }
  return transition === "downgrade"
    ? { title: "Scheduling your change", description: undefined }
    : { title: "Charging your card", description: "Usually under a minute." }
}

const invoiceStatuses: Record<BillingInvoiceStatus, { label: string; tone: "paid" | "failed" | "neutral" }> = {
  paid: { label: "Paid", tone: "paid" },
  pending: { label: "Pending", tone: "neutral" },
  processing: { label: "Processing", tone: "neutral" },
  failed: { label: "Failed", tone: "failed" },
  cancelled: { label: "Cancelled", tone: "failed" },
}

export const invoiceStatus = (status: BillingInvoiceStatus) => invoiceStatuses[status]

export const formatMoney = (amountMinorUnits: number, currency: string) =>
  currency === "USD"
    ? `$${grouped(Math.trunc(amountMinorUnits / 100))}.${String(Math.abs(amountMinorUnits) % 100).padStart(2, "0")}`
    : `${(amountMinorUnits / 100).toFixed(2)} ${currency}`

export function remainingPercent(availableMicroUsd: number, grantedMicroUsd: number) {
  if (!(grantedMicroUsd > 0)) return 0
  return Math.min(Math.max((availableMicroUsd / grantedMicroUsd) * 100, 0), 100)
}
