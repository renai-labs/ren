import type { AppProfileItem } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { Platform } from "../platform/platform.js"
import { errorMessage } from "./errors.js"
import { RouterContext } from "./router-context.js"

export function useSignIn(onOpened?: (item: AppProfileItem) => void, onFailed?: () => void) {
  const platform = Platform.usePlatform()
  const { api } = RouterContext.useRouterContext()
  const connect = useMutation(api["credential-connect"].credential.connect.mutationOptions())
  return {
    pending: connect.isPending,
    start: (
      profileId: string,
      item: AppProfileItem,
      tab: Window | null = platform.blankPopup?.() ?? platform.blankTab?.() ?? null,
    ) => {
      if (!("mcp" in item.item)) {
        tab?.close()
        onFailed?.()
        return
      }
      connect.mutate(
        { profileId, item: item.item, ...(item.status !== "missing" && { reconnect: true }) },
        {
          onSuccess: (result) => {
            if (!("redirectUrl" in result)) {
              tab?.close()
              return
            }
            if (tab) tab.location.href = result.redirectUrl
            else platform.openExternal(result.redirectUrl)
            if (onOpened) onOpened(item)
            else
              toast(`Sign in to ${item.name} in the window that opened`, {
                description: "It closes by itself when you’re done.",
              })
          },
          onError: (error) => {
            tab?.close()
            toast.error(`Could not sign in with ${item.name}`, { description: errorMessage(error) })
            onFailed?.()
          },
        },
      )
    },
  }
}
