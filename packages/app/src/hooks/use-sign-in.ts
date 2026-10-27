import type { AppProfileItem } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, errorMessage, profileQueries } from "@/lib/api"

export function useSignIn(onOpened?: (item: AppProfileItem) => void) {
  const connect = useMutation({ ...api["credential-connect"].credential.connect.mutationOptions(), meta: { invalidates: profileQueries } })
  return {
    pending: connect.isPending,
    start: (profileId: string, item: AppProfileItem) => {
      if (!("mcp" in item.item)) return
      connect.mutate(
        { profileId, item: item.item, ...(item.status !== "missing" && { reconnect: true }) },
        {
          onSuccess: (result) => {
            if (!("redirectUrl" in result)) return
            window.open(result.redirectUrl, "_blank", "noopener,noreferrer")
            toast(`Opened ${item.name} in a new tab`, { description: "Finish signing in there, then come back." })
            onOpened?.(item)
          },
          onError: (error) => toast.error(`Could not sign in with ${item.name}`, { description: errorMessage(error) }),
        },
      )
    },
  }
}
