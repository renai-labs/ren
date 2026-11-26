import { getRouteApi } from "@tanstack/react-router"
import { MemoryFiles } from "../../components/memory-files.js"
import { Page } from "../../components/page.js"
import { DarkUi } from "../../lib/dark-ui.js"

const route = getRouteApi("/_authed/_shell/settings/memory")

export function MemorySettingsPage() {
  const deep = DarkUi.useDarkUi()
  const search = route.useSearch()
  return (
    <Page title="Memory" description="What every chat in your organization remembers." width={deep ? "wide" : "full"}>
      <MemoryFiles key={search.folder ?? ""} folder={search.folder ?? ""} file={search.file} />
    </Page>
  )
}
