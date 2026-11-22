import type { ReactNode } from "react"
import { IconArrowUpRight, IconPlug, IconPlus, IconUserPlus } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { AppIcon } from "./app-icon.js"
import { TableCard, TableEmpty } from "./page.js"
import { RowMenu, type RowMenuItem } from "./row-menu.js"
import { StatusBadge } from "./status-badge.js"
import type { StatusTone } from "./status-badge.js"
import { listNames, statusLabel, statusOf } from "../lib/apps.js"
import { plural } from "../lib/format.js"
import type { AppProfileInfo } from "@ren/client"
import type { CatalogApp, Status } from "../lib/apps.js"

type App = CatalogApp
type AppProfile = AppProfileInfo

const tones: Record<Status, StatusTone> = { expired: "warn", connected: "ok", credits: "ok", missing: "warn" }

type Bundle = { total: number; signIn: ReadonlyArray<App> }

const captionOf = (row: {
  profiles: ReadonlyArray<AppProfile>
  bundle?: Bundle | undefined
  partOf?: ReadonlyArray<string>
}) => {
  if (row.bundle) return plural(row.bundle.total, "app")
  const partOf = row.partOf ?? []
  if (partOf.length > 1) return `via ${partOf.length} bundles`
  return partOf.length === 1 ? `via ${partOf.join("")}` : plural(row.profiles.length, "account")
}

function AppName(props: { app: App; caption: string; title?: string | undefined; onOpen: () => void }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <AppIcon name={props.app.name} description={props.app.description} icon={props.app.icon} />
      <span className="flex min-w-0 flex-col">
        <Button
          variant="link"
          className="block h-auto max-w-full truncate rounded-sm p-0 text-left font-normal text-foreground hover:no-underline focus-visible:underline"
          onClick={(event) => {
            event.stopPropagation()
            props.onOpen()
          }}
        >
          {props.app.name}
        </Button>
        <span className="truncate text-xs text-muted-foreground" title={props.title}>
          {props.caption}
        </span>
      </span>
    </span>
  )
}

type AppRow = {
  app: App
  profiles: ReadonlyArray<AppProfile>
  usedIn: string
  needs?: ReadonlyArray<App>
  bundle?: Bundle | undefined
  partOf?: ReadonlyArray<string>
}

type Badge = { tone: StatusTone; label: string; title?: string }

const badgeOf = (row: AppRow, status: Status, expired: number): Badge => {
  const needs = row.needs ?? []
  if (needs.length > 0 && (row.bundle || status === "connected")) {
    const names = `Needs ${listNames(needs.map((each) => each.name))}`
    return { tone: "warn", label: needs.length === 1 ? names : `Needs ${needs.length} apps`, title: names }
  }
  if (row.bundle) {
    const waiting = row.bundle.signIn.length
    if (waiting === 0) return { tone: "ok", label: "Ready" }
    const names = listNames(row.bundle.signIn.map((each) => each.name))
    const verb = waiting === 1 ? "needs" : "need"
    return { tone: "warn", label: `${waiting} ${verb} sign-in`, title: `${names} ${verb} sign-in` }
  }
  if (status === "expired" && row.profiles.length > 1)
    return { tone: tones[status], label: `${expired} of ${row.profiles.length} need sign-in` }
  return { tone: tones[status], label: statusLabel[status] }
}

export function AppsTable(props: {
  rows: AppRow[]
  empty: ReactNode
  onOpen: (appId: string) => void
  onNew: (appId: string) => void
  onAdd?: (appId: string) => void
  remove?: (row: AppRow) => RowMenuItem | undefined
}) {
  return (
    <TableCard>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead>App</TableHead>
            <TableHead className="w-1/3">Used in</TableHead>
            <TableHead className="w-1/4">Status</TableHead>
            <TableHead className="w-15" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.length === 0 ? <TableEmpty columns={5}>{props.empty}</TableEmpty> : null}
          {props.rows.map((row) => {
            const app = row.app
            const profiles = row.profiles
            const usedIn = row.usedIn
            const status = statusOf(app, profiles)
            const expired = profiles.filter((profile) => statusOf(app, [profile]) === "expired").length
            const needs = row.needs ?? []
            const badge = badgeOf(row, status, expired)
            const add = props.onAdd
            return (
              <TableRow key={app.id} className="cursor-pointer" onClick={() => props.onOpen(app.id)}>
                <TableCell>
                  <AppName
                    app={app}
                    caption={captionOf(row)}
                    title={row.partOf && row.partOf.length > 1 ? `via ${listNames(row.partOf)}` : undefined}
                    onOpen={() => props.onOpen(app.id)}
                  />
                </TableCell>
                <TableCell className="truncate text-muted-foreground" title={usedIn}>
                  {usedIn}
                </TableCell>
                <TableCell title={badge.title ?? badge.label}>
                  <StatusBadge tone={badge.tone} className="max-w-full justify-start">
                    <span className="truncate">{badge.label}</span>
                  </StatusBadge>
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <RowMenu
                    label={`${app.name} actions`}
                    items={[
                      { label: "Open", icon: IconArrowUpRight, onSelect: () => props.onOpen(app.id) },
                      ...(row.bundle
                        ? []
                        : [{ label: "New account", icon: IconUserPlus, onSelect: () => props.onNew(app.id) }]),
                      ...(add
                        ? [
                            ...needs.map((each) => ({
                              label: `Add ${each.name}`,
                              icon: IconPlus,
                              onSelect: () => add(each.id),
                            })),
                            ...(row.bundle?.signIn ?? []).map((each) => ({
                              label: `Connect ${each.name}`,
                              icon: IconPlug,
                              onSelect: () => add(each.id),
                            })),
                          ]
                        : []),
                      ...[props.remove?.(row)].filter((item) => item !== undefined),
                    ]}
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableCard>
  )
}
