import { useState } from "react"
import { IconRosetteDiscountCheckFilled } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import { AppIcon } from "../../components/app-icon.js"
import { StatusDot } from "../../components/app-list.js"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { statusAction, statusLabel, type CatalogApp, type Status } from "../../lib/apps.js"
import { connectTarget, useSpaceApps } from "./use-space-apps.js"

const rank: Record<Status, number> = { expired: 0, missing: 0, credits: 1, connected: 2 }

function ConnectCard(props: {
  app: Pick<CatalogApp, "name" | "icon" | "source">
  status: Status
  onAction: () => void
}) {
  const action = statusAction[props.status]
  return (
    <div className="flex w-full max-w-lg items-center gap-3 rounded-xl border bg-card p-3">
      <AppIcon name={props.app.name} icon={props.app.icon} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1 font-medium">
          <span className="truncate">{props.app.name}</span>
          {props.app.source === "registry" ? (
            <IconRosetteDiscountCheckFilled aria-label="Verified" className="size-4 shrink-0 text-chart-1" />
          ) : null}
        </span>
        <span className="flex items-center gap-2 truncate text-sm text-muted-foreground">
          <StatusDot status={props.status} />
          {statusLabel[props.status]}
        </span>
      </div>
      {action ? (
        <Button size="sm" className="shrink-0" onClick={props.onAction}>
          {action}
        </Button>
      ) : null}
    </div>
  )
}

export function AppConnectCard(props: {
  appId: string
  spaceId: string
  onConnected?: ((app: string) => void) | undefined
}) {
  const space = useSpaceApps(props.spaceId, [props.appId])
  const [target, setTarget] = useState<ProfileTarget & { before: Status }>()
  const app = space.app(props.appId)
  if (space.pending)
    return (
      <Loading label="Loading app">
        <ConnectCard app={{ name: "App", icon: null, source: "custom" }} status="missing" onAction={() => undefined} />
      </Loading>
    )
  const from = space.from
  if (!app || !from) return null
  const status = space.status(app.id)
  return (
    <>
      <ConnectCard
        app={app}
        status={status}
        onAction={() =>
          setTarget({ ...connectTarget({ appId: app.id, status, here: space.here(app.id) }, from), before: status })
        }
      />
      {target ? (
        <ProfileDialog
          {...target}
          onClose={() => {
            setTarget(undefined)
            void space.refresh(app.id).then((after) => {
              if (rank[after] > rank[target.before]) props.onConnected?.(app.name)
            })
          }}
        />
      ) : null}
    </>
  )
}
