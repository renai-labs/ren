import { useState } from "react"
import type { BillingPlan, BillingSummary } from "@ren/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconCheck, IconCircleCheck } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@ren/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Loading } from "@ren/ui/loading"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { formatDate } from "@ren/ui/time"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { useShapeId } from "../../components/page.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import {
  confirmCopy,
  defaultTiers,
  planCards,
  planName,
  planPriceCents,
  progressCopy,
  slowAfterMs,
  type PlanCard,
  type PlanTransition,
  type ProgressState,
} from "./plan-cards.js"

type Change = Exclude<PlanTransition, "cancel">

const pollEveryMs = 2_000

const samplePlans: ReadonlyArray<BillingPlan> = ["Pro", "Scale"].map((name, index) => ({
  key: `sample_${index}`,
  name,
  priceCents: 15_000,
  creditsMicroUsd: 150_000_000,
  description: null,
  tagline: null,
  badge: null,
  sortOrder: index,
}))

type Progress = { readonly target: string; readonly transition: Change; readonly startedAt: number }

export function PlansGrid(props: {
  billing: BillingSummary
  plans: ReadonlyArray<BillingPlan> | undefined
  loading: boolean
}) {
  const shapeId = useShapeId("plans")
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>({})
  const [confirming, setConfirming] = useState<{ key: string; transition: PlanTransition } | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const plans = props.loading ? samplePlans : props.plans
  const cards = planCards({
    billing: props.billing,
    plans,
    tiers: { ...defaultTiers(plans, props.billing.plan), ...chosen },
    formatDate,
  })
  return (
    <>
      <Loading id={shapeId} loading={props.loading} label="Loading plans">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {cards.map((card) => (
            <PlanCardView
              key={card.name}
              card={card}
              onTier={(key) => setChosen((previous) => ({ ...previous, [card.name]: key }))}
              onAction={(transition) => setConfirming({ key: card.key, transition })}
            />
          ))}
        </div>
      </Loading>
      {confirming ? (
        <ConfirmPlanChange
          target={confirming}
          plans={plans}
          renewsAt={props.billing.renewsAt}
          onClose={() => setConfirming(null)}
          onStarted={setProgress}
        />
      ) : null}
      {progress ? (
        <PlanChangeProgress
          progress={progress}
          billing={props.billing}
          plans={plans}
          onClose={() => setProgress(null)}
        />
      ) : null}
    </>
  )
}

function ConfirmPlanChange(props: {
  target: { key: string; transition: PlanTransition }
  plans: ReadonlyArray<BillingPlan> | undefined
  renewsAt: string | null
  onClose: () => void
  onStarted: (progress: Progress) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const platform = Platform.usePlatform()
  const subscribe = useMutation(api.billing.subscribe.mutationOptions())
  const changePlan = useMutation(api.billing["change-plan"].mutationOptions())
  const cancel = useMutation(api.billing.cancel.mutationOptions())
  const failed = (error: unknown) => toast.error(errorMessage(error))
  const target = props.target
  const run = async () => {
    if (target.transition === "cancel") {
      await cancel.mutateAsync(undefined, { onError: failed })
      const renewsAt = queryClient.getQueryData(api.billing.get.queryOptions().queryKey)?.renewsAt
      toast.success(
        "Cancellation scheduled",
        renewsAt ? { description: `You keep access until ${formatDate(renewsAt)}.` } : undefined,
      )
      return
    }
    if (target.transition === "subscribe") {
      const checkout = await subscribe.mutateAsync({ plan: target.key }, { onError: failed })
      if (checkout.checkoutUrl) platform.openExternal(checkout.checkoutUrl)
    } else await changePlan.mutateAsync({ plan: target.key }, { onError: failed })
    props.onStarted({ target: target.key, transition: target.transition, startedAt: Date.now() })
  }
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      confirmation={{
        ...confirmCopy({
          transition: target.transition,
          name: planName(target.key, props.plans),
          priceCents: planPriceCents(target.key, props.plans),
          endsOn: props.renewsAt ? formatDate(props.renewsAt) : null,
        }),
        cancel: "Go back",
        working: "Working…",
      }}
      onConfirm={run}
    />
  )
}

