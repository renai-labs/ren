import type { ReactNode } from "react"
import { IconArrowUpRight, IconUserPlus } from "@tabler/icons-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AppIcon } from "@/components/ren/app-icon"
import { TableCard, TableEmpty } from "@/components/ren/page"
import { RowMenu } from "@/components/ren/row-menu"
import { StatusBadge } from "@/components/ren/status-badge"
import { gaps } from "@/lib/apps"
import type { AppProfileInfo } from "@ren/client"
import type { CatalogApp } from "@/lib/apps"

type App = CatalogApp
type AppProfile = AppProfileInfo

const accounts = (count: number) => (count === 1 ? "1 account" : `${count} accounts`)

export function AppsTable(props: {
  rows: { app: App; profiles: ReadonlyArray<AppProfile>; usedIn: string }[]
  empty: ReactNode
  onOpen: (appId: string) => void
  onNew: (appId: string) => void
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
            const missing = profiles.reduce((total, profile) => total + gaps(profile).length, 0)
            return (
              <TableRow key={app.id} className="cursor-pointer" onClick={() => props.onOpen(app.id)}>
                <TableCell>
                  <span className="flex min-w-0 items-center gap-3">
                    <AppIcon name={app.name} icon={app.icon} />
                    <span className="flex min-w-0 flex-col">
                      <button
                        type="button"
                        className="truncate text-left outline-none focus-visible:underline"
                        onClick={(event) => {
                          event.stopPropagation()
                          props.onOpen(app.id)
                        }}
                      >
                        {app.name}
                      </button>
                      <span className="truncate text-xs text-muted-foreground">{accounts(profiles.length)}</span>
                    </span>
                  </span>
                </TableCell>
                <TableCell className="truncate text-muted-foreground" title={usedIn}>
                  {usedIn}
                </TableCell>
                <TableCell>
                  {missing ? (
                    <StatusBadge tone="warn">{missing} not connected</StatusBadge>
                  ) : (
                    <StatusBadge tone="ok">Connected</StatusBadge>
                  )}
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <RowMenu
                    label={`${app.name} actions`}
                    items={[
                      { label: "Open", icon: <IconArrowUpRight />, onSelect: () => props.onOpen(app.id) },
                      { label: "New account", icon: <IconUserPlus />, onSelect: () => props.onNew(app.id) },
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
