export * as ComposerRepositories from "./composer-repositories.js"

import { useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { RouterContext } from "../../lib/router-context.js"

// oxlint-disable-next-line ren/no-comments -- §5a composer "+": the route passes the Add repositories dialog of the spaces feature, because features never import each other.
export type Dialog = (props: { readonly spaceId: string; readonly onClose: () => void }) => ReactNode

export const notAllowed = "Only people who can change this space’s settings can add repositories."

export function useCanAdd(spaceId: string | undefined) {
  const context = RouterContext.useRouterContext()
  return (
    useQuery({
      ...context.api["space-settings"].get.queryOptions({ idOrSlug: spaceId ?? "" }),
      enabled: spaceId !== undefined,
      select: (settings) => settings.canUpdate,
    }).data === true
  )
}
