import { useState } from "react"
import type { BillingInvoice, BillingPlan, BillingSummary as Summary } from "@ren/client"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { IconInfoCircle } from "@tabler/icons-react"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button, buttonVariants } from "@ren/ui/button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@ren/ui/card"
import { Loading } from "@ren/ui/loading"
import { Progress } from "@ren/ui/progress"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs } from "@ren/ui/tabs"
import { formatDate, formatUtcDate } from "@ren/ui/time"
import { cn } from "cn"
import { EmptyState } from "../../components/empty-state.js"
import { LoadMore } from "../../components/load-more.js"
import {
  Page,
  PageTabsList,
  PageTabsTrigger,
  TableCard,
  TableEmpty,
  TableSample,
  useShapeId,
} from "../../components/page.js"
import { StatusBadge } from "../../components/status-badge.js"
import { errorMessage } from "../../lib/errors.js"
import { Pages } from "../../lib/pages.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import {
  dollars,
  formatMoney,
  freePlan,
  invoiceStatus,
  planName,
  planPriceCents,
  remainingPercent,
  wholeDollars,
} from "./plan-cards.js"
import { PlansGrid } from "./plans-grid.js"

const route = getRouteApi("/_authed/_shell/settings/_admin/billing")

const sample: Summary = {
  plan: freePlan,
  planStatus: null,
  renewsAt: null,
  pendingPlan: null,
  availableMicroUsd: 0,
  grantedMicroUsd: 0,
}

const invoiceTones = { paid: "ok", failed: "error", neutral: "neutral" } as const

export function BillingPage() {
  const { api } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const tab = search.tab ?? "billing"
  const billing = useQuery(api.billing.get.queryOptions())
  const plans = useQuery(api.billing.plan.list.queryOptions())
  const openTab = (next: string) =>
    void navigate({ search: { tab: next === "plans" ? "plans" : "billing" }, replace: true })
  const summary = billing.data ?? sample
  return (
    <Page
      title="Billing & plans"
      loading={billing.isPending}
      leading={
        <Tabs value={tab} onValueChange={(value: string) => openTab(value)}>
          <PageTabsList aria-label="Billing & plans">
            <PageTabsTrigger value="billing">Billing</PageTabsTrigger>
            <PageTabsTrigger value="plans">Plans</PageTabsTrigger>
          </PageTabsList>
        </Tabs>
      }
    >
      <ProvidersNotice />
      <section key={tab} aria-live="polite" className="flex flex-col gap-3">
        {billing.isError ? <EmptyState>Couldn’t load billing.</EmptyState> : null}
        {!billing.isError && tab === "plans" ? (
          <PlansGrid billing={summary} plans={plans.data} loading={plans.isPending} />
        ) : null}
        {!billing.isError && tab === "billing" ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <PlanCard billing={summary} plans={plans.data} onChoosePlan={() => openTab("plans")} />
              <CreditsCard billing={summary} />
            </div>
            <Invoices />
          </>
        ) : null}
      </section>
    </Page>
  )
}

function ProvidersNotice() {
  return (
    <Alert className="p-3 has-data-[slot=alert-action]:pr-32">
      <IconInfoCircle />
      <AlertTitle>Already pay for Claude or ChatGPT?</AlertTitle>
      <AlertDescription>
        Connect those subscriptions under Providers. Plans here add Ren credits for everything else.
      </AlertDescription>
      <AlertAction className="top-1/2 right-3 -translate-y-1/2">
        <Link to="/settings/providers" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Go to Providers
        </Link>
      </AlertAction>
    </Alert>
  )
}

