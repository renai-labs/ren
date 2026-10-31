import type { AppProfileItem } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, errorMessage, profileQueries } from "@/lib/api"

export const blankTab = () => {
  const tab = window.open("", "_blank")
  if (tab) tab.opener = null
  return tab
}

export function useSignIn(onOpened?: (item: AppProfileItem) => void) {
  const connect = useMutation({
    ...api["credential-connect"].credential.connect.mutationOptions(),
    meta: { invalidates: profileQueries },
  })
  return {
    pending: connect.isPending,
    start: (profileId: string, item: AppProfileItem, tab: Window | null = blankTab()) => {
      if (!("mcp" in item.item)) {
        tab?.close()
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
            else window.open(result.redirectUrl, "_blank", "noopener,noreferrer")
            if (onOpened) onOpened(item)
            else toast(`Opened ${item.name} in a new tab`, { description: "Finish signing in there, then come back." })
          },
          onError: (error) => {
            tab?.close()
            toast.error(`Could not sign in with ${item.name}`, { description: errorMessage(error) })
          },
        },
      )
    },
  }
}
