import type { ReactElement } from "react"
import { Rows } from "../../components/page.js"

export function OverviewRows(props: { empty: string; children: ReactElement[] }) {
  if (props.children.length === 0)
    return <p className="rounded-xl border bg-card py-8 text-center text-sm text-muted-foreground">{props.empty}</p>
  return <Rows>{props.children}</Rows>
}
