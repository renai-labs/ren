import type { RenInference } from "@ren/schema/ren-inference"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { Page } from "@ren/ui/page"
import { Spinner } from "@ren/ui/spinner"
import { toast } from "@ren/ui/toast"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { usePlatform } from "../../platform/platform.js"
import { ConnectionCard } from "./connection-card.js"

const REFRESH_MS = 60_000

export function ProvidersPage(props: { returnUrl: string }) {
  const context = RouterContext.useRouterContext()
  const platform = usePlatform()
  const api = context.api["ren-inference"]
  const [removing, setRemoving] = useState<RenInference.Connection | null>(null)
  const list = useQuery({ ...api.connection.list.queryOptions(), refetchInterval: REFRESH_MS })
  const rename = useMutation(api.connection.rename.mutationOptions())
  const remove = useMutation(api.connection.remove.mutationOptions())
  const connect = useMutation({
    ...api.connect.mutationOptions(),
    onSuccess: (result) => (platform.redirect ?? platform.openExternal)(result.url),
    onError: (cause) => toast.add({ type: "error", title: "Couldn’t start the sign-in", description: cause.message }),
  })
  const startConnect = (connectionId?: string) =>
    connect.mutate({ returnUrl: props.returnUrl, ...(connectionId && { connectionId }) })

  return (
    <Page.Root
      title="Providers"
      description="Model providers your agents run on."
      menu={
        <Button disabled={connect.isPending} onClick={() => startConnect()}>
          {connect.isPending ? (
            <Spinner aria-hidden data-icon="inline-start" />
          ) : (
            <Icon glyph="Plus" data-icon="inline-start" />
          )}
          Connect
        </Button>
      }
    >
      {list.isPending ? (
        <Empty>
          <EmptyMedia>
            <Spinner />
          </EmptyMedia>
        </Empty>
      ) : null}
      {list.isError ? (
        <Empty role="alert">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon glyph="AlertCircle" />
            </EmptyMedia>
            <EmptyTitle>Couldn’t load connections.</EmptyTitle>
            <EmptyDescription>{list.error.message}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}
      {list.isSuccess && list.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon glyph="Server" />
            </EmptyMedia>
            <EmptyTitle>No providers connected yet</EmptyTitle>
            <EmptyDescription>
              Your organization uses Ren’s default models. Connect a model provider to use it instead.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" disabled={connect.isPending} onClick={() => startConnect()}>
              {connect.isPending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              Connect a provider
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}
      {list.isSuccess && list.data.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {list.data.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              now={list.dataUpdatedAt}
              {...(connection.canManage && {
                manage: {
                  onRename: async (label: string) => {
                    if (label === connection.label) return
                    await rename.mutateAsync({ id: connection.id, label }).catch((cause: Error) => {
                      toast.add({
                        type: "error",
                        title: "Couldn’t rename the connection",
                        description: cause.message,
                      })
                      throw cause
                    })
                  },
                  onRemove: () => setRemoving(connection),
                  onReconnect: () => startConnect(connection.id),
                },
              })}
            />
          ))}
        </div>
      ) : null}
      <ConfirmationDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={removing ? `Remove ${removing.label}?` : "Remove connection?"}
        description="New requests stop using it right away."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={async () => {
          if (removing) await remove.mutateAsync({ id: removing.id })
        }}
        onConfirmed={() => setRemoving(null)}
      />
    </Page.Root>
  )
}
