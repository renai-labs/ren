import { useState } from "react"
import type { ProviderModelList, ProviderModel } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { IconArrowLeft } from "@tabler/icons-react"
import { Badge } from "@ren/ui/badge"
import { buttonVariants } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import { toast } from "@ren/ui/sonner"
import { Switch } from "@ren/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@ren/ui/tabs"
import { EmptyState } from "../../components/empty-state.js"
import { Page, useShapeId } from "../../components/page.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/_authed/_shell/settings/providers/$id/models")

const filters = ["All", "On", "Free"] as const
type Filter = (typeof filters)[number]

const usd = (value: number | undefined) => (value === undefined ? "–" : `$${value.toFixed(2)}`)

const sample: ProviderModelList = {
  canManage: false,
  models: Array.from({ length: 8 }, (_, index) => ({
    id: `vendor/model-${index}`,
    name: "Model name",
    price: { input: 1, output: 4 },
    free: false,
    enabled: true,
  })),
}

const shownBy: Readonly<Record<Filter, (model: ProviderModel) => boolean>> = {
  All: () => true,
  On: (model) => model.enabled,
  Free: (model) => model.free,
}

const emptyBy: Readonly<Record<Filter, string>> = {
  All: "This provider has no models.",
  On: "No models are on.",
  Free: "No free models.",
}

function ModelName(props: { model: ProviderModel }) {
  return (
    <div className="flex flex-col">
      <span className="flex flex-wrap items-center gap-2 break-words">
        {props.model.name}
        {props.model.free ? <Badge variant="secondary">Free</Badge> : null}
      </span>
      <span className="font-mono text-xs break-all text-muted-foreground">{props.model.id}</span>
    </div>
  )
}

export function ProviderModelsPage() {
  const { api } = RouterContext.useRouterContext()
  const id = route.useParams({ select: (params) => params.id })
  const list = useQuery(api.provider.models.list.queryOptions({ id }))
  const name = useQuery({
    ...api.provider.list.queryOptions(),
    select: (page) => page.providers.find((provider) => provider.id === id)?.name,
  }).data
  const update = useMutation(api.provider.models.update.mutationOptions())
  const [filter, setFilter] = useState<Filter>("All")
  const shapeId = useShapeId("provider-models")
  const data = list.data ?? sample
  const shown = data.models.filter(shownBy[filter])
  const failed = (error: unknown) => toast.error("Couldn’t change the models", { description: errorMessage(error) })
  return (
    <Page
      title={name ? `${name} models` : "Models"}
      description="Only models that are on show in your team’s pickers. A new model is on when it arrives."
      width="wide"
      back={
        <Link
          to="/settings/providers"
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "px-0 text-muted-foreground has-[>svg]:px-0",
          })}
        >
          <IconArrowLeft />
          Back to providers
        </Link>
      }
    >
      <Tabs value={filter} onValueChange={(value) => setFilter(filters.find((each) => each === value) ?? "All")}>
        <TabsList aria-label="Filter models">
          {filters.map((each) => (
            <TabsTrigger key={each} value={each}>
              {each}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Loading id={shapeId} loading={list.isPending} label="Loading models">
        {(list.isError || shown.length === 0) && !list.isPending ? (
          <EmptyState>{list.isError ? errorMessage(list.error) : emptyBy[filter]}</EmptyState>
        ) : (
          <Table aria-label="Models">
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Cache read</TableHead>
                <TableHead className="text-right">Cache write</TableHead>
                <TableHead className="w-16">On</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((model) => (
                <TableRow key={model.id}>
                  <TableCell className="w-full max-w-0 whitespace-normal">
                    <ModelName model={model} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{usd(model.price?.input)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(model.price?.output)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(model.price?.cacheRead)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(model.price?.cacheWrite)}</TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${model.name} on`}
                      checked={model.enabled}
                      disabled={!data.canManage}
                      onCheckedChange={(enabled) =>
                        update.mutate({ id, models: [{ id: model.id, enabled }] }, { onError: failed })
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Loading>
    </Page>
  )
}