function progressState(
  progress: Progress,
  seen: { readonly reached: boolean; readonly checkedAt: number },
): ProgressState {
  if (seen.reached) return "done"
  return seen.checkedAt - progress.startedAt > slowAfterMs[progress.transition] ? "slow" : "processing"
}

function PlanChangeProgress(props: {
  progress: Progress
  billing: BillingSummary
  plans: ReadonlyArray<BillingPlan> | undefined
  onClose: () => void
}) {
  const { api } = RouterContext.useRouterContext()
  const reached = props.billing.plan === props.progress.target || props.billing.pendingPlan === props.progress.target
  const polled = useQuery({ ...api.billing.get.queryOptions(), refetchInterval: reached ? false : pollEveryMs })
  const state = progressState(props.progress, {
    reached,
    checkedAt: Math.max(polled.dataUpdatedAt, polled.errorUpdatedAt),
  })
  const copy = progressCopy(props.progress.transition, state, planName(props.progress.target, props.plans))
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && state !== "processing") props.onClose()
      }}
    >
      <DialogContent showCloseButton={state !== "processing"}>
        <DialogHeader className="items-center text-center">
          {state === "done" ? (
            <IconCircleCheck className="size-8 text-chart-2" />
          ) : (
            <Spinner className="size-6 text-muted-foreground" />
          )}
          <DialogTitle>{copy.title}</DialogTitle>
          {copy.description ? <DialogDescription>{copy.description}</DialogDescription> : null}
        </DialogHeader>
        {state === "processing" ? null : (
          <DialogFooter>
            <Button className="w-full" onClick={props.onClose}>
              Done
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PlanCardView(props: {
  card: PlanCard
  onTier: (key: string) => void
  onAction: (transition: PlanTransition) => void
}) {
  const card = props.card
  return (
    <Card
      aria-label={`${card.name} plan`}
      aria-current={card.current ? "true" : undefined}
      className={card.current ? "bg-transparent" : undefined}
    >
      <CardHeader className="gap-2">
        <CardTitle className="text-base">{card.name}</CardTitle>
        <PlanPrice card={card} onTier={props.onTier} />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="text-sm text-muted-foreground">{card.featuresLabel}</p>
        <ul className="flex flex-col gap-3">
          {card.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm">
              <IconCheck className="mt-0.5 size-4 shrink-0" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="flex-col gap-2">
        {card.action ? (
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => {
              if (card.action) props.onAction(card.action.transition)
            }}
          >
            {card.action.label}
          </Button>
        ) : null}
        {!card.action && card.current ? (
          <Button variant="outline" size="sm" className="w-full" disabled>
            <IconCheck data-icon="inline-start" />
            Current plan
          </Button>
        ) : null}
        {!card.action && !card.current ? (
          <p className="text-center text-sm text-muted-foreground">{card.status ?? ""}</p>
        ) : null}
        {card.current && card.status ? (
          <p className="text-center text-xs text-muted-foreground">{card.status}</p>
        ) : null}
      </CardFooter>
    </Card>
  )
}

function PlanPrice(props: { card: PlanCard; onTier: (key: string) => void }) {
  const card = props.card
  if (!card.tiers)
    return (
      <p className="text-xl font-medium tabular-nums">
        {card.price}
        {card.cadence ? <span className="font-normal text-muted-foreground">{card.cadence}</span> : null}
      </p>
    )
  return (
    <Select
      items={card.tiers.map((tier) => ({ value: tier.key, label: tier.label }))}
      value={card.key}
      onValueChange={(key) => props.onTier(String(key))}
    >
      <SelectTrigger aria-label={`${card.name} monthly amount`} className="w-full tabular-nums">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {card.tiers.map((tier) => (
            <SelectItem key={tier.key} value={tier.key}>
              {tier.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