function PlanCard(props: {
  billing: Summary
  plans: ReadonlyArray<BillingPlan> | undefined
  onChoosePlan: () => void
}) {
  const { api } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const portal = useMutation(api.billing.portal.mutationOptions())
  const paid = props.billing.plan !== freePlan
  const ending = props.billing.planStatus === "cancel_scheduled"
  const date = props.billing.renewsAt ? formatDate(props.billing.renewsAt) : null
  const detail = [
    paid ? `${wholeDollars(planPriceCents(props.billing.plan, props.plans))} / month` : null,
    date ? `${ending ? "ends" : "renews"} ${date}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <Card>
      <CardHeader>
        <CardDescription>Plan</CardDescription>
        <CardTitle className="text-xl">{planName(props.billing.plan, props.plans)}</CardTitle>
        {detail ? <CardDescription>{detail}</CardDescription> : null}
      </CardHeader>
      <CardFooter className="mt-auto gap-2">
        <Button variant={paid ? "secondary" : "default"} size="sm" onClick={props.onChoosePlan}>
          {paid ? "Change plan" : "Upgrade"}
        </Button>
        {paid ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={portal.isPending}
            onClick={() =>
              portal.mutate(undefined, {
                onSuccess: (link) => {
                  if (link.url) platform.openExternal(link.url)
                },
                onError: (error) =>
                  toast.error("Couldn’t open the billing portal", { description: errorMessage(error) }),
              })
            }
          >
            {portal.isPending ? <Spinner data-icon="inline-start" /> : null}
            Payment method
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}

function CreditsCard(props: { billing: Summary }) {
  const available = Math.max(props.billing.availableMicroUsd, 0)
  const granted = props.billing.grantedMicroUsd > 0
  const depleted = props.billing.availableMicroUsd <= 0
  return (
    <Card>
      <CardHeader>
        <CardDescription>Credits</CardDescription>
        <CardTitle className={cn("text-xl tabular-nums", depleted && "text-destructive")}>
          {dollars(available)}
        </CardTitle>
        {granted ? <CardDescription>of {dollars(props.billing.grantedMicroUsd)} remaining</CardDescription> : null}
      </CardHeader>
      {granted ? (
        <CardFooter className="mt-auto">
          <Progress
            value={remainingPercent(available, props.billing.grantedMicroUsd)}
            aria-label="Credits remaining"
            className={cn(
              "w-full **:data-[slot=progress-indicator]:bg-chart-1 **:data-[slot=progress-track]:bg-secondary",
              depleted && "**:data-[slot=progress-indicator]:bg-destructive",
            )}
          />
        </CardFooter>
      ) : null}
    </Card>
  )
}

function invoicesNotice(status: "pending" | "error" | "success", count: number) {
  if (status === "pending") return null
  if (status === "error") return "Couldn’t load invoices."
  if (count === 0) return "No invoices yet."
  return null
}

function Invoices() {
  const { api, client } = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const platform = Platform.usePlatform()
  const invoices = useInfiniteQuery(Pages.invoices(client))
  const [opening, setOpening] = useState<string | null>(null)
  const rows = invoices.data?.pages.flatMap((page) => page.invoices) ?? []
  const notice = invoicesNotice(invoices.status, rows.length)
  const shapeId = useShapeId("invoices")
  const open = (id: string) => {
    setOpening(id)
    void queryClient
      .query(api.billing.invoice.url.queryOptions({ id }))
      .then(
        (link) => {
          if (link.url) platform.openExternal(link.url)
          else toast.error("This invoice isn’t available to view")
        },
        (error: unknown) => toast.error("Couldn’t open this invoice", { description: errorMessage(error) }),
      )
      .finally(() => setOpening(null))
  }
  return (
    <section aria-label="Invoices" className="flex flex-col gap-3">
      <Loading id={shapeId} loading={invoices.isPending} label="Loading invoices">
        {invoices.isPending ? (
          <TableSample columns={["Invoice", "Status", "Amount", ""]} count={2} />
        ) : (
          <InvoiceTable rows={rows} notice={notice} opening={opening} onOpen={open} />
        )}
      </Loading>
      <LoadMore
        more={invoices.hasNextPage}
        loading={invoices.isFetchingNextPage}
        onMore={() => void invoices.fetchNextPage()}
      />
    </section>
  )
}

function InvoiceTable(props: {
  rows: ReadonlyArray<BillingInvoice>
  notice: string | null
  opening: string | null
  onOpen: (id: string) => void
}) {
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="w-20">
              <span className="sr-only">Open</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.notice ? <TableEmpty columns={4}>{props.notice}</TableEmpty> : null}
          {props.rows.map((invoice) => (
            <InvoiceRow
              key={invoice.id}
              invoice={invoice}
              opening={props.opening === invoice.id}
              onOpen={() => props.onOpen(invoice.id)}
            />
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}

function InvoiceRow(props: { invoice: BillingInvoice; opening: boolean; onOpen: () => void }) {
  const status = invoiceStatus(props.invoice.status)
  return (
    <TableRow>
      <TableCell className="tabular-nums">{formatUtcDate(props.invoice.issuedAt)}</TableCell>
      <TableCell>
        <StatusBadge tone={invoiceTones[status.tone]}>{status.label}</StatusBadge>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatMoney(props.invoice.amountCents, props.invoice.currency)}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" disabled={props.opening} onClick={props.onOpen}>
          {props.opening ? <Spinner data-icon="inline-start" /> : null}
          View
        </Button>
      </TableCell>
    </TableRow>
  )
}
