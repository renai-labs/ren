export * as DriveQuery from "./drive-query.js"

import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"
import { ApiError } from "../api-error.js"
import type { DriveDownloadInput, Ren } from "../generated/index.js"
import type { RenQuery } from "./generated/index.js"

const linkLifetime = 10 * 60_000

export interface Folder {
  readonly space?: string | undefined
  readonly folder?: string | undefined
}

export const listInput = (folder: Folder) => ({
  source: "drive" as const,
  ...(folder.space && { spaceId: folder.space }),
  ...(folder.folder && { folder: folder.folder }),
})

export const pages = (client: ReturnType<typeof Ren.make>, folder: Folder) =>
  infiniteQueryOptions({
    queryKey: ["files", "pages", listInput(folder)] as const,
    queryFn: (context) =>
      client.files.list(
        { ...listInput(folder), ...(context.pageParam && { cursor: context.pageParam }) },
        { signal: context.signal },
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.cursor ?? undefined,
  })

export const retry = (count: number, error: unknown) => ApiError.status(error) !== 404 && count < 1

export const link = (api: ReturnType<typeof RenQuery.make>, input: DriveDownloadInput) =>
  queryOptions({
    ...api.drive.download.queryOptions(input),
    staleTime: linkLifetime,
    retry,
  })
