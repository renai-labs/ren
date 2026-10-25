import type { RenInference } from "@ren/schema/ren-inference"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Icon } from "@ren/ui/icon"
import { LoadingMessage } from "@ren/ui/loading-message"
import { PageShell } from "@ren/ui/page-shell"
import { StateMessage } from "@ren/ui/state-message"
import { Toast } from "@ren/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { usePlatform } from "../../platform/platform.js"
import { ConnectionCard } from "./connection-card.js"

const REFRESH_MS = 60_000

export function ProvidersPage(props: { manage?: { returnUrl: string } }) {
  const context = RouterContext.useRouterContext()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const api = context.api["ren-inference"]
  const [removing, setRemoving] = useState<RenInference.Connection | null>(null)
  const list = useQuery({ ...api.connection.list.queryOptions(), refetchInterval: REFRESH_MS })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: api.connection.list.queryKey() })
  const rename = useMutation({ ...api.connection.rename.mutationOptions(), onSuccess: invalidate })
  const remove = useMutation({ ...api.connection.remove.mutationOptions(), onSuccess: invalidate })
  const connect = useMutation({
    ...api.connect.mutationOptions(),
    onSuccess: (result) => (platform.redirect ?? platform.openExternal)(result.url),
    onError: (cause) =>
      Toast.manager.add({ type: "error", title: "Couldn’t start the sign-in", description: cause.message }),
  })
  const manage = props.manage
  const startConnect = (returnUrl: string, connectionId?: string) =>
    connect.mutate({ returnUrl, ...(connectionId && { connectionId }) })

  return (
    <PageShell.Root
      layout="settings"
      title="Providers"
      subtitle="Model providers your agents run on."
      actions={
        manage ? (
          <Button
            appearance="primary"
            leadingIcon={<Icon glyph="Plus" />}
            pending={connect.isPending}
            onClick={() => startConnect(manage.returnUrl)}
          >
            Connect
          </Button>
        ) : null
      }
    >
      {list.isPending ? <LoadingMessage placement="section" /> : null}
      {list.isError ? (
        <StateMessage
          state="failed"
          placement="section"
          title="Couldn’t load connections."
          description={list.error.message}
          onRetry={() => void list.refetch()}
        />
      ) : null}
      {list.isSuccess && list.data.length === 0 ? (
        <StateMessage
          state="empty"
          placement="section"
          icon={<Icon glyph="Server" size="medium" tone="secondary" />}
          title="No providers connected yet"
          description={manage ? "Connect one to see its limits here." : "An admin can connect one."}
          action={
            manage ? (
              <Button
                appearance="primary"
                size="small"
                pending={connect.isPending}
                onClick={() => startConnect(manage.returnUrl)}
              >
                Connect a provider
              </Button>
            ) : null
          }
        />
      ) : null}
      {list.isSuccess && list.data.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {list.data.map((connection, index) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              index={index}
              now={list.dataUpdatedAt}
              {...(manage && {
                manage: {
                  onRename: async (label: string) => {
                    if (label === connection.label) return
                    await rename.mutateAsync({ id: connection.id, label }).catch((cause: Error) => {
                      Toast.manager.add({
                        type: "error",
                        title: "Couldn’t rename the connection",
                        description: cause.message,
                      })
                      throw cause
                    })
                  },
                  onRemove: () => setRemoving(connection),
                  onReconnect: () => startConnect(manage.returnUrl, connection.id),
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
    </PageShell.Root>
  )
}
