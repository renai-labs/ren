export * as SpaceRepositories from "./space-repositories.js"

import { useMutation, useQuery } from "@tanstack/react-query"
import type { ReferenceInfo } from "../generated/index.js"
import type { RenQuery } from "./generated/index.js"

type Api = ReturnType<typeof RenQuery.make>

export function useReferences(api: Api, spaceId: string) {
  const settings = useQuery(api["space-settings"].get.queryOptions({ idOrSlug: spaceId }))
  const update = useMutation(api["space-settings"].update.mutationOptions())
  const current = settings.data?.settings
  const references = current?.references ?? []
  return {
    pending: current === undefined,
    references,
    saving: update.isPending,
    error: update.error,
    add: (added: ReadonlyArray<ReferenceInfo>) =>
      current
        ? update.mutateAsync({ id: spaceId, settings: { ...current, references: [...references, ...added] } })
        : Promise.reject(new Error("The space’s settings have not loaded.")),
  }
}
