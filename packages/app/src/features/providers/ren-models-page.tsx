import { useState } from "react"
import type { ProviderCardRenModel, ProviderCardRenModels } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Badge } from "@ren/ui/badge"
import { Label } from "@ren/ui/label"
import { Loading } from "@ren/ui/loading"
import { toast } from "@ren/ui/sonner"
import { Switch } from "@ren/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@ren/ui/tabs"
import { EmptyState } from "../../components/empty-state.js"
import { Page, useShapeId } from "../../components/page.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"

const filters = ["All", "On", "Free"] as const
type Filter = (typeof filters)[number]

const usd = (value: number | undefined) => (value === undefined ? "–" : `$${value.toFixed(2)}`)

const sample: ProviderCardRenModels = {
  newModelsOn: true,
  canManage: false,
  models: Array.from({ length: 8 }, (_, index) => ({
    id: `ren/vendor/model-${index}`,
    name: "Model name",
    price: { input: 1, output: 4 },
    free: false,
    enabled: true,
  })),
}

const shownBy: Readonly<Record<Filter, (model: ProviderCardRenModel) => boolean>> = {
  All: () => true,
  On: (model) => model.enabled,
  Free: (model) => model.free,
}

function ModelName(props: { model: ProviderCardRenModel }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex items-center gap-2 truncate">
        {props.model.name}
        {props.model.free ? <Badge variant="secondary">Free</Badge> : null}
      </span>
      <span className="truncate font-mono text-xs text-muted-foreground">{props.model.id}</span>
    </div>
  )
}

export function RenModelsPage() {
  const { api } = RouterContext.useRouterContext()
  const list = useQuery(api.provider["ren-models"].list.queryOptions())
  const update = useMutation(api.provider["ren-models"].update.mutationOptions())
  const [filter, setFilter] = useState<Filter>("All")
  const shapeId = useShapeId("ren-models")
  const data = list.data ?? sample
  const shown = data.models.filter(shownBy[filter])
  const failed = (error: unknown) => toast.error("Couldn’t change Ren’s models", { description: errorMessage(error) })
  return (
    <Page
      title="Ren models"
      description="Only models that are on show in your team’s pickers."
      aside={
        <div className="flex items-center gap-2 text-sm">
          <Switch
            id="new-models-on"
            checked={data.newModelsOn}
            disabled={!data.canManage}
            onCheckedChange={(on) => update.mutate({ newModelsOn: on }, { onError: failed })}
          />
          <Label htmlFor="new-models-on">New models on</Label>
        </div>
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
      <Loading id={shapeId} loading={list.isPending} label="Loading Ren’s models">
        {shown.length === 0 && !list.isPending ? (
          <EmptyState>
            {filter === "All" ? "Ren has no models on this server." : `No ${filter.toLowerCase()} models.`}
          </EmptyState>
        ) : (
          <Table aria-label="Ren’s models">
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
                  <TableCell>
                    <ModelName model={model} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{usd(model.price.input)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(model.price.output)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(model.price.cacheRead)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(model.price.cacheWrite)}</TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${model.name} on`}
                      checked={model.enabled}
                      disabled={!data.canManage}
                      onCheckedChange={(enabled) =>
                        update.mutate({ models: [{ id: model.id, enabled }] }, { onError: failed })
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
