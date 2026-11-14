import { getRouteApi } from "@tanstack/react-router"
import { MemoryFiles } from "../../components/memory-files.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/memory")

export function SpaceMemory() {
  const spaceId = route.useParams({ select: (params) => params.spaceId })
  const search = route.useSearch()
  return <MemoryFiles key={search.folder ?? ""} spaceId={spaceId} folder={search.folder ?? ""} file={search.file} />
}
