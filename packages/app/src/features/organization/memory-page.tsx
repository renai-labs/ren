import { getRouteApi } from "@tanstack/react-router"
import { MemoryFiles } from "../../components/memory-files.js"
import { Page } from "../../components/page.js"

const route = getRouteApi("/_authed/_shell/settings/memory")

export function MemorySettingsPage() {
  const search = route.useSearch()
  return (
    <Page title="Memory" description="What every chat in your organization remembers." width="full">
      <MemoryFiles key={search.folder ?? ""} folder={search.folder ?? ""} file={search.file} />
    </Page>
  )
}
