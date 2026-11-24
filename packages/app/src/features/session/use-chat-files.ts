import { FileMentions } from "@ren/chat/file-mentions"
import { Drive } from "@ren/schema/drive"
import type { Session } from "@ren/schema/session"
import { useQueries, useQuery } from "@tanstack/react-query"
import { RouterContext } from "../../lib/router-context.js"

const listedFor = 30_000

export function useListedChatFiles(spaceId: string | undefined, root: Session.ID) {
  const { api } = RouterContext.useRouterContext()
  const folder = (path: string) => ({
    ...api.files.list.queryOptions({ source: "drive", spaceId: spaceId ?? "", folder: path }),
    enabled: spaceId !== undefined,
    staleTime: listedFor,
    retry: false,
  })
  const outputs = useQuery(folder(`${Drive.outputsOf(root)}/`))
  const uploads = useQuery(folder(`${Drive.chatsFolder}${root}/uploads/`))
  const messages = useQueries({
    queries: (uploads.data?.entries ?? []).flatMap((entry) => (entry.type === "directory" ? [folder(entry.path)] : [])),
  })
  return FileMentions.listed([
    ...(outputs.data?.entries ?? []),
    ...messages.flatMap((listing) => listing.data?.entries ?? []),
  ])
}
