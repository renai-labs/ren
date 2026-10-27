import { Select } from "@base-ui/react/select"
import { IconCheck, IconChevronDown, IconChevronUp } from "@tabler/icons-react"
import { useState } from "react"
import { BILLING_URL, demoHref } from "../../lib/links.js"
import { cn } from "../../lib/utils.js"
import { buttonClass } from "../ui/button.js"
import { TEAM_TIER_DEFAULT, TEAM_TIER_GROUPS, type PlanCtaVariant, type PricingPlan } from "./pricing-data.js"

const CTA_CLASS: Record<PlanCtaVariant, string> = {
  primary: "border-transparent bg-foreground text-site-bg hover:bg-foreground/90 hover:text-site-bg",
  muted: "border-transparent bg-tint-4 text-foreground hover:bg-tint-5",
  outline: "",
}

const formatUsd = (amount: number) => `$${amount.toLocaleString("en-US")}`

function PlanAction({ plan }: { plan: PricingPlan }) {
  const href = plan.key === "enterprise" ? demoHref("pricing-enterprise") : BILLING_URL

  return (
    <a
      href={href}
      className={buttonClass({
        variant: "outline",
        size: "lg",
        className: cn(
          "box-border h-12 min-h-12 w-full rounded-full px-6 py-0 max-lg:mt-auto",
          CTA_CLASS[plan.ctaVariant],
        ),
      })}
    >
      {plan.cta}
    </a>
  )
}

function TierOption(props: { tier: number }) {
  return (
    <Select.Item
      value={String(props.tier)}
      className="relative my-0.5 flex w-full cursor-default items-center gap-2 rounded-lg py-2.5 pr-8 pl-3 text-sm text-secondary-foreground outline-hidden select-none data-highlighted:bg-tint-4 data-highlighted:text-foreground"
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <Select.ItemIndicator>
          <IconCheck className="size-4" />
        </Select.ItemIndicator>
      </span>
      <Select.ItemText>{formatUsd(props.tier)} / month</Select.ItemText>
    </Select.Item>
  )
}

function TierSelect({ tier, onChange }: { tier: number; onChange: (tier: number) => void }) {
  return (
    <Select.Root value={String(tier)} onValueChange={(value) => onChange(Number(value))}>
      <Select.Trigger
        aria-label="Monthly spend"
        className="flex h-10 w-full max-w-68 min-w-0 items-center justify-between gap-2 rounded-full border border-tint-4 bg-tint-2 px-4 py-0 text-sm text-secondary-foreground shadow-ring transition-[box-shadow,color] outline-none focus-visible:border-tint-6 focus-visible:shadow-ring-brand [&>span]:truncate"
      >
        <Select.Value>{(value: string) => `${formatUsd(Number(value))} / month`}</Select.Value>
        <Select.Icon render={<IconChevronDown className="size-4 shrink-0 text-icon-tertiary" />} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} align="start" alignItemWithTrigger={false} className="z-50">
          <Select.Popup className="relative max-h-96 min-w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-tint-4 bg-popover p-1 text-popover-foreground shadow-button transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Select.ScrollUpArrow className="flex cursor-default items-center justify-center py-1">
              <IconChevronUp className="size-4" />
            </Select.ScrollUpArrow>
            {TEAM_TIER_GROUPS.map((group, groupIndex) => (
              <Select.Group key={group.label}>
                {groupIndex > 0 ? <Select.Separator className="pointer-events-none -mx-1 my-2 h-px bg-tint-4" /> : null}
                <Select.GroupLabel className="px-3 pt-2.5 pb-1.5 text-xs font-medium text-muted-foreground uppercase">
                  {group.label}
                </Select.GroupLabel>
                {group.tiers.map((option) => (
                  <TierOption key={option} tier={option} />
                ))}
              </Select.Group>
            ))}
            <Select.ScrollDownArrow className="flex cursor-default items-center justify-center py-1">
              <IconChevronDown className="size-4" />
            </Select.ScrollDownArrow>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

function PlanCard({ plan }: { plan: PricingPlan }) {
  const [tier, setTier] = useState(TEAM_TIER_DEFAULT)
  const isTeam = plan.key === "team"

  return (
    <article
      className={cn(
        "relative flex flex-col border-tint-4 px-6 py-8 max-lg:border-b max-lg:last:border-b-0 sm:px-8 sm:py-10 lg:row-span-6 lg:grid lg:grid-rows-subgrid lg:border-r lg:last:border-r-0",
        plan.highlighted ? "bg-tint-1" : "bg-site-bg",
      )}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-title-3 font-medium text-foreground">{plan.name}</h2>
        {plan.badge ? (
          <span className="inline-flex h-6 items-center rounded-full border border-tint-5 bg-tint-3 px-2.5 text-micro font-medium text-secondary-foreground">
            {plan.badge}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-10 flex-wrap items-baseline gap-2">
        {isTeam ? (
          <TierSelect tier={tier} onChange={setTier} />
        ) : (
          <>
            <span className="text-title-4 leading-none font-medium tracking-tight text-foreground tabular-nums">
              {plan.price}
            </span>
            {plan.cadence ? <span className="text-body text-muted-foreground">{plan.cadence}</span> : null}
          </>
        )}
      </div>

      <div className="mt-3">
        <p className="text-caption text-secondary-foreground">{plan.credits}</p>
        {plan.note ? <p className="mt-1 text-caption text-muted-foreground">{plan.note}</p> : null}
      </div>

      <p className="mt-8 max-w-[32ch] text-body text-muted-foreground">{plan.description}</p>

      <ul className="mt-8 mb-12 space-y-4 border-t border-dashed border-tint-5 pt-8">
        {plan.inheritsFrom ? (
          <li className="text-body-sm font-medium text-foreground">Everything in {plan.inheritsFrom}, plus</li>
        ) : null}
        {plan.highlights.map((highlight) => (
          <li key={highlight} className="flex items-start gap-3 text-body-sm text-secondary-foreground">
            <IconCheck className="mt-1 size-3.5 shrink-0 text-foreground" stroke={2.25} />
            <span>{highlight}</span>
          </li>
        ))}
      </ul>

      <PlanAction plan={plan} />
    </article>
  )
}

export function PlanGrid({ plans }: { plans: PricingPlan[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-tint-4 bg-site-bg lg:grid lg:grid-cols-3 lg:grid-rows-[auto_auto_auto_auto_1fr_auto]">
      {plans.map((plan) => (
        <PlanCard key={plan.key} plan={plan} />
      ))}
    </div>
  )
}
